import { test, expect, describe } from "bun:test";
import { loadCorpus, loadSessions } from "./index.ts";
import { dateSortKey, parseTranscript } from "./transcript.ts";

// Integration tests against the real content/ directory. These encode the
// Stage 1 acceptance criteria from docs §2.5.

describe("Stage 1 acceptance — real corpus", () => {
  test("parses all transcript files with no unparsed non-empty lines", async () => {
    const sessions = await loadSessions();
    expect(sessions.length).toBe(41);

    for (const session of sessions) {
      const text = await Bun.file(session.path).text();
      const nonEmpty = text.split("\n").filter((l) => l.trim() !== "").length;
      const { turns, unparsed } = parseTranscript(text);
      expect(unparsed, `unparsed lines in ${session.id}`).toEqual([]);
      expect(turns.length, `turn count in ${session.id}`).toBe(nonEmpty);
    }
  });

  test("every arc slug resolves to a shibboleth title", async () => {
    const sessions = await loadSessions();
    for (const session of sessions) {
      expect(session.arcTitle, `arc title for ${session.id}`).toBeDefined();
    }
  });

  test("known character labels resolve; the main arc is flagged", async () => {
    const sessions = await loadSessions();
    const observatory = sessions.find((s) => s.arc === "observatory-slipped");
    expect(observatory).toBeDefined();
    expect(observatory!.isMain).toBe(false);

    const foral = observatory!.turns.find((t) => t.speaker === "Foral");
    expect(foral?.player).toBe("Jorge");
    expect(foral?.role).toBe("player");

    const gm = observatory!.turns.find((t) => t.speaker === "Gamemaster");
    expect(gm?.role).toBe("gm");

    const main = sessions.find((s) => s.arc === "through-a-song-darkly");
    expect(main?.isMain).toBe(true);
  });

  test("sessions are ordered chronologically within each arc", async () => {
    const sessions = await loadSessions();
    const byArc = new Map<string, number[]>();
    for (const s of sessions) {
      const keys = byArc.get(s.arc) ?? byArc.set(s.arc, []).get(s.arc)!;
      keys.push(dateSortKey(s.date));
    }
    for (const [arc, keys] of byArc) {
      const sorted = [...keys].sort((a, b) => a - b);
      expect(keys, `chronological order within ${arc}`).toEqual(sorted);
    }
  });

  test("loads and links the wiki corpus", async () => {
    const { wiki } = await loadCorpus();
    // Wrenford links to the Verdant Expanse; the graph should resolve it.
    const wrenford = [...wiki.pages.keys()].find((p) => p.endsWith("Wrenford.md"));
    expect(wrenford).toBeDefined();
    const links = wiki.graph.get(wrenford!) ?? [];
    expect(links.some((l) => l.includes("Verdant Expanse"))).toBe(true);
  });
});
