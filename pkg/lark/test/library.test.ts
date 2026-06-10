import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../src/lib/appconfig";
import { openDb } from "../src/db/index";
import * as repo from "../src/db/repo";
import { type App, createApp } from "../src/server/app";
import { signSession } from "../src/server/sessions";

const SECRET = "test-secret";
let dataDir: string;
let app: App;

function cfg(): AppConfig {
  return {
    port: 0,
    sessionSecret: SECRET,
    allowlist: new Set(["uid"]),
    oauth: { clientId: "c", clientSecret: "s", redirectUri: "x" },
    publicOrigin: "https://lark.test",
    secureCookies: true,
    distDir: "/nope",
    dataDir,
    dbPath: ":memory:",
    guildId: "g",
    targetLufs: -16,
  };
}

const cookie = `lark_session=${signSession("uid", SECRET)}`;

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`https://lark.test${path}`, {
    method,
    headers: { cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "lark-test-"));
  // Stub prober so upload tests need no ffmpeg.
  app = createApp(cfg(), openDb(":memory:"), {
    services: { prober: async () => ({ durationMs: 1234, format: "ogg", loudnessLufs: -18.5 }) },
  });
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

describe("auth guard", () => {
  test("rejects unauthenticated API calls", async () => {
    const res = await app.handle(new Request("https://lark.test/api/v1/collections"));
    expect(res.status).toBe(401);
  });
});

