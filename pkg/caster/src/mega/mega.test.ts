import { test, expect, describe, afterAll, beforeAll } from "bun:test";
import { rm } from "node:fs/promises";
import type { Session, SessionDigest } from "../types.ts";
import type { LlmClient, ToolCallRequest } from "@faerrin/llm";
import { writeDigest } from "../distill/store.ts";
import { DISTILL_TOOL_NAME } from "../distill/schema.ts";
import { collectMembers, fuseDigests, loadOrFuseMega } from "./index.ts";
import { MEGA_SYSTEM_PROMPT } from "./prompt.ts";
import type { MegaMember } from "./select.ts";

/** Stub client: records the request, counts calls, returns canned tool input. No network. */
class StubClient implements LlmClient {
  lastRequest?: ToolCallRequest;
  calls = 0;
  constructor(private readonly toReturn: unknown) {}
  async callTool(req: ToolCallRequest): Promise<unknown> {
    this.calls++;
    this.lastRequest = req;
    return this.toReturn;
  }
}

function session(id: string, date: string): Session {
  return { id, arc: "through-a-song-darkly", arcTitle: "Through a Song, Darkly", isMain: true, date, path: `${id}.txt`, turns: [] };
}

function digestFor(id: string, summary: string): SessionDigest {
  return {
    sessionId: id,
    synopsis: `Synopsis of ${id}.`,
    beats: [
      { order: 1, summary, significance: "It mattered.", tone: "tense", characters: ["Reed"], locations: ["Wrenford"], wikiRefs: ["Calaria"] },
    ],
    discarded: [],
  };
}

const sessions: Session[] = [
  session("000.through-a-song-darkly.2026-5-7", "2026-5-7"),
  session("000.through-a-song-darkly.2026-5-25", "2026-5-25"),
  session("000.through-a-song-darkly.2026-6-8", "2026-6-8"),
];

const fusedReturn = {
  synopsis: "A month of upheaval, start to finish.",
  beats: [
    { order: 2, summary: "Then the reversal.", characters: [], locations: [], wikiRefs: [] },
    { order: 1, summary: "First the setup.", characters: [], locations: [], wikiRefs: [] },
  ],
  discarded: [],
};

describe("fuseDigests", () => {
  function members(): MegaMember[] {
    return sessions.map((s) => ({ session: s, digest: digestFor(s.id, `Beat for ${s.date}`) }));
  }

  test("wires the static mega prompt + distill tool, returns a parsed digest under the mega id", async () => {
    const stub = new StubClient(fusedReturn);
    const id = "000.through-a-song-darkly.2026-6-8-recap-of-2026-5-7";

    const digest = await fuseDigests(id, members(), { client: stub });

    expect(stub.lastRequest?.system).toBe(MEGA_SYSTEM_PROMPT);
    expect(stub.lastRequest?.tool.name).toBe(DISTILL_TOOL_NAME);
    // User content carries each member's id + synopsis, in order.
    expect(stub.lastRequest?.userContent).toContain("000.through-a-song-darkly.2026-5-7");
    expect(stub.lastRequest?.userContent).toContain("Beat for 2026-6-8");

    expect(digest.sessionId).toBe(id);
    // parseDigest renumbers beats to a contiguous 1-based order by the model's order.
    expect(digest.beats.map((b) => b.summary)).toEqual(["First the setup.", "Then the reversal."]);
    expect(digest.beats.map((b) => b.order)).toEqual([1, 2]);
  });

  test("passes the beat budget (episode-length target) into the prompt", async () => {
    const stub = new StubClient(fusedReturn);
    await fuseDigests("x", members(), { client: stub, targetBeats: 28 });
    expect(stub.lastRequest?.userContent).toContain("Beat budget: about 28 beats");
  });

  test("omits the beat-budget line when no target is given", async () => {
    const stub = new StubClient(fusedReturn);
    await fuseDigests("x", members(), { client: stub });
    expect(stub.lastRequest?.userContent).not.toContain("Beat budget");
  });

  test("propagates parse errors on malformed model output", async () => {
    const stub = new StubClient({ synopsis: "s", beats: [] }); // empty beats → invalid
    await expect(fuseDigests("x", members(), { client: stub })).rejects.toThrow();
  });

  test("passes model/maxTokens overrides through", async () => {
    const stub = new StubClient(fusedReturn);
    await fuseDigests("x", members(), { client: stub, model: "claude-haiku-4-5", maxTokens: 8000 });
    expect(stub.lastRequest?.model).toBe("claude-haiku-4-5");
    expect(stub.lastRequest?.maxTokens).toBe(8000);
  });
});

describe("collectMembers", () => {
  const TMP = `out/.test-mega-collect-${process.pid}`;
  beforeAll(async () => {
    for (const s of sessions) await writeDigest(digestFor(s.id, `Beat for ${s.date}`), TMP);
  });
  afterAll(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  test("reads each member's cached digest", async () => {
    const members = await collectMembers(sessions, TMP);
    expect(members.map((m) => m.digest.sessionId)).toEqual(sessions.map((s) => s.id));
  });

  test("throws (naming the distill command) when a member digest is missing", async () => {
    const withGhost = [...sessions, session("000.through-a-song-darkly.2026-6-1", "2026-6-1")];
    await expect(collectMembers(withGhost, TMP)).rejects.toThrow(
      /distill 000\.through-a-song-darkly\.2026-6-1/,
    );
  });
});

describe("loadOrFuseMega caching", () => {
  const TMP = `out/.test-mega-fuse-${process.pid}`;
  beforeAll(async () => {
    for (const s of sessions) await writeDigest(digestFor(s.id, `Beat for ${s.date}`), TMP);
  });
  afterAll(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  test("fuses + writes on a miss, then serves the mega digest from disk", async () => {
    const stub = new StubClient(fusedReturn);
    const selection = { from: "2026-5-7", to: "2026-6-8", arc: "through-a-song-darkly" };

    const first = await loadOrFuseMega(sessions, selection, { client: stub, outDir: TMP });
    expect(first.cached).toBe(false);
    expect(first.id).toBe("000.through-a-song-darkly.2026-6-8-recap-of-2026-5-7");
    expect(stub.calls).toBe(1);
    expect(await Bun.file(first.path).exists()).toBe(true);

    const second = await loadOrFuseMega(sessions, selection, { client: stub, outDir: TMP });
    expect(second.cached).toBe(true);
    expect(stub.calls).toBe(1); // no second LLM call
    expect(second.digest).toEqual(first.digest);
  });

  test("force bypasses the cache and re-fuses", async () => {
    const stub = new StubClient(fusedReturn);
    const selection = { from: "2026-5-7", to: "2026-6-8", arc: "through-a-song-darkly" };
    await loadOrFuseMega(sessions, selection, { client: stub, outDir: TMP });
    const before = stub.calls;
    const forced = await loadOrFuseMega(sessions, selection, { client: stub, outDir: TMP, force: true });
    expect(forced.cached).toBe(false);
    expect(stub.calls).toBe(before + 1);
  });
});
