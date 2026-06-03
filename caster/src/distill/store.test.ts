import { test, expect, describe, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import type { SessionDigest } from "../types.ts";
import { DigestParseError } from "./parse.ts";
import { digestPath, readDigest, writeDigest } from "./store.ts";

const TMP = `out/.test-${process.pid}`;

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

const digest: SessionDigest = {
  sessionId: "105.observatory-slipped.2026-4-6",
  synopsis: "They explore the slipped observatory.",
  beats: [{ order: 1, summary: "Entered.", characters: ["Foral"], locations: ["Observatory"], wikiRefs: ["Sedecium"] }],
  discarded: ["you're laggy"],
};

describe("digest store", () => {
  test("write then read round-trips the digest", async () => {
    const path = await writeDigest(digest, TMP);
    expect(path).toBe(digestPath(digest.sessionId, TMP));
    expect(await readDigest(digest.sessionId, TMP)).toEqual(digest);
  });

  test("read returns null when no artifact exists", async () => {
    expect(await readDigest("nope.0000-0-0", TMP)).toBeNull();
  });

  test("read re-validates and rejects a corrupt artifact", async () => {
    await Bun.write(digestPath("corrupt.0", TMP), JSON.stringify({ synopsis: "s", beats: [] }));
    await expect(readDigest("corrupt.0", TMP)).rejects.toThrow(DigestParseError);
  });
});
