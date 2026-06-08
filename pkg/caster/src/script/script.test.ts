import { test, expect, describe, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import type { SessionDigest, WikiCorpus, WikiPage } from "../types.ts";
import type { LlmClient, ToolCallRequest, TextRequest } from "@faerrin/llm";
import { generateScript, loadOrGenerateScript } from "./index.ts";
import { buildScriptSystemPrompt, buildScriptUserContent } from "./prompt.ts";
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

// Records both passes so we can assert order and what each pass received.
class TwoPassStub implements LlmClient {
  textReq?: TextRequest;
  toolReq?: ToolCallRequest;
  order: string[] = [];
  constructor(
    private readonly transcript: string,
    private readonly toolReturn: unknown,
  ) {}
  async callText(req: TextRequest): Promise<string> {
    this.order.push("text");
    this.textReq = req;
    return this.transcript;
  }
  async callTool(req: ToolCallRequest): Promise<unknown> {
    this.order.push("tool");
    this.toolReq = req;
    return this.toolReturn;
  }
}

describe("generateScript two-pass", () => {
  test("runs the improv pass (free-text) then the dressing pass (tool)", async () => {
    const stub = new TwoPassStub("Bram: uh— the Voidheart, I think— Maeve: The Voidheart.", goodScript);
    const script = await generateScript(digest, wiki, { client: stub, twoPass: true });

    // Order: raw transcript first, then structure it.
    expect(stub.order).toEqual(["text", "tool"]);
    // Pass A: an improv/transcript prompt, fed the grounded digest.
    expect(String(stub.textReq?.system).toLowerCase()).toContain("transcript");
    expect(stub.textReq?.userContent).toContain("Entered the station.");
    // Pass B: a protective dressing prompt that forbids improving the dialogue,
    // and is handed Pass A's raw transcript as its content.
    expect(stub.toolReq?.system).toContain("DO NOT improve");
    expect(stub.toolReq?.userContent).toContain("the Voidheart");
    expect(stub.toolReq?.tool.name).toBe(SCRIPT_TOOL_NAME);

    expect(script.sessionId).toBe(digest.sessionId);
    expect(script.turns).toHaveLength(2);
  });

  test("errors clearly when the client cannot do free-text (no callText)", async () => {
    const stub = new StubClient(goodScript); // callTool only
    await expect(
      generateScript(digest, wiki, { client: stub, twoPass: true }),
    ).rejects.toThrow(/callText|free-text/i);
  });
});

describe("buildScriptSystemPrompt", () => {
  test("instructs spoken-text normalization and inline v3 audio tags for TTS", () => {
    const p = buildScriptSystemPrompt(DEFAULT_HOSTS).toLowerCase();
    expect(p).toContain("spell out numbers");
    expect(p).toContain("v3 audio tags");
    expect(p).toContain("no stage directions");
  });

  test("teaches punctuation prosody and the overlap/turn-timing tags", () => {
    const p = buildScriptSystemPrompt(DEFAULT_HOSTS).toLowerCase();
    expect(p).toContain("ellipsis");
    expect(p).toContain("em-dash");
    expect(p).toContain("[overlapping]");
    expect(p).toContain("[jumping in]");
    expect(p).toContain("[interrupts]");
  });

  test("surfaces non-verbal breath/voice-beat tags and marks the list non-exhaustive", () => {
    const p = buildScriptSystemPrompt(DEFAULT_HOSTS).toLowerCase();
    expect(p).toContain("non-exhaustive");
    expect(p).toContain("[sighs]");
    expect(p).toContain("[exhales sharply]");
    expect(p).toContain("[inhales deeply]");
    expect(p).toContain("[clears throat]");
  });

  test("is static for a given host config (stays a cacheable prefix)", () => {
    expect(buildScriptSystemPrompt(DEFAULT_HOSTS)).toBe(buildScriptSystemPrompt(DEFAULT_HOSTS));
  });
});

describe("buildScriptSystemPrompt — tavern-table tone (Phase 1)", () => {
  const prompt = buildScriptSystemPrompt(DEFAULT_HOSTS);
  const lower = prompt.toLowerCase();

  test("names the podcast anti-patterns to avoid", () => {
    expect(lower).toContain("avoid these podcast tells");
    expect(lower).toContain("don't march the beats");
    expect(lower).toContain("tidy a-then-b-then-c");
  });

  test("grounds the conversation in a physical tavern room", () => {
    expect(lower).toContain("the room");
    expect(lower).toContain("tavern");
    expect(lower).toContain("barkeep");
  });

  test("sets a counted imperfection budget with the standalone-wit rule", () => {
    expect(lower).toContain("imperfection budget");
    expect(lower).toContain("fail as standalone wit");
    expect(lower).toContain("unresolved");
  });

  test("keeps the three host voices asymmetric (mechanics, not just adjectives)", () => {
    expect(prompt).toContain("fluent but imprecise");
    expect(prompt).toContain("precise but terse");
    expect(prompt).toContain("fast but scattered");
  });
});

describe("buildScriptUserContent — de-structured beats (Phase 1)", () => {
  const enriched: SessionDigest = {
    sessionId: "105.observatory-slipped.2026-4-6",
    synopsis: "They explore the slipped observatory.",
    beats: [
      {
        order: 1,
        summary: "Entered the station.",
        significance: "First foothold past the wall.",
        details: ["a clutch Stealth roll"],
        tone: "tense",
        characters: ["Foral"],
        locations: ["Observatory"],
        wikiRefs: [],
      },
    ],
    discarded: [],
  };

  test("drops the BEAT ordinal and the Mood label", () => {
    const content = buildScriptUserContent(enriched, []);
    expect(content).not.toContain("BEAT 1");
    expect(content).not.toContain("Mood:");
    // The mood value is no longer surfaced (it got performed out loud before).
    expect(content).not.toContain("tense");
  });

  test("still surfaces summary, significance, details, and involves", () => {
    const content = buildScriptUserContent(enriched, []);
    expect(content).toContain("Entered the station.");
    expect(content).toContain("Why it mattered: First foothold past the wall.");
    expect(content).toContain("a clutch Stealth roll");
    expect(content).toContain("Involves: Foral, Observatory");
  });

  test("frames the beats as an unordered pool, not a numbered list", () => {
    const content = buildScriptUserContent(enriched, []).toLowerCase();
    expect(content).toContain("no fixed order");
  });

  test("degrades gracefully for an older minimal digest", () => {
    const minimal: SessionDigest = {
      sessionId: "x",
      synopsis: "s",
      beats: [{ order: 1, summary: "Just a summary.", characters: [], locations: [], wikiRefs: [] }],
      discarded: [],
    };
    const content = buildScriptUserContent(minimal, []);
    expect(content).toContain("Just a summary.");
    expect(content).not.toContain("Why it mattered");
  });

  test("surfaces the table angle as a discussion seed when present", () => {
    const withAngle: SessionDigest = {
      sessionId: "z",
      synopsis: "s",
      beats: [
        {
          order: 1,
          summary: "They leapt into the portal.",
          tableAngle: "Was that brave or just reckless?",
          characters: [],
          locations: [],
          wikiRefs: [],
        },
      ],
      discarded: [],
    };
    const content = buildScriptUserContent(withAngle, []);
    expect(content).toContain("What they'd argue about: Was that brave or just reckless?");
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
