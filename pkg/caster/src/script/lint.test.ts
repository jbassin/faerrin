import { test, expect, describe } from "bun:test";
import type { Script, ScriptTurn } from "../types.ts";
import { DEFAULT_HOSTS } from "./hosts.ts";
import { computeMetrics, scoreScript, words } from "./lint.ts";

function script(turns: ScriptTurn[]): Script {
  return { sessionId: "t", title: "T", hosts: DEFAULT_HOSTS, turns };
}

// A deliberately "podcasty" episode: uniform, clean, complete sentences that
// recite the recap in order and announce their own agenda; no room, no fumbles.
const podcasty = script([
  { speaker: "A", text: "Welcome back to the show, everyone, we have a great session to talk about today." },
  { speaker: "B", text: "It was a really eventful evening with a lot of important developments for the party." },
  { speaker: "C", text: "I think the most interesting question is why the characters made the choices they did." },
  { speaker: "A", text: "They entered the grand gala aboard the floating vessel and met the assembled delegations." },
  { speaker: "B", text: "The master of ceremonies announced that the vessel extracts a tithe from every heart." },
  { speaker: "C", text: "That raises the stakes considerably for everyone who happens to be aboard the vessel." },
  { speaker: "A", text: "Moving on, the party then discovered a portal that led into a collapsing ballroom." },
  { speaker: "B", text: "They recovered an artifact known as the Voidheart from within that nightmare space." },
  { speaker: "C", text: "The decision to leap into the portal was certainly a bold and risky tactical choice." },
  { speaker: "A", text: "They also brought back a large creature that they encountered inside the ruined ballroom." },
  { speaker: "B", text: "It will be interesting to see how that creature factors into the coming sessions." },
  { speaker: "C", text: "Before we wrap, let us briefly recap the major beats from this eventful session." },
]);

// A deliberately "tavern" episode: uneven turns, interruptions, dropped threads,
// a dead-end tangent, room/sensory grounding, no agenda announcements.
const tavern = script([
  { speaker: "A", text: "[excited] Okay so they walk into the gala and immediately, IMMEDIATELY, the whole barghest thing kicks off and there's a portal and a hand-monster and honestly I lost the thread of who grabbed what—" },
  { speaker: "B", text: "The Voidheart." },
  { speaker: "C", text: "Right but WHY—" },
  { speaker: "A", text: "—and then the tithe, the heart-tithe, which, hang on—" },
  { speaker: "B", text: "It tithes everyone. No opt out." },
  { speaker: "C", text: "[chuckles] My cousin had a goat that—" },
  { speaker: "B", text: "It is not like the goat." },
  { speaker: "C", text: "...it's a little like the goat." },
  { speaker: "A", text: "Anyway. Pass me that mug, the foam is going flat by the fire." },
  { speaker: "B", text: "Barkeep!" },
  { speaker: "C", text: "No— wait— what did the secretary actually do?" },
  { speaker: "A", text: "Honestly? You had to be there. [sips ale]" },
]);

describe("tavern-ness linter", () => {
  test("words() strips audio tags and non-spoken punctuation", () => {
    expect(words("[excited] Hey — you OK? [laughs]")).toEqual(["hey", "you", "ok"]);
  });

  test("podcasty script scores low and flags mechanical zeros", () => {
    const r = scoreScript(podcasty);
    expect(r.mechanicalSubtotal).toBeLessThan(6);
    expect(r.zeros.length).toBeGreaterThan(0);
    // The structural tells are present, so those criteria bottom out.
    expect(r.zeros).toContain("R3"); // recites an agenda
    expect(r.zeros).toContain("R5"); // featureless void
  });

  test("tavern script scores high and clears the structural tells", () => {
    const r = scoreScript(tavern);
    expect(r.mechanicalSubtotal).toBeGreaterThanOrEqual(9);
    expect(r.zeros).not.toContain("R3"); // no meta-recap
    expect(r.zeros).not.toContain("R4"); // has disfluencies
    expect(r.zeros).not.toContain("R5"); // has room references
  });

  test("tavern beats podcasty on every structural axis", () => {
    const p = computeMetrics(podcasty);
    const t = computeMetrics(tavern);
    expect(t.metaRecapRatio).toBeLessThan(p.metaRecapRatio);
    expect(t.disfluencyRatio).toBeGreaterThan(p.disfluencyRatio);
    expect(t.roomReferences).toBeGreaterThan(p.roomReferences);
    expect(t.turnLengthStdev).toBeGreaterThan(p.turnLengthStdev);
    expect(t.cleanLineRatio).toBeLessThan(p.cleanLineRatio);
  });

  test("an empty-ish script doesn't throw and scores zero-ish", () => {
    const r = scoreScript(script([{ speaker: "A", text: "Hi." }]));
    expect(r.metrics.turns).toBe(1);
    expect(r.mechanicalSubtotal).toBeGreaterThanOrEqual(0);
  });
});
