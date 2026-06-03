import { test, expect, describe } from "bun:test";
import type { ScriptTurn } from "../types.ts";
import { chunkTurns } from "./dialogue.ts";

const turn = (speaker: "A" | "B", text: string): ScriptTurn => ({ speaker, text });

describe("chunkTurns", () => {
  test("keeps order and groups consecutive turns under the budget", () => {
    const turns = [turn("A", "aaaa"), turn("B", "bbbb"), turn("A", "cccc")];
    const chunks = chunkTurns(turns, 8); // each text is 4 chars → 2 per chunk
    expect(chunks.map((c) => c.map((t) => t.text))).toEqual([["aaaa", "bbbb"], ["cccc"]]);
  });

  test("starts a new chunk only when the next turn would exceed the budget", () => {
    const turns = [turn("A", "12345"), turn("B", "6789")];
    expect(chunkTurns(turns, 9)).toHaveLength(1); // 5 + 4 = 9, fits exactly
    expect(chunkTurns(turns, 8)).toHaveLength(2); // 5 + 4 = 9 > 8
  });

  test("an over-budget single turn becomes its own chunk (never split)", () => {
    const turns = [turn("A", "x".repeat(50)), turn("B", "ok")];
    const chunks = chunkTurns(turns, 10);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(1);
  });

  test("measures turns with the provided length function", () => {
    const turns = [turn("A", "hi"), turn("B", "yo")];
    // Pretend every turn costs 6 chars → only one fits per 8-char chunk.
    const chunks = chunkTurns(turns, 8, () => 6);
    expect(chunks).toHaveLength(2);
  });

  test("returns no chunks for an empty script", () => {
    expect(chunkTurns([], 100)).toEqual([]);
  });
});
