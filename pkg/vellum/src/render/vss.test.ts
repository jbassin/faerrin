import { describe, expect, test } from "bun:test";
import { compileVss } from "./vss.ts";
import { parseDocument } from "./parse.ts";
import { type VellumNode } from "./model.ts";
import { collectText } from "./mdastToReact.tsx";
import { FIXTURES } from "../../test/visual/fixtures.ts";

/** Narrow a node to a block, failing loudly otherwise. */
function asBlock(node: VellumNode | undefined) {
  if (node?.type !== "block") throw new Error(`expected block, got ${node?.type}`);
  return node;
}

/** The §1 worked example (VSS source). */
const VSS_EXAMPLE = `@columns [
  {
    ## Tier I
    @item "Reinforced Bulkheads"
    | price: 30 Energy
    | level: 1
    {
      The Fortitude DC of the base camp increases by **+2**.
    }
  }
  {
    ## Tier 2
    @item "Alarm Wards"
    | price: 35 Energy
    {
      Stealth checks to infiltrate suffer a **-2** penalty.
    }
  }
]`;

/** The exact canonical compilation from §1. */
const CANONICAL_EXAMPLE = `:::::columns
::::column
## Tier I

:::item[Reinforced Bulkheads]{price="30 Energy" level="1"}
The Fortitude DC of the base camp increases by **+2**.
:::
::::
::::column
## Tier 2

:::item[Alarm Wards]{price="35 Energy"}
Stealth checks to infiltrate suffer a **-2** penalty.
:::
::::
:::::`;

describe("compileVss — worked example (§1)", () => {
  test("compiles to the exact canonical string (explicit :::column, 5/4/3)", () => {
    expect(compileVss(VSS_EXAMPLE)).toBe(CANONICAL_EXAMPLE);
  });

  test("round-trips: parseDocument(compileVss(x)) yields the intended model", () => {
    const doc = parseDocument(compileVss(VSS_EXAMPLE));
    expect(doc.nodes).toHaveLength(1);
    const cols = doc.nodes[0]!;
    expect(cols.type).toBe("columns");
    if (cols.type !== "columns") return;
    expect(cols.columns).toHaveLength(2);

    // Left column: a prose run (the heading) then an item block.
    const left = cols.columns[0]!;
    expect(left.map((n) => n.type)).toEqual(["prose", "block"]);
    const leftItem = asBlock(left[1]);
    expect(leftItem.kind).toBe("item");
    expect(leftItem.label).toBe("Reinforced Bulkheads");
    expect(leftItem.attributes.price).toBe("30 Energy");
    expect(leftItem.attributes.level).toBe("1");
    expect(collectText(leftItem.children)).toContain("Fortitude DC");

    // Right column: heading + item with only a price attribute.
    const right = cols.columns[1]!;
    const rightItem = asBlock(right[1]);
    expect(rightItem.label).toBe("Alarm Wards");
    expect(rightItem.attributes.price).toBe("35 Energy");
    expect(rightItem.attributes.level).toBeUndefined();
  });

  test("is idempotent", () => {
    const once = compileVss(VSS_EXAMPLE);
    expect(compileVss(once)).toBe(once);
  });
});

describe("compileVss — single block forms", () => {
  test("a bare block with no attrs", () => {
    const src = `@statblock "Goblin" {\nA small menace.\n}`;
    expect(compileVss(src)).toBe(`:::statblock[Goblin]\nA small menace.\n:::`);
  });

  test("attributes: traits split-trim, duplicate last-wins, empty dropped", () => {
    const src = [
      '@item "Sword"',
      "| traits: a,  b , c",
      "| level: ",
      "| level: 3",
      "{",
      "  body",
      "}",
    ].join("\n");
    expect(compileVss(src)).toBe(
      ':::item[Sword]{traits="a,b,c" level="3"}\nbody\n:::',
    );
  });

  test("title with brackets is escaped so the label can't close early", () => {
    const src = `@item "Look [Behind] You" {\nx\n}`;
    expect(compileVss(src)).toContain(":::item[Look \\[Behind\\] You]");
    // and it round-trips to the literal title
    const block = asBlock(parseDocument(compileVss(src)).nodes[0]);
    expect(block.label).toBe("Look [Behind] You");
  });
});

describe("compileVss — auto colon depth", () => {
  test("nested @columns inside a column bumps the fence depth", () => {
    const src = [
      "@columns [",
      "  {",
      "    @columns [",
      "      {",
      '        @item "Inner" {',
      "          deep",
      "        }",
      "      }",
      "    ]",
      "  }",
      "]",
    ].join("\n");
    const out = compileVss(src);
    expect(out).toContain(":::::::columns"); // outer columns = 7
    expect(out).toContain("::::::column"); // outer column = 6
    expect(out).toContain(":::::columns"); // inner columns = 5
    expect(out).toContain("::::column"); // inner column = 4
    expect(out).toContain(":::item[Inner]"); // item = 3
    // round-trips to two nested columns
    expect(() => parseDocument(out)).not.toThrow();
  });
});

