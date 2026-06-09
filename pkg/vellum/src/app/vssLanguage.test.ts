import { describe, expect, test } from "bun:test";
import { parser as commonmark } from "@lezer/markdown";
import { vssMarkdown } from "./vssLanguage.ts";

const parser = commonmark.configure([vssMarkdown]);

/** Parse and return `name → covered source slices` for the VSS nodes. */
function vssNodes(source: string): Record<string, string[]> {
  const tree = parser.parse(source);
  const out: Record<string, string[]> = {};
  tree.iterate({
    enter(node) {
      if (!node.name.startsWith("VSS")) return;
      (out[node.name] ??= []).push(source.slice(node.from, node.to));
    },
  });
  return out;
}

describe("vssLanguage (editor grammar)", () => {
  test("parses an opener line into VSSBlock with kind + title children", () => {
    const src = '@item "Reinforced Bulkheads"\n| price: 30 Energy\n{\nbody\n}';
    const nodes = vssNodes(src);
    expect(nodes.VSSBlock).toEqual(['@item "Reinforced Bulkheads"']);
    expect(nodes.VSSKind).toEqual(["@item"]);
    expect(nodes.VSSTitle).toEqual(['"Reinforced Bulkheads"']);
    expect(nodes.VSSAttr).toEqual(["| price: 30 Energy"]);
    expect(nodes.VSSAttrKey).toEqual(["| price:"]);
    expect(nodes.VSSBrace).toEqual(["{", "}"]);
  });

  test("parses @columns openers and closing brackets", () => {
    const src = "@columns [\n  {\n  left\n  }\n  {\n  right\n  }\n]";
    const nodes = vssNodes(src);
    expect(nodes.VSSColumns).toEqual(["@columns ["]);
    expect(nodes.VSSBrace).toEqual(["{", "}", "{", "}", "]"]);
  });

  test("body markdown still parses normally inside braces", () => {
    const src = '@handout "X"\n{\n## Heading\n\n**bold** text\n}';
    const tree = parser.parse(src);
    const names: string[] = [];
    tree.iterate({ enter: (n) => void names.push(n.name) });
    expect(names).toContain("ATXHeading2");
    expect(names).toContain("StrongEmphasis");
  });

  test("an opener interrupts a paragraph (compiler-faithful)", () => {
    const nodes = vssNodes('prose line\n@item "X"\n{\nbody\n}');
    expect(nodes.VSSBlock).toEqual(['@item "X"']);
  });

  test("non-kinds and mid-line @ are not openers", () => {
    // @reaction is an action sigil, @everyone isn't a kind, said @item is mid-line
    const src = '@reaction\n@everyone hello\nsaid @item "junk"\n@items "plural"';
    const nodes = vssNodes(src);
    expect(nodes.VSSBlock).toBeUndefined();
    expect(nodes.VSSColumns).toBeUndefined();
  });

  test("GFM-style table rows and multi-pipe lines are not attr lines", () => {
    const nodes = vssNodes("| Str: +4 | Dex: +2 |\n| Ability | Mod |");
    expect(nodes.VSSAttr).toBeUndefined();
  });

  test("a lone brace line closes a body even right under text", () => {
    // No blank line before `}` — the compiler still closes the body there,
    // so the editor must mark it as structure, not paragraph continuation.
    const nodes = vssNodes('@item "X"\n{\nbody text\n}');
    expect(nodes.VSSBrace).toEqual(["{", "}"]);
  });

  test("a brace inside a line stays paragraph text", () => {
    const nodes = vssNodes("press the } key and {the} combo");
    expect(nodes.VSSBrace).toBeUndefined();
  });
});
