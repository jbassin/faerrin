import { test, expect, describe, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import { applyPronunciations, loadLexicon } from "./pronunciation.ts";

describe("applyPronunciations", () => {
  const lex = { Faerrin: "ˈfɛrɪn", Sedecium: "sɛˈdɛkiʊm" };

  test("wraps a known term in inline IPA", () => {
    expect(applyPronunciations("Welcome to Faerrin.", lex)).toBe("Welcome to /ˈfɛrɪn/.");
  });

  test("replaces only the first occurrence of each term", () => {
    expect(applyPronunciations("Faerrin, oh Faerrin.", lex)).toBe("/ˈfɛrɪn/, oh Faerrin.");
  });

  test("applies multiple distinct terms", () => {
    expect(applyPronunciations("The Sedecium rules Faerrin.", lex)).toBe(
      "The /sɛˈdɛkiʊm/ rules /ˈfɛrɪn/.",
    );
  });

  test("leaves unknown words untouched and preserves whitespace", () => {
    expect(applyPronunciations("  A quiet  street.  ", lex)).toBe("  A quiet  street.  ");
  });

  test("matches whole words only (no substring hits)", () => {
    expect(applyPronunciations("Faerrinish customs", lex)).toBe("Faerrinish customs");
    // possessive: the bare word matches, the 's stays
    expect(applyPronunciations("Faerrin's moon", lex)).toBe("/ˈfɛrɪn/'s moon");
  });

  test("never rewrites text inside [audio tags]", () => {
    // A tag literally containing the term is left alone; prose after it is rewritten.
    expect(applyPronunciations("[Faerrin] Welcome to Faerrin.", lex)).toBe(
      "[Faerrin] Welcome to /ˈfɛrɪn/.",
    );
  });

  test("empty lexicon is a no-op", () => {
    expect(applyPronunciations("Faerrin", {})).toBe("Faerrin");
  });
});

describe("loadLexicon", () => {
  const TMP = `out/.test-lex-${process.pid}`;
  afterAll(async () => {
    await rm(TMP, { recursive: true, force: true });
  });

  test("reads a term→IPA map from disk", async () => {
    const path = `${TMP}/lex.json`;
    await Bun.write(path, JSON.stringify({ Faerrin: "ˈfɛrɪn" }));
    expect(await loadLexicon(path)).toEqual({ Faerrin: "ˈfɛrɪn" });
  });

  test("missing file → empty lexicon (no throw)", async () => {
    expect(await loadLexicon(`${TMP}/does-not-exist.json`)).toEqual({});
  });

  test("filters non-string / empty entries and rejects non-objects", async () => {
    const path = `${TMP}/messy.json`;
    await Bun.write(path, JSON.stringify({ Good: "ɡʊd", Bad: 5, Empty: "", "": "x" }));
    expect(await loadLexicon(path)).toEqual({ Good: "ɡʊd" });

    const arrPath = `${TMP}/arr.json`;
    await Bun.write(arrPath, JSON.stringify(["nope"]));
    expect(await loadLexicon(arrPath)).toEqual({});
  });
});
