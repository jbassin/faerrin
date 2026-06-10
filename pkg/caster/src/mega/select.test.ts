import { test, expect, describe } from "bun:test";
import type { Session } from "../types.ts";
import { dateInRange, selectMembers, megaId } from "./select.ts";

/** A minimal Session for selection tests (turns are irrelevant here). */
function session(id: string, arc: string, date: string): Session {
  return { id, arc, isMain: true, date, path: `${id}.txt`, turns: [] };
}

const corpus: Session[] = [
  session("000.through-a-song-darkly.2026-5-7", "through-a-song-darkly", "2026-5-7"),
  session("000.through-a-song-darkly.2026-5-11", "through-a-song-darkly", "2026-5-11"),
  session("000.through-a-song-darkly.2026-5-25", "through-a-song-darkly", "2026-5-25"),
  session("000.through-a-song-darkly.2026-6-8", "through-a-song-darkly", "2026-6-8"),
  session("105.observatory-slipped.2026-5-20", "observatory-slipped", "2026-5-20"),
];

describe("dateInRange", () => {
  test("is inclusive at both ends and date-aware (not lexical)", () => {
    expect(dateInRange("2026-5-7", "2026-5-7", "2026-6-8")).toBe(true); // lower bound
    expect(dateInRange("2026-6-8", "2026-5-7", "2026-6-8")).toBe(true); // upper bound
    expect(dateInRange("2026-5-6", "2026-5-7", "2026-6-8")).toBe(false);
    expect(dateInRange("2026-6-9", "2026-5-7", "2026-6-8")).toBe(false);
    // "11" must sort after "7" numerically, not lexically before it.
    expect(dateInRange("2026-5-11", "2026-5-8", "2026-5-25")).toBe(true);
  });
});

describe("selectMembers", () => {
  test("picks in-range sessions of one arc, chronologically", () => {
    const picked = selectMembers(corpus, {
      from: "2026-5-7",
      to: "2026-6-8",
      arc: "through-a-song-darkly",
    });
    expect(picked.map((s) => s.date)).toEqual(["2026-5-7", "2026-5-11", "2026-5-25", "2026-6-8"]);
  });

  test("an out-of-order corpus is still returned chronologically", () => {
    const shuffled = [corpus[3]!, corpus[0]!, corpus[2]!, corpus[1]!];
    const picked = selectMembers(shuffled, {
      from: "2026-5-7",
      to: "2026-6-8",
      arc: "through-a-song-darkly",
    });
    expect(picked.map((s) => s.date)).toEqual(["2026-5-7", "2026-5-11", "2026-5-25", "2026-6-8"]);
  });

  test("throws when the range crosses arcs without an explicit --arc", () => {
    expect(() => selectMembers(corpus, { from: "2026-5-7", to: "2026-6-8" })).toThrow(
      /multiple arcs/,
    );
  });

  test("an explicit arc disambiguates a cross-arc range", () => {
    const picked = selectMembers(corpus, {
      from: "2026-5-7",
      to: "2026-6-8",
      arc: "observatory-slipped",
    });
    expect(picked.map((s) => s.id)).toEqual(["105.observatory-slipped.2026-5-20"]);
  });

  test("throws on an empty range and on no matches", () => {
    expect(() => selectMembers(corpus, { from: "2026-6-8", to: "2026-5-7" })).toThrow(/Empty range/);
    expect(() => selectMembers(corpus, { from: "2027-1-1", to: "2027-2-1" })).toThrow(/No sessions/);
  });
});

describe("megaId", () => {
  test("derives <arc>.<slug>.<last>-recap-of-<first> from the covered span", () => {
    const picked = selectMembers(corpus, {
      from: "2026-5-7",
      to: "2026-6-8",
      arc: "through-a-song-darkly",
    });
    expect(megaId(picked)).toBe("000.through-a-song-darkly.2026-6-8-recap-of-2026-5-7");
  });

  test("the id's leading dot-segments mirror a real session id (face parses arc/slug)", () => {
    const id = megaId(
      selectMembers(corpus, { from: "2026-5-7", to: "2026-6-8", arc: "through-a-song-darkly" }),
    );
    const parts = id.split(".");
    expect(parts[0]).toBe("000"); // arc number
    expect(parts[1]).toBe("through-a-song-darkly"); // slug → pretty arc title in face
    // Date token leads with the LAST date (numeric first three groups) → face's
    // dateKey parses it AND sorts the recap to the end of its arc.
    const [y, m, d] = parts[2]!.split("-");
    expect([Number(y), Number(m), Number(d)]).toEqual([2026, 6, 8]);
  });

  test("uses the actual member span, not the requested range bounds", () => {
    // Request a wide window; the id reflects only the sessions that exist in it.
    const picked = selectMembers(corpus, {
      from: "2026-1-1",
      to: "2026-12-31",
      arc: "through-a-song-darkly",
    });
    expect(megaId(picked)).toBe("000.through-a-song-darkly.2026-6-8-recap-of-2026-5-7");
  });
});
