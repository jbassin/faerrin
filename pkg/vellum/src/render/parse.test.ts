import { describe, expect, test } from "bun:test";
import { parseDocument } from "./parse.ts";
import { DOCUMENT_KINDS } from "./model.ts";
import { normalizeActionCost } from "./glyphs/actions.tsx";
import { collectText } from "./mdastToReact.tsx";

describe("parseDocument", () => {
  test("parses a statblock: kind, label, attributes, body", () => {
    const src = [
      ':::statblock[Goblin Warrior]{level="Creature 1" traits="agile,goblin"}',
      "A small menace. Strikes with :action[1] then retreats.",
      "",
      "## Abilities",
      "- Sneaky",
      ":::",
    ].join("\n");

    const doc = parseDocument(src);
    expect(doc.blocks).toHaveLength(1);

    const block = doc.blocks[0]!;
    expect(block.kind).toBe("statblock");
    expect(block.label).toBe("Goblin Warrior");
    expect(block.attributes.level).toBe("Creature 1");
    expect(block.attributes.traits).toBe("agile,goblin");
    expect(block.children.length).toBeGreaterThan(0);
    // label paragraph is split off — it's not part of the rendered body
    expect(collectText(block.children)).toContain("small menace");
  });

  test("recognizes every kind in the zoo", () => {
    const src = DOCUMENT_KINDS.map(
      (kind) => `:::${kind}\nbody\n:::`,
    ).join("\n\n");
    const doc = parseDocument(src);
    expect(doc.blocks.map((b) => b.kind)).toEqual([...DOCUMENT_KINDS]);
  });

  test("ignores unknown directives and loose prose at top level", () => {
    const src = [
      "Just some prose.",
      "",
      ":::monster",
      "not a known kind",
      ":::",
      "",
      ":::handout[Orders]",
      "The bridge is out.",
      ":::",
    ].join("\n");

    const doc = parseDocument(src);
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]!.kind).toBe("handout");
    expect(doc.blocks[0]!.label).toBe("Orders");
  });

  test("mode defaults to mechanical and can be overridden", () => {
    expect(parseDocument(":::item\nx\n:::").mode).toBe("mechanical");
    expect(parseDocument(":::item\nx\n:::", { mode: "diegetic" }).mode).toBe(
      "diegetic",
    );
  });

  test("never throws on malformed input", () => {
    expect(() => parseDocument(":::statblock{bad=")).not.toThrow();
    expect(() => parseDocument("")).not.toThrow();
  });
});

describe("normalizeActionCost", () => {
  test("maps numeric, word, and special tokens", () => {
    expect(normalizeActionCost("1")).toBe("1");
    expect(normalizeActionCost("two")).toBe("2");
    expect(normalizeActionCost(" 3 ")).toBe("3");
    expect(normalizeActionCost("Reaction")).toBe("reaction");
    expect(normalizeActionCost("free")).toBe("free");
    expect(normalizeActionCost("0")).toBe("free");
  });

  test("returns null for unknown tokens", () => {
    expect(normalizeActionCost("seven")).toBeNull();
    expect(normalizeActionCost("")).toBeNull();
  });
});