describe("collections + tracks", () => {
  test("create + list collections", async () => {
    const created = await (await app.handle(req("POST", "/api/v1/collections", { name: "Chrono Trigger" }))).json();
    expect(created.slug).toBe("chrono-trigger");
    const list = await (await app.handle(req("GET", "/api/v1/collections"))).json();
    expect(list).toHaveLength(1);
  });

  test("filter tracks by tag and collection", async () => {
    const c = repo.createCollection(app.db, { name: "C" });
    const t1 = repo.createTrack(app.db, { title: "Calm", sourceType: "upload", collectionId: c.id });
    repo.createTrack(app.db, { title: "Loud", sourceType: "upload" });
    await app.handle(req("POST", "/api/v1/tracks/bulk-tag", { ids: [t1.id], addTags: ["calm"] }));
    const tag = repo.listTags(app.db).find((x) => x.name === "calm")!;

    const byTag = await (await app.handle(req("GET", `/api/v1/tracks?tag=${tag.id}`))).json();
    expect(byTag.map((t: { id: number }) => t.id)).toEqual([t1.id]);
    expect(byTag[0].tags[0].name).toBe("calm");

    const byCol = await (await app.handle(req("GET", `/api/v1/tracks?collection=${c.id}`))).json();
    expect(byCol).toHaveLength(1);
  });

  test("bulk-rename preview then apply (B13)", async () => {
    const t1 = repo.createTrack(app.db, { title: "01 - Town", sourceType: "upload" });
    const t2 = repo.createTrack(app.db, { title: "02 - Field", sourceType: "upload" });
    const ops = [{ kind: "replace", find: "^\\d+ - ", replaceWith: "", regex: true }];

    const preview = await (
      await app.handle(req("POST", "/api/v1/tracks/bulk-rename", { ids: [t1.id, t2.id], ops, preview: true }))
    ).json();
    expect(preview.preview.map((r: { to: string }) => r.to)).toEqual(["Town", "Field"]);
    expect(repo.getTrack(app.db, t1.id)!.title).toBe("01 - Town"); // unchanged on preview

    const applied = await (
      await app.handle(req("POST", "/api/v1/tracks/bulk-rename", { ids: [t1.id, t2.id], ops }))
    ).json();
    expect(applied.applied).toBe(2);
    expect(repo.getTrack(app.db, t1.id)!.title).toBe("Town");
  });

  test("invalid bulk-rename regex → 400", async () => {
    const t = repo.createTrack(app.db, { title: "x", sourceType: "upload" });
    const res = await app.handle(
      req("POST", "/api/v1/tracks/bulk-rename", {
        ids: [t.id],
        ops: [{ kind: "replace", find: "(", replaceWith: "", regex: true }],
      }),
    );
    expect(res.status).toBe(400);
  });

  test("delete track → 204", async () => {
    const t = repo.createTrack(app.db, { title: "x", sourceType: "upload" });
    const res = await app.handle(req("DELETE", `/api/v1/tracks/${t.id}`));
    expect(res.status).toBe(204);
    expect(repo.getTrack(app.db, t.id)).toBeNull();
  });

  test("bulk-move puts tracks into a collection / out with null (B15)", async () => {
    const c = repo.createCollection(app.db, { name: "Dest" });
    const a = repo.createTrack(app.db, { title: "a", sourceType: "upload" });
    const b = repo.createTrack(app.db, { title: "b", sourceType: "upload", collectionId: c.id });
    const res = await app.handle(req("POST", "/api/v1/tracks/bulk-move", { ids: [a.id], collectionId: c.id }));
    expect(await res.json()).toEqual({ moved: 1 });
    expect(repo.getTrack(app.db, a.id)!.collection_id).toBe(c.id);
    // move b out
    await app.handle(req("POST", "/api/v1/tracks/bulk-move", { ids: [b.id], collectionId: null }));
    expect(repo.getTrack(app.db, b.id)!.collection_id).toBeNull();
  });

  test("bulk-move to a missing collection → 404", async () => {
    const a = repo.createTrack(app.db, { title: "a", sourceType: "upload" });
    const res = await app.handle(req("POST", "/api/v1/tracks/bulk-move", { ids: [a.id], collectionId: 9999 }));
    expect(res.status).toBe(404);
  });

  test("bulk-delete removes all given tracks (B18)", async () => {
    const a = repo.createTrack(app.db, { title: "a", sourceType: "upload" });
    const b = repo.createTrack(app.db, { title: "b", sourceType: "upload" });
    const keep = repo.createTrack(app.db, { title: "keep", sourceType: "upload" });
    const res = await app.handle(req("POST", "/api/v1/tracks/bulk-delete", { ids: [a.id, b.id] }));
    expect(await res.json()).toEqual({ deleted: 2 });
    expect(repo.getTrack(app.db, a.id)).toBeNull();
    expect(repo.getTrack(app.db, keep.id)).not.toBeNull();
  });

  test("bulk strip-suffix via bulk-rename cleans noisy titles (B13)", async () => {
    const t1 = repo.createTrack(app.db, { title: "Phantom - Persona 5 OST [Extended]", sourceType: "youtube" });
    const t2 = repo.createTrack(app.db, { title: "Mementos - Persona 5 OST [Extended]", sourceType: "youtube" });
    const ops = [{ kind: "stripSuffix", value: " - Persona 5 OST [Extended]" }, { kind: "collapseWhitespace" }];
    await app.handle(req("POST", "/api/v1/tracks/bulk-rename", { ids: [t1.id, t2.id], ops }));
    expect(repo.getTrack(app.db, t1.id)!.title).toBe("Phantom");
    expect(repo.getTrack(app.db, t2.id)!.title).toBe("Mementos");
  });
});

describe("upload ingest (B19)", () => {
  test("stores file + creates a ready track", async () => {
    const form = new FormData();
    form.append("files", new File([new Uint8Array([1, 2, 3, 4])], "My Song.ogg", { type: "audio/ogg" }));
    const res = await app.handle(
      new Request("https://lark.test/api/v1/ingest/upload", { method: "POST", headers: { cookie }, body: form }),
    );
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out.created).toHaveLength(1);
    expect(out.created[0].title).toBe("My Song");
    expect(out.created[0].status).toBe("ready");
    expect(out.created[0].loudness_lufs).toBe(-18.5);
  });

  test("rejects unsupported file type", async () => {
    const form = new FormData();
    form.append("files", new File([new Uint8Array([0])], "notes.txt", { type: "text/plain" }));
    const res = await app.handle(
      new Request("https://lark.test/api/v1/ingest/upload", { method: "POST", headers: { cookie }, body: form }),
    );
    const out = await res.json();
    expect(out.created).toHaveLength(0);
    expect(out.errors).toHaveLength(1);
  });
});
