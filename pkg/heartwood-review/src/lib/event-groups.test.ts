import { describe, expect, it } from "vitest";
import { groupProposalsByEvent } from "./event-groups.ts";

const p = (id: string, spans: [number, number][], transcript = "t.txt") => ({
  id,
  facts: [
    { citations: spans.map(([start, end]) => ({ transcript, start, end })) },
  ],
});

describe("groupProposalsByEvent (AC-22)", () => {
  it("groups proposals whose citations overlap", () => {
    const groups = groupProposalsByEvent([
      p("a", [[100, 110]]),
      p("b", [[105, 120]]),
      p("c", [[500, 510]]),
    ]);
    const sorted = groups.map((g) => g.sort()).sort();
    expect(sorted).toEqual([["a", "b"], ["c"]]);
  });

  it("links via the proximity gap (nearby but non-overlapping)", () => {
    // 110 and 118 are 8 apart — within the default gap of 15.
    const groups = groupProposalsByEvent([
      p("a", [[100, 110]]),
      p("b", [[118, 130]]),
    ]);
    expect(groups.length).toBe(1);
  });

  it("does not group across different transcripts", () => {
    const groups = groupProposalsByEvent([
      p("a", [[100, 110]], "x.txt"),
      p("b", [[100, 110]], "y.txt"),
    ]);
    expect(groups.length).toBe(2);
  });

  it("chains transitively (a–b, b–c ⇒ one group)", () => {
    const groups = groupProposalsByEvent([
      p("a", [[100, 110]]),
      p("b", [[108, 120]]),
      p("c", [[119, 130]]),
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0]!.sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps distant proposals as singletons", () => {
    const groups = groupProposalsByEvent([
      p("a", [[10, 20]]),
      p("b", [[900, 910]]),
    ]);
    expect(groups.length).toBe(2);
  });
});
