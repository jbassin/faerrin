import { describe, expect, test } from "bun:test";
import { canonicalToVss, vssToCanonical } from "./format.ts";
import { compileVss } from "./vss.ts";
import { parseDocument } from "./parse.ts";
import { FIXTURES } from "../../test/visual/fixtures.ts";

/** Deep-clone a parsed document with mdast `position` data removed, so two
 * parses of differently-formatted sources can be compared structurally. */
function strip(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(strip);
  if (x && typeof x === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) {
      if (k !== "position") out[k] = strip(v);
    }
    return out;
  }
  return x;
}

/** The load-bearing property: converting must not change the parsed model. */
function expectModelEqual(canonical: string) {
  const converted = canonicalToVss(canonical);
  expect(strip(parseDocument(converted))).toEqual(strip(parseDocument(canonical)));
  return converted;
}

describe("canonicalToVss — blocks", () => {
  test("converts a labeled, attributed block to the exact VSS form", () => {
    const src = [
      ':::statblock[Goblin Warrior]{level="Creature 1" traits="agile,goblin"}',
      "A small menace. Strikes with :action[1] then retreats.",
      ":::",
    ].join("\n");
    expect(canonicalToVss(src)).toBe(
      [
        '@statblock "Goblin Warrior"',
        "| level: Creature 1",
        "| traits: agile,goblin",
        "{",
        "A small menace. Strikes with :action[1] then retreats.",
        "}",
      ].join("\n"),
    );
    expectModelEqual(src);
  });

  test("a label-less block becomes an empty quoted title (model-equal)", () => {
    const converted = expectModelEqual(":::item\njust a body\n:::");
    expect(converted).toContain('@item ""');
  });

  test("unquoted attr values and titles with escapes survive", () => {
    const src = ':::item[Look \\[Out\\]]{level=3}\nx\n:::';
    const converted = expectModelEqual(src);
    expect(converted).toContain('@item "Look [Out]"');
    expect(converted).toContain("| level: 3");
  });

  test("surrounding prose is untouched; only the construct converts", () => {
    const src = "# Brief\n\n:::handout[Orders]\nThe bridge is out.\n:::\n\nAfter.";
    const converted = expectModelEqual(src);
    expect(converted).toContain("# Brief");
    expect(converted).toContain('@handout "Orders"');
    expect(converted).toContain("After.");
  });

  test("bare braces in a converted body are escaped (and render the same)", () => {
    const src = ":::handout[Keys]\npress the } key and the { key\n:::";
    const converted = expectModelEqual(src);
    expect(converted).toContain("press the \\} key and the \\{ key");
  });

  test("braces inside inline code and fenced code stay unescaped", () => {
    const src = [
      ":::item[Code]",
      "use `{` in a span",
      "```",
      "a { raw } block",
      "```",
      ":::",
    ].join("\n");
    const converted = canonicalToVss(src);
    expect(converted).toContain("use `{`");
    expect(converted).toContain("a { raw } block");
    expect(converted).not.toContain("\\{ raw");
  });
});

describe("canonicalToVss — columns", () => {
  test("--- divider style converts (the parse.test regression layout)", () => {
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
    const converted = expectModelEqual(src);
    expect(converted).toContain("@columns [");
    expect(converted).toContain('@item "A"');
    expect(converted).toContain('@item "B"');
    expect(converted).toContain("## Right");
  });

  test("explicit :::column style converts", () => {
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
    const converted = expectModelEqual(src);
    expect(converted).toContain("@columns [");
    expect(converted).toContain('@handout "Note"');
  });

  test("the §1 worked example survives canonical → VSS → canonical", () => {
    const canonical = compileVss(
      [
        "@columns [",
        "  {",
        "    ## Tier I",
        '    @item "Reinforced Bulkheads"',
        "    | price: 30 Energy",
        "    {",
        "      The DC increases by **+2**.",
        "    }",
        "  }",
        "  {",
        "    ## Tier 2",
        "    plain prose column",
        "  }",
        "]",
      ].join("\n"),
    );
    const vss = expectModelEqual(canonical);
    // …and compiling the converted form lands on the same model again.
    expect(strip(parseDocument(compileVss(vss)))).toEqual(
      strip(parseDocument(canonical)),
    );
  });
});

describe("canonicalToVss — conservative bails (stay canonical)", () => {
  const bails: [string, string][] = [
    ["unknown directive", ":::monster[X]\nnot a kind\n:::"],
    ["unterminated block", ":::item[X]\nno closer ever"],
    ["empty attr value", ':::item[X]{level=""}\nx\n:::'],
    ["non-normal comma spacing", ':::item[X]{traits="a, b"}\nx\n:::'],
    ["id shorthand", ":::item[X]{#anchor}\nx\n:::"],
    ["columns with attributes", "::::columns{gap=wide}\nleft\n---\nright\n::::"],
    ["ambiguous setext ---", "::::columns\nsome text\n---\nmore\n::::"],
    ["*** break (also splits)", "::::columns\nleft\n\n***\n\nright\n::::"],
    [
      "brace in indented code",
      ":::item[X]\ntext\n\n    a } brace in code\n:::",
    ],
    [
      "unknown directive nested in columns",
      "::::columns\n:::monster[Y]\nz\n:::\n---\nright\n::::",
    ],
  ];
  for (const [name, src] of bails) {
    test(name, () => {
      expect(canonicalToVss(src)).toBe(src);
    });
  }
});

describe("canonicalToVss — totality & no-ops", () => {
  test("is a no-op on VSS and prose sources", () => {
    const vss = '@item "X"\n| level: 1\n{\nbody\n}';
    expect(canonicalToVss(vss)).toBe(vss);
    expect(canonicalToVss("# Just prose\n\n- list")).toBe("# Just prose\n\n- list");
    expect(canonicalToVss("")).toBe("");
  });

  test("every visual fixture converts model-equal", () => {
    for (const fixture of FIXTURES) {
      const converted = expectModelEqual(fixture.source);
      // every fixture is plain-attributed, so all should actually convert
      expect(converted).not.toBe(fixture.source);
      expect(converted).toContain("@");
    }
  });

  test("vssToCanonical is compileVss", () => {
    expect(vssToCanonical).toBe(compileVss);
  });

  test("never throws on malformed input", () => {
    const corpus = [
      ":::item[unclosed",
      ":::columns\n::::\n:::",
      "::::columns\n---\n---\n---\n::::",
      ":::item[X]{=}\nx\n:::",
      "```\n:::item[X]\n```",
      ":::item[X]\n```\nunclosed fence\n:::",
    ];
    for (const src of corpus) {
      expect(() => canonicalToVss(src)).not.toThrow();
      expect(() => parseDocument(canonicalToVss(src))).not.toThrow();
    }
  });
});
