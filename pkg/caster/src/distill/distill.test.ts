import { test, expect, describe, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import type { Session } from "../types.ts";
import type { LlmClient, ToolCallRequest } from "@faerrin/llm";
import { distillSession, loadOrDistill } from "./index.ts";
import { DISTILL_SYSTEM_PROMPT } from "./prompt.ts";
import { DISTILL_TOOL_NAME } from "./schema.ts";

function fixtureSession(): Session {
  return {
    id: "105.observatory-slipped.2026-4-27",
    arc: "observatory-slipped",
    arcTitle: "Observatory, Slipped",
    isMain: false,
    date: "2026-4-27",
    path: "p",
    turns: [
      { line: 1, speaker: "Gamemaster", text: "You enter.", role: "gm", player: "Josh" },
      { line: 2, speaker: "Foral", text: "I look around.", role: "player", player: "Jorge" },
    ],
  };
}

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

const goodDigest = {
  synopsis: "They explore.",
  beats: [{ order: 1, summary: "Entered.", characters: ["Foral"], locations: [], wikiRefs: [] }],
  discarded: [],
};

describe("distillSession", () => {
  test("builds the request from the static system prompt + session, returns parsed digest", async () => {
    const stub = new StubClient({
      synopsis: "They explore.",
      beats: [{ order: 1, summary: "Entered the observatory.", characters: ["Foral"], locations: [], wikiRefs: [] }],
      discarded: [],
    });

    const digest = await distillSession(fixtureSession(), { client: stub });

    // Request wiring
    expect(stub.lastRequest?.system).toBe(DISTILL_SYSTEM_PROMPT);
    expect(stub.lastRequest?.tool.name).toBe(DISTILL_TOOL_NAME);
    expect(stub.lastRequest?.userContent).toContain("1\tGamemaster: You enter.");

    // Parsed result
    expect(digest.sessionId).toBe("105.observatory-slipped.2026-4-27");
    expect(digest.beats).toHaveLength(1);
    expect(digest.beats[0]?.summary).toBe("Entered the observatory.");
  });

  test("propagates parse errors when the model returns malformed output", async () => {
    const stub = new StubClient({ synopsis: "s", beats: [] }); // empty beats → invalid
    await expect(distillSession(fixtureSession(), { client: stub })).rejects.toThrow();
  });

  test("passes model/maxTokens overrides through to the client", async () => {
    const stub = new StubClient({ synopsis: "s", beats: [{ order: 1, summary: "x" }], discarded: [] });
    await distillSession(fixtureSession(), { client: stub, model: "claude-haiku-4-5", maxTokens: 4096 });
    expect(stub.lastRequest?.model).toBe("claude-haiku-4-5");
    expect(stub.lastRequest?.maxTokens).toBe(4096);
  });
});

describe("loadOrDistill caching", () => {
  const TMP = `out/.test-cache-${process.pid}`;
  afterAll(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  test("distills + writes on a miss, then serves from disk on the next call", async () => {
    const stub = new StubClient(goodDigest);

    const first = await loadOrDistill(fixtureSession(), { client: stub, outDir: TMP });
    expect(first.cached).toBe(false);
    expect(stub.calls).toBe(1);
    expect(await Bun.file(first.path).exists()).toBe(true);

    const second = await loadOrDistill(fixtureSession(), { client: stub, outDir: TMP });
    expect(second.cached).toBe(true);
    expect(stub.calls).toBe(1); // no second LLM call
    expect(second.digest).toEqual(first.digest);
  });

  test("force bypasses the cache and re-distills", async () => {
    const stub = new StubClient(goodDigest);
    // Ensure an artifact exists (cache hit or miss depending on prior tests).
    await loadOrDistill(fixtureSession(), { client: stub, outDir: TMP });
    const before = stub.calls;
    const forced = await loadOrDistill(fixtureSession(), { client: stub, outDir: TMP, force: true });
    expect(forced.cached).toBe(false);
    expect(stub.calls).toBe(before + 1); // force always calls the LLM
  });
});
