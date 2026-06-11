import { describe, expect, test } from "bun:test";
import { groupByColor, hexToRgba, homeColoredTag } from "../src/web/grouping";
import type { Tag, Track } from "../src/web/types";

function tag(id: number, name: string, color: string | null = null): Tag {
  return { id, name, category: null, color };
}

function track(id: number, title: string, tags: Tag[]): Track {
  return {
    id,
    collection_id: null,
    title,
    original_title: title,
    status: "ready",
    duration_ms: null,
    loudness_lufs: null,
    tags,
  };
}

describe("homeColoredTag", () => {
  test("ignores uncolored tags", () => {
    expect(homeColoredTag(track(1, "x", [tag(1, "calm")]))).toBeNull();
  });

  test("picks the alphabetically-first colored tag", () => {
    const t = track(1, "Ark", [tag(2, "epic", "#9a6fc8"), tag(3, "battle", "#c8504a"), tag(4, "loud")]);
    expect(homeColoredTag(t)?.name).toBe("battle");
  });
});

describe("groupByColor", () => {
  test("single-home: a multi-colored track appears once, under its home", () => {
    const t = track(1, "Ark", [tag(2, "epic", "#9a6fc8"), tag(3, "battle", "#c8504a")]);
    const sections = groupByColor([t]);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.label).toBe("battle");
    expect(sections[0]!.tracks).toHaveLength(1);
  });

  test("colored sections sort by name; Other is always last", () => {
    const a = track(1, "A", [tag(10, "teal-zed", "#4aa6a0")]);
    const b = track(2, "B", [tag(11, "amber-ay", "#c8a24a")]);
    const c = track(3, "C", [tag(12, "calm")]); // uncolored → Other
    const sections = groupByColor([a, b, c]);
    expect(sections.map((s) => s.label)).toEqual(["amber-ay", "teal-zed", "Other"]);
  });

  test("empty input yields no sections", () => {
    expect(groupByColor([])).toEqual([]);
  });
});

describe("hexToRgba", () => {
  test("converts #rrggbb with alpha", () => {
    expect(hexToRgba("#4a7fc8", 0.13)).toBe("rgba(74, 127, 200, 0.13)");
  });
  test("passes through non-hex untouched", () => {
    expect(hexToRgba("teal", 0.13)).toBe("teal");
  });
});
