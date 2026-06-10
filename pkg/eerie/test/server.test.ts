import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type RunningServer } from "../src/server";

let running: RunningServer;
let base: string;

beforeAll(() => {
  const dist = mkdtempSync(join(tmpdir(), "eerie-dist-"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>eerie test</title>");
  running = startServer({ port: 0, token: "s3cret", distDir: dist });
  base = `http://localhost:${running.server.port}`;
});

afterAll(() => running.stop());

function postRoll(body: unknown, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-eerie-token"] = token;
  return fetch(`${base}/api/v1/roll`, { method: "POST", headers, body: JSON.stringify(body) });
}

test("rejects ingest without the shared secret", async () => {
  const res = await postRoll({ user: "A", value: 5, is_crit: false, is_fumble: false });
  expect(res.status).toBe(401);
});

test("accepts an authed valid roll (204) and rejects garbage (400)", async () => {
  const ok = await postRoll({ user: "A", value: 5, is_crit: false, is_fumble: false }, "s3cret");
  expect(ok.status).toBe(204);

  const bad = await postRoll({ nope: true }, "s3cret");
  expect(bad.status).toBe(400);
});

test("serves the built overlay index at /", async () => {
  const res = await fetch(`${base}/`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("<title>eerie test</title>");
});

test("blocks path traversal", async () => {
  const res = await fetch(`${base}/../../etc/passwd`);
  // Either rejected outright, or normalized + SPA-fallback to index — never leaks.
  expect(await res.text()).not.toContain("root:");
});

test("delivers a published roll over SSE", async () => {
  const res = await fetch(`${base}/feed`);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  // Drain the initial `: connected` frame so we know the client is registered.
  await reader.read();

  await postRoll({ user: "Kethra", value: 20, is_crit: true, is_fumble: false }, "s3cret");

  let buf = "";
  while (!buf.includes("Kethra")) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  expect(buf).toContain("data: ");
  expect(JSON.parse(buf.slice(buf.indexOf("data: ") + 6, buf.indexOf("\n\n", buf.indexOf("data: "))))).toMatchObject({
    user: "Kethra",
    total: 20,
    isCrit: true,
  });

  await reader.cancel();
});
