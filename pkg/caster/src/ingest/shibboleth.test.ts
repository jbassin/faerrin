import { test, expect, describe } from "bun:test";
import type { Shibboleth } from "../types.ts";
import {
  buildArcTitles,
  buildMainArcs,
  buildSpeakerIndex,
} from "./shibboleth.ts";

const FIXTURE: Shibboleth = {
  "Through a Song, Darkly": {
    isMain: true,
    roles: {
      Josh: [{ name: "Gamemaster", desc: ["the gm"] }],
      Jorge: [
        { name: "Argyle", desc: ["celestial"] },
        { name: "Arctos", desc: ["a bear"] },
      ],
      Mike: [{ name: "Benny", desc: ["an android"] }],
    },
  },
  "Fey in the Mists": {
    isMain: false,
    roles: {
      Tanner: [{ name: "Gamemaster", desc: ["the gm"] }],
      Josh: [{ name: "Mango", desc: ["a ranger"] }],
    },
  },
};

describe("buildSpeakerIndex", () => {
  const index = buildSpeakerIndex(FIXTURE);

  test("keys arcs by slug", () => {
    expect([...index.keys()].sort()).toEqual([
      "fey-in-the-mists",
      "through-a-song-darkly",
    ]);
  });

  test("resolves a character to its player and player role", () => {
    const arc = index.get("through-a-song-darkly")!;
    expect(arc.get("Benny")).toEqual({
      player: "Mike",
      role: "player",
      desc: ["an android"],
    });
  });

  test("marks the Gamemaster label as the gm role", () => {
    expect(index.get("through-a-song-darkly")!.get("Gamemaster")?.role).toBe("gm");
  });

  test("handles a player with multiple characters", () => {
    const arc = index.get("through-a-song-darkly")!;
    expect(arc.get("Argyle")?.player).toBe("Jorge");
    expect(arc.get("Arctos")?.player).toBe("Jorge");
  });

  test("attributes the GM per-arc (Tanner is GM in Fey in the Mists)", () => {
    const arc = index.get("fey-in-the-mists")!;
    expect(arc.get("Gamemaster")).toEqual({
      player: "Tanner",
      role: "gm",
      desc: ["the gm"],
    });
  });
});

describe("arc metadata", () => {
  test("buildArcTitles maps slug -> prose title", () => {
    const titles = buildArcTitles(FIXTURE);
    expect(titles.get("through-a-song-darkly")).toBe("Through a Song, Darkly");
  });

  test("buildMainArcs collects only isMain arcs", () => {
    const main = buildMainArcs(FIXTURE);
    expect(main.has("through-a-song-darkly")).toBe(true);
    expect(main.has("fey-in-the-mists")).toBe(false);
  });
});