describe("compileVss — brace matching (§5)", () => {
  test("balanced braces in prose nest correctly (don't mis-close)", () => {
    const src = `@item "Keys" {\npress {the} key combo\n}`;
    const out = compileVss(src);
    expect(out).toContain("press {the} key combo");
    expect(out).toContain(":::item[Keys]");
  });

  test("a lone literal brace must be escaped to survive", () => {
    const src = `@item "Keys" {\npress the \\} key\n}`;
    const out = compileVss(src);
    expect(out).toContain("press the \\} key");
    expect(out.endsWith(":::")).toBe(true);
  });

  test("braces inside inline code spans are ignored", () => {
    const src = "@item \"Code\" {\nuse `{` and `}` and ``a ` b`` here\n}";
    const out = compileVss(src);
    expect(out).toContain("use `{` and `}`");
    expect(out.endsWith(":::")).toBe(true);
  });

  test("a tilde fence may contain ``` without closing; braces inside ignored", () => {
    const src = [
      '@item "Fence" {',
      "~~~",
      "```",
      "a } brace { in code",
      "~~~",
      "after",
      "}",
    ].join("\n");
    const out = compileVss(src);
    expect(out).toContain("a } brace { in code");
    expect(out).toContain("after");
  });

  test("escapes \\{ and \\} are literal and kept escaped in the body", () => {
    const src = `@item "Esc" {\nliteral \\{ and \\} survive\n}`;
    const out = compileVss(src);
    expect(out).toContain("literal \\{ and \\} survive");
  });

  test("4-space indented code with braces is the documented unsupported case", () => {
    // A `}` in 4-space indented code DOES close the body early (limitation).
    const src = `@item "Indent" {\ntext\n    a } brace\nmore\n}`;
    const out = compileVss(src);
    // The body closed at the indented `}`, so "more" falls outside the block.
    expect(() => parseDocument(out)).not.toThrow();
    expect(out).toContain(":::item[Indent]");
  });
});

describe("compileVss — error model (§6), totality", () => {
  test("E1: @kind with no quoted title", () => {
    expect(compileVss(`@item\nnext`)).toContain(':vsserr[@item: expected "title"]');
  });

  test("E2: @kind \"X\" with no body", () => {
    expect(compileVss(`@item "X"\n# heading`)).toContain(
      ':vsserr[@item "X": missing { body }]',
    );
  });

  test("E3: unterminated body still renders its text", () => {
    const out = compileVss(`@item "X" {\nbody runs to EOF`);
    expect(out).toContain(':vsserr[@item "X": unterminated body]');
    expect(out).toContain("body runs to EOF");
  });

  test("E4: @columns not followed by [", () => {
    expect(compileVss(`@columns nope`)).toContain(
      ":vsserr[@columns: missing opening bracket]",
    );
  });

  test("E5: unterminated @columns [ compiles groups found so far", () => {
    const out = compileVss(`@columns [\n  { a }\n  { b }`);
    expect(out).toContain(":vsserr[@columns: unterminated column list]");
    expect(out).toContain("column");
  });

  test("E7: unknown @kind passes through as literal text", () => {
    expect(compileVss(`@monster "X" {\nx\n}`)).toBe(`@monster "X" {\nx\n}`);
  });

  test("E10: a second quoted string before the body", () => {
    expect(compileVss(`@item "A" "B" {\nx\n}`)).toContain(
      ':vsserr[@item: unexpected "B"]',
    );
  });

  test("E12: an attribute value with a forbidden char is rejected (chip + drop)", () => {
    const out = compileVss(`@item "X"\n| bad: has " quote\n| ok: fine\n{\nx\n}`);
    expect(out).toContain(
      ":vsserr[@item: attribute 'bad' has an unsupported character]",
    );
    expect(out).toContain('ok="fine"'); // other attrs still emitted
    expect(out).not.toContain('bad=');
  });

  test("E13: nesting past the cap stops recursing without throwing", () => {
    // 20 nested blocks > cap (16).
    const open = Array.from({ length: 20 }, (_, i) => `@item "L${i}" {`).join("\n");
    const close = Array.from({ length: 20 }, () => "}").join("\n");
    const out = compileVss(`${open}\nx\n${close}`);
    expect(out).toContain(":vsserr[too deeply nested]");
    expect(() => parseDocument(out)).not.toThrow();
  });

  test("E14: a bare ::: fence inside a VSS body is rejected", () => {
    const out = compileVss(`@item "X" {\n:::statblock[Y]\nz\n:::\n}`);
    expect(out).toContain(":vsserr[nested ::: not allowed in a VSS body]");
  });

  test("error reasons are sanitized (a title with ] doesn't break the chip)", () => {
    // An unterminated body whose title carries a `]` — the reason escapes it so
    // the `]` can't close the `[reason]` label early, and the chip still renders.
    const out = compileVss(`@item "Bra]cket" {\nrun to eof`);
    expect(out).toContain(":vsserr[@item \"Bra\\]cket\": unterminated body]");
    const doc = parseDocument(out); // must not break the directive
    expect(collectText(doc.nodes.flatMap((n) => (n.type === "prose" ? n.children : []))))
      .toContain("Bra]cket");
  });

  test("never throws on a malformed-VSS fuzz corpus", () => {
    const corpus = [
      "@columns [ { { { ",
      '@item "',
      "@item \"x\" { ".repeat(40),
      "} ] } ] @columns",
      "@spell #$%^&*",
      "@columns [\n]",
      "@item \"a\" |k:v |k2 { } extra",
      "```\n@item \"x\" {\n```",
    ];
    for (const src of corpus) {
      expect(() => compileVss(src)).not.toThrow();
      expect(() => parseDocument(compileVss(src))).not.toThrow();
    }
  });
});

describe("compileVss — no-op guarantee (goldens must not move)", () => {
  test("is byte-identical on every visual fixture (no VSS used)", () => {
    for (const fixture of FIXTURES) {
      expect(compileVss(fixture.source)).toBe(fixture.source);
    }
  });

  test("is a no-op on canonical + sigil source", () => {
    const src =
      ':::statblock[Goblin]{level="Creature 1"}\nStrike :action[1]. A #fire foe.\n:::';
    expect(compileVss(src)).toBe(src);
  });
});
