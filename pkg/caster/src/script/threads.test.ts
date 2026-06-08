import { test, expect, describe, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import type { Script } from "../types.ts";
import type { LlmClient, ToolCallRequest } from "@faerrin/llm";
import { DEFAULT_HOSTS } from "./hosts.ts";
import {
  loadThreads,
  saveThreads,
  mergeThreads,
  formatThreads,
  extractThreads,
  type Thread,
} from "./threads.ts";

const TMP = `out/.test-threads-${process.pid}`;
afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("mergeThreads", () => {
  test("appends new threads and dedups by normalized text", () => {
    const existing: Thread[] = [{ text: "The barghest souvenir", kind: "joke" }];
    const incoming: Thread[] = [
      { text: "the barghest souvenir!", kind: "joke" }, // dup (normalized)
      { text: "Pip owes Maeve a drink", kind: "grudge" }, // new
    ];
    const merged = mergeThreads(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(merged.map((t) => t.text)).toEqual([
      "The barghest souvenir",
      "Pip owes Maeve a drink",
    ]);
  });

  test("caps to the most recent `max`", () => {
    const existing: Thread[] = Array.from({ length: 5 }, (_, i) => ({
      text: `old ${i}`,
      kind: "bit" as const,
    }));
    const incoming: Thread[] = [{ text: "fresh", kind: "prediction" }];
    const merged = mergeThreads(existing, incoming, 3);
    expect(merged).toHaveLength(3);
    expect(merged[merged.length - 1]?.text).toBe("fresh"); // newest kept
  });
});

describe("formatThreads", () => {
  test("empty → empty string (no block injected)", () => {
    expect(formatThreads([])).toBe("");
  });

  test("renders a labeled callbacks block", () => {
    const block = formatThreads([
      { text: "the barghest souvenir", kind: "joke" },
      { text: "Pip owes Maeve a drink", kind: "grudge" },
    ]);
    expect(block).toContain("RUNNING THREADS");
    expect(block).toContain("- the barghest souvenir [joke]");
    expect(block).toContain("- Pip owes Maeve a drink [grudge]");
    expect(block.toLowerCase()).toContain("without explaining");
  });
});

describe("loadThreads / saveThreads", () => {
  test("round-trips and is tolerant of a missing file", async () => {
    expect(await loadThreads(`${TMP}/missing.json`)).toEqual([]);
    const path = `${TMP}/threads.json`;
    const threads: Thread[] = [{ text: "the goat thing", kind: "bit" }];
    await saveThreads(path, threads);
    expect(await loadThreads(path)).toEqual(threads);
  });

  test("filters out malformed entries and rejects non-arrays", async () => {
    const path = `${TMP}/messy.json`;
    await Bun.write(
      path,
      JSON.stringify([
        { text: "good", kind: "joke" },
        { text: "", kind: "joke" }, // empty text
        { text: "bad kind", kind: "nope" }, // invalid kind
        { kind: "bit" }, // no text
        "nonsense",
      ]),
    );
    expect(await loadThreads(path)).toEqual([{ text: "good", kind: "joke" }]);

    const arrPath = `${TMP}/notarray.json`;
    await Bun.write(arrPath, JSON.stringify({ threads: [] }));
    expect(await loadThreads(arrPath)).toEqual([]);
  });
});

describe("extractThreads", () => {
  class Stub implements LlmClient {
    lastRequest?: ToolCallRequest;
    constructor(private readonly toReturn: unknown) {}
    async callTool(req: ToolCallRequest): Promise<unknown> {
      this.lastRequest = req;
      return this.toReturn;
    }
  }

  const script: Script = {
    sessionId: "s",
    title: "A Tithe of Hearts",
    hosts: DEFAULT_HOSTS,
    turns: [
      { speaker: "A", text: "The barghest souvenir!" },
      { speaker: "C", text: "Worst possible souvenir." },
    ],
  };

  test("mines threads from a script and validates the tool output", async () => {
    const stub = new Stub({
      threads: [
        { text: "the barghest souvenir", kind: "joke" },
        { text: "", kind: "joke" }, // dropped (empty)
        { text: "garbage", kind: "invalid" }, // dropped (bad kind)
      ],
    });
    const mined = await extractThreads(stub, script, DEFAULT_HOSTS);
    expect(mined).toEqual([{ text: "the barghest souvenir", kind: "joke" }]);
    // Fed the episode text + host names.
    expect(stub.lastRequest?.userContent).toContain("A Tithe of Hearts");
    expect(stub.lastRequest?.system).toContain("Bram");
  });

  test("returns [] when the model returns nothing usable", async () => {
    const stub = new Stub({ threads: "not an array" });
    expect(await extractThreads(stub, script, DEFAULT_HOSTS)).toEqual([]);
  });
});
