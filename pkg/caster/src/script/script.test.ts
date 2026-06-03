import { test, expect, describe, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import type { SessionDigest, WikiCorpus, WikiPage } from "../types.ts";
import type { LlmClient, ToolCallRequest } from "@faerrin/llm";
import { generateScript, loadOrGenerateScript } from "./index.ts";
import { buildScriptSystemPrompt } from "./prompt.ts";
import { SCRIPT_TOOL_NAME } from "./schema.ts";
import { DEFAULT_HOSTS } from "./hosts.ts";

function corpus(pages: WikiPage[]): WikiCorpus {
  return { pages: new Map(pages.map((p) => [p.path, p])), graph: new Map() };
}

const wiki = corpus([
  { path: "Phenomena/Voidsong.md", title: "Voidsong", text: "A cry from beyond the wall.", links: [] },
]);

const digest: SessionDigest = {
  sessionId: "105.observatory-slipped.2026-4-6",
  synopsis: "They explore the slipped observatory.",
  beats: [{ order: 1, summary: "Entered the station.", characters: ["Foral"], locations: ["Observatory"], wikiRefs: ["Voidsong"] }],
  discarded: [],
};

const goodScript = {
  title: "The Slipped Observatory",
  turns: [
    { speaker: "A", text: "Welcome back!" },
    { speaker: "B", text: "Strap in." },
  ],
};

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

describe("generateScript", () => {
  test("wires the static system prompt + grounded digest, returns parsed script", async () => {
    const stub = new StubClient(goodScript);
    const script = await generateScript(digest, wiki, { client: stub });

    expect(stub.lastRequest?.system).toBe(buildScriptSystemPrompt(DEFAULT_HOSTS));
    expect(stub.lastRequest?.tool.name).toBe(SCRIPT_TOOL_NAME);
    // Beats + grounded wiki excerpt both reach the model.
    expect(stub.lastRequest?.userContent).toContain("Entered the station.");
    expect(stub.lastRequest?.userContent).toContain("A cry from beyond the wall.");

    expect(script.sessionId).toBe(digest.sessionId);
    expect(script.title).toBe("The Slipped Observatory");
    expect(script.turns).toHaveLength(2);
  });

  test("uses a generous default maxTokens for a long episode", async () => {
    const stub = new StubClient(goodScript);
    await generateScript(digest, wiki, { client: stub });
    expect(stub.lastRequest?.maxTokens).toBeGreaterThanOrEqual(32_000);
  });

  test("records the hosts used and bakes their names into the prompt", async () => {
    const hosts = {
      A: { name: "Sol", persona: "sunny" },
      B: { name: "Wren", persona: "wry" },
      C: { name: "Vex", persona: "spiky" },
    };
    const stub = new StubClient(goodScript);
    const script = await generateScript(digest, wiki, { client: stub, hosts });
    expect(script.hosts).toEqual(hosts);
    expect(stub.lastRequest?.system).toContain("Sol");
    expect(stub.lastRequest?.system).toContain("Wren");
    expect(stub.lastRequest?.system).toContain("Vex");
  });
});

describe("buildScriptSystemPrompt", () => {
  test("instructs spoken-text normalization and inline v3 audio tags for TTS", () => {
    const p = buildScriptSystemPrompt(DEFAULT_HOSTS).toLowerCase();
    expect(p).toContain("spell out numbers");
    expect(p).toContain("v3 audio tags");
    expect(p).toContain("no stage directions");
  });
});

describe("loadOrGenerateScript caching", () => {
  const TMP = `out/.test-script-${process.pid}`;
  afterAll(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  test("generates + writes on a miss, then serves from disk on the next call", async () => {
    const stub = new StubClient(goodScript);
    const first = await loadOrGenerateScript(digest, wiki, { client: stub, outDir: TMP });
    expect(first.cached).toBe(false);
    expect(stub.calls).toBe(1);

    const second = await loadOrGenerateScript(digest, wiki, { client: stub, outDir: TMP });
    expect(second.cached).toBe(true);
    expect(stub.calls).toBe(1);
    expect(second.script).toEqual(first.script);
  });
});
