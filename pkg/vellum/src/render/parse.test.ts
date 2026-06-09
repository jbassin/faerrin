import { describe, expect, test } from "bun:test";
import { parseDocument } from "./parse.ts";
import { DOCUMENT_KINDS, type VellumNode } from "./model.ts";
import { normalizeActionCost } from "./glyphs/actions.tsx";
import { collectText } from "./mdastToReact.tsx";

/** Narrow a node to a block, failing the test loudly otherwise. */
function asBlock(node: VellumNode | undefined) {
  if (node?.type !== "block") throw new Error(`expected block, got ${node?.type}`);
  return node;
}

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
    expect(doc.nodes).toHaveLength(1);

    const block = asBlock(doc.nodes[0]);
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
    expect(doc.nodes.map((n) => asBlock(n).kind)).toEqual([...DOCUMENT_KINDS]);
  });

  test("keeps top-level markdown as prose, in document order", () => {
    const src = [
      "# Mission Brief",
      "",
      "Some **loose** prose with a list:",
      "",
      "- one",
      "- two",
      "",
      ":::handout[Orders]",
      "The bridge is out.",
      ":::",
      "",
      "Closing remarks.",
    ].join("\n");

    const doc = parseDocument(src);
    expect(doc.nodes.map((n) => n.type)).toEqual(["prose", "block", "prose"]);

    const [intro, block, outro] = doc.nodes;
    expect(intro!.type).toBe("prose");
    if (intro!.type === "prose") {
      // heading, paragraph, and list all survive as one prose run
      expect(intro!.children.map((c) => c.type)).toEqual([
        "heading",
        "paragraph",
        "list",
      ]);
    }
    expect(asBlock(block).kind).toBe("handout");
    if (outro!.type === "prose") {
      expect(collectText(outro!.children)).toContain("Closing remarks");
    }
  });

  test("unknown directives degrade to prose (never dropped)", () => {
    const doc = parseDocument(":::monster\nnot a known kind\n:::");
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0]!.type).toBe("prose");
  });

  test("--- splits :::columns; multiple blocks per column all survive", () => {
    // The bug report: two :::item blocks in one column, only the first showing.
    // With the `---` divider style they sit directly inside ::::columns (one
    // colon bump), so both must be kept.
    const src = [
      "::::columns",
      ':::item[A]{level="Item 1"}',
      "first item",
      ":::",
      ':::item[B]{level="Item 1"}',
      "second item",
      ":::",
      "---",
      "## Right",
      "- a",
      "::::",
    ].join("\n");

    const cols = parseDocument(src).nodes[0]!;
    expect(cols.type).toBe("columns");
    if (cols.type === "columns") {
      expect(cols.columns).toHaveLength(2);
      // left column: BOTH items kept, in order (the regression we're guarding)
      expect(cols.columns[0]!.map((n) => asBlock(n).kind)).toEqual([
        "item",
        "item",
      ]);
      // right column: a prose run (heading + list)
      expect(cols.columns[1]!.map((n) => n.type)).toEqual(["prose"]);
    }
  });

  test("explicit :::column containers still work", () => {
    const src = [
      ":::::columns",
      "::::column",
      "## Left",
      "- a",
      "::::",
      "::::column",
      ":::handout[Note]",
      "right side",
      ":::",
      "::::",
      ":::::",
    ].join("\n");

    const cols = parseDocument(src).nodes[0]!;
    expect(cols.type).toBe("columns");
    if (cols.type === "columns") {
      expect(cols.columns).toHaveLength(2);
      expect(cols.columns[0]!.map((n) => n.type)).toEqual(["prose"]);
      const right = cols.columns[1]!;
      expect(right).toHaveLength(1);
      expect(asBlock(right[0]).kind).toBe("handout");
    }
  });

  test("columns with no divider degrade to a single column", () => {
    const doc = parseDocument("::::columns\njust loose text\n::::");
    const cols = doc.nodes[0]!;
    expect(cols.type).toBe("columns");
    if (cols.type === "columns") {
      expect(cols.columns).toHaveLength(1);
      expect(cols.columns[0]!.map((n) => n.type)).toEqual(["prose"]);
    }
  });

  test("an orphan top-level :::column keeps its content as prose", () => {
    // Misplaced — flagged at render time (ErrorChip), never dropped.
    const doc = parseDocument(":::column\norphan\n:::");
    expect(doc.nodes.map((n) => n.type)).toEqual(["prose"]);
    if (doc.nodes[0]!.type === "prose") {
      expect(collectText(doc.nodes[0]!.children)).toContain("orphan");
    }
  });

  test("a heading above columns shares the page (R-19-style layout)", () => {
    const src = [
      "# Encounter",
      "",
      "::::columns",
      ":::column",
      "left",
      ":::",
      ":::column",
      "right",
      ":::",
      "::::",
    ].join("\n");
    const doc = parseDocument(src);
    expect(doc.nodes.map((n) => n.type)).toEqual(["prose", "columns"]);
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
    expect(() => parseDocument("::::columns\n:::column\n")).not.toThrow();
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
