import { describe, expect, test } from "bun:test";
import { desugar } from "./surface.ts";
import { FIXTURES } from "../../test/visual/fixtures.ts";

describe("desugar (surface sigils)", () => {
  test("@action expands to :action[…] for known tokens", () => {
    expect(desugar("Strike @2 then @reaction and @free.")).toBe(
      "Strike :action[2] then :action[reaction] and :action[free].",
    );
    expect(desugar("Quick @r @f @3")).toBe(
      "Quick :action[r] :action[f] :action[3]",
    );
  });

  test("||text|| expands to :redact[…] (multi-word, no brackets)", () => {
    expect(desugar("the password is ||ashes to ashes||")).toBe(
      "the password is :redact[ashes to ashes]",
    );
  });

  test("#name expands to :trait[name]", () => {
    expect(desugar("a #fire #evocation spell")).toBe(
      "a :trait[fire] :trait[evocation] spell",
    );
  });

  test("scoping: ordinary prose never false-triggers", () => {
    const prose = [
      "# Heading and ## Actions stay headings",
      "email me@example.com, C# code, issue #123, @everyone at @dawn",
      "deals 2d6 @2d6 damage", // @2 not split out of a word
    ].join("\n");
    expect(desugar(prose)).toBe(prose); // unchanged
  });

  test("is a no-op on canonical directive syntax", () => {
    const canonical =
      ':::statblock[Goblin]{level="Creature 1" traits="undead"}\n' +
      "Strike :action[1]. A :trait[fire] foe. ||not redact|| — wait, that IS\n:::";
    // canonical directives are untouched; only the literal `||…||` converts
    expect(desugar(":::statblock[Goblin]{level=\"Creature 1\"}\nStrike :action[1].\n:::")).toBe(
      ':::statblock[Goblin]{level="Creature 1"}\nStrike :action[1].\n:::',
    );
    expect(canonical).toContain(":action[1]"); // (sanity on the fixture string)
  });

  // The load-bearing guarantee: desugar must not alter any golden fixture's
  // source, or the visual-regression baselines would silently drift.
  test("is a no-op on every visual fixture (goldens must not move)", () => {
    for (const fixture of FIXTURES) {
      expect(desugar(fixture.source)).toBe(fixture.source);
    }
  });
});
