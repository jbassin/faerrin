import { describe, expect, test } from "bun:test";

import { type DeviceShape, type GridData, coloredTagsPresent, layout, roleAt, tracksForTag } from "../src/grid";
import type { Collection, Tag, Track } from "../src/lark/types";
import { enterCollection, enterTag, rootNav, withPage } from "../src/nav";

const XL: DeviceShape = { columns: 8, rows: 4 }; // 32 keys
const STD: DeviceShape = { columns: 5, rows: 3 }; // 15 keys

function mkCollection(id: number, name: string): Collection {
	return { id, name, slug: name.toLowerCase(), ip_or_game: null };
}
function mkTag(id: number, name: string, color: string | null): Tag {
	return { id, name, category: null, color };
}
function mkTrack(id: number, title: string, tags: Tag[]): Track {
	return { id, collection_id: 1, title, original_title: title, status: "ready", duration_ms: 100000, loudness_lufs: null, tags };
}

function many<T>(n: number, f: (i: number) => T): T[] {
	return Array.from({ length: n }, (_, i) => f(i));
}

const boss = mkTag(3, "Boss", "#c8504a");
const ambient = mkTag(9, "Ambient", "#4aa6a0");
const uncolored = mkTag(20, "misc", null);

describe("layout — root", () => {
	const data: GridData = { collections: [mkCollection(1, "A"), mkCollection(2, "B"), mkCollection(3, "C")], tags: [], tracks: [] };

	test("collections fill from key 0, rest empty", () => {
		const grid = layout(rootNav(), XL, data);
		expect(grid.length).toBe(32);
		expect(roleAt(grid, { column: 0, row: 0 }, XL)).toEqual({ kind: "collection", id: 1, name: "A" });
		expect(roleAt(grid, { column: 2, row: 0 }, XL)).toEqual({ kind: "collection", id: 3, name: "C" });
		expect(roleAt(grid, { column: 3, row: 0 }, XL)).toEqual({ kind: "empty" });
	});

	test("overflow reserves last two keys as pagers", () => {
		const big: GridData = { collections: many(40, (i) => mkCollection(i + 1, `c${i}`)), tags: [], tracks: [] };
		const p0 = layout(rootNav(), XL, big);
		expect(p0[30]).toEqual({ kind: "empty" }); // no prev on page 0
		expect(p0[31]).toEqual({ kind: "pageNext" });
		// 30 items per page → page 1 shows the remainder and a prev pager
		const p1 = layout(withPage(rootNav(), 1), XL, big);
		expect(p1[30]).toEqual({ kind: "pagePrev" });
		expect(p1[0]).toEqual({ kind: "collection", id: 31, name: "c30" });
	});
});

describe("layout — collection", () => {
	const data: GridData = { collections: [], tags: [boss, ambient], tracks: [] };

	test("key 0 is Back; tags follow", () => {
		const grid = layout(enterCollection(1, "X"), XL, data);
		expect(roleAt(grid, { column: 0, row: 0 }, XL)).toEqual({ kind: "back" });
		expect(roleAt(grid, { column: 1, row: 0 }, XL)).toEqual({ kind: "tag", id: 3, name: "Boss", color: "#c8504a" });
		expect(roleAt(grid, { column: 2, row: 0 }, XL)).toEqual({ kind: "tag", id: 9, name: "Ambient", color: "#4aa6a0" });
	});
});

describe("layout — tag (tracks left, nav right)", () => {
	const tracks = [mkTrack(100, "T1", [boss]), mkTrack(101, "T2", [boss, ambient]), mkTrack(102, "T3", [ambient])];
	const data: GridData = { collections: [], tags: [boss, ambient], tracks };
	const nav = enterTag(enterCollection(1, "X"), 3, "Boss");

	test("rightmost column is the nav column: Back on top, sibling tags below", () => {
		const grid = layout(nav, XL, data);
		// last column (col 7): row0 = back, row1 = navTag, ...
		expect(roleAt(grid, { column: 7, row: 0 }, XL)).toEqual({ kind: "back" });
		expect(roleAt(grid, { column: 7, row: 1 }, XL)).toMatchObject({ kind: "navTag", id: 3, active: true });
		expect(roleAt(grid, { column: 7, row: 2 }, XL)).toMatchObject({ kind: "navTag", id: 9, active: false });
	});

	test("left region holds only tracks carrying the active tag", () => {
		const grid = layout(nav, XL, data);
		// Boss tag → tracks 100 and 101 (not 102 which is ambient-only)
		expect(roleAt(grid, { column: 0, row: 0 }, XL)).toEqual({ kind: "track", id: 100, title: "T1" });
		expect(roleAt(grid, { column: 1, row: 0 }, XL)).toEqual({ kind: "track", id: 101, title: "T2" });
		expect(roleAt(grid, { column: 2, row: 0 }, XL)).toEqual({ kind: "empty" });
	});

	test("works on a 15-key standard deck too", () => {
		const grid = layout(nav, STD, data);
		expect(grid.length).toBe(15);
		// last column (col 4): row0 = back
		expect(roleAt(grid, { column: 4, row: 0 }, STD)).toEqual({ kind: "back" });
		// left region col 0 row 0 = first Boss track
		expect(roleAt(grid, { column: 0, row: 0 }, STD)).toEqual({ kind: "track", id: 100, title: "T1" });
	});
});

describe("data helpers", () => {
	test("tracksForTag filters by membership", () => {
		const tracks = [mkTrack(1, "a", [boss]), mkTrack(2, "b", [ambient])];
		expect(tracksForTag(tracks, 3).map((t) => t.id)).toEqual([1]);
	});

	test("coloredTagsPresent dedupes, drops uncolored, sorts by name", () => {
		const tracks = [mkTrack(1, "a", [boss, uncolored]), mkTrack(2, "b", [ambient, boss])];
		expect(coloredTagsPresent(tracks).map((t) => t.name)).toEqual(["Ambient", "Boss"]);
	});
});
