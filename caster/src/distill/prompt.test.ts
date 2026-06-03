import { test, expect, describe } from "bun:test";
import type { Session } from "../types.ts";
import { DISTILL_SYSTEM_PROMPT, buildDistillUserContent } from "./prompt.ts";

function fixtureSession(): Session {
  return {
    id: "105.observatory-slipped.2026-4-27",
    arc: "observatory-slipped",
    arcTitle: "Observatory, Slipped",
    isMain: false,
    date: "2026-4-27",
    path: "content/transcripts/105.observatory-slipped.2026-4-27.txt",
    turns: [
      { line: 1, speaker: "Gamemaster", text: "You enter the observatory.", role: "gm", player: "Josh" },
      { line: 2, speaker: "Foral", text: "I check for traps.", role: "player", player: "Jorge" },
    ],
  };
}

describe("DISTILL_SYSTEM_PROMPT", () => {
  test("is static — contains no per-session data (cacheable prefix)", () => {
    // The system prompt must be byte-identical across sessions for caching.
    expect(DISTILL_SYSTEM_PROMPT).not.toContain("observatory");
    expect(DISTILL_SYSTEM_PROMPT).not.toContain("2026");
    expect(DISTILL_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{1,2}-\d{1,2}/);
  });

  test("instructs filtering table talk and recording via the tool", () => {
    expect(DISTILL_SYSTEM_PROMPT.toLowerCase()).toContain("table talk");
    expect(DISTILL_SYSTEM_PROMPT.toLowerCase()).toContain("tool");
  });
});

describe("buildDistillUserContent", () => {
  const content = buildDistillUserContent(fixtureSession());

  test("includes session id, arc, and date header", () => {
    expect(content).toContain("105.observatory-slipped.2026-4-27");
    expect(content).toContain("Observatory, Slipped");
    expect(content).toContain("2026-4-27");
  });

  test("renders turns as LINE\\tSPEAKER: text", () => {
    expect(content).toContain("1\tGamemaster: You enter the observatory.");
    expect(content).toContain("2\tForal: I check for traps.");
  });
});
