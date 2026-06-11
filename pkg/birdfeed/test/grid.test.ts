import { describe, expect, test } from "bun:test";

import {
	type DeviceShape,
	type GridData,
	layout,
	roleAt,
	trackCapacity,
	trackCells,
	totalPages,
	tracksForSelector,
} from "../src/grid";
import type { Collection, Tag, Track } from "../src/lark/types";
import { openCollection, rootNav, selectTag, withPage } from "../src/nav";
import type { TagKey } from "../src/tags";

const XL: DeviceShape = { columns: 8, rows: 4 }; // 32 keys
const STD: DeviceShape = { columns: 5, rows: 3 }; // 15 keys

function mkCollection(id: number, name: string): Collection {
	return { id, name, slug: name.toLowerCase(), ip_or_game: null };
}
function mkTag(id: number, name: string, color: string | null): Tag {
	return { id, name, category: null, color };
}
function mkTrack(id: number, title: string, tags: Tag[]): Track {
	return { id, collection_id: 1, title, original_title: title, status: "ready", duration_ms: 1000, loudness_lufs: null, tags };
}
function many<T>(n: number, f: (i: number) => T): T[] {
	return Array.from({ length: n }, (_, i) => f(i));
}

/** A tag-page GridData with the given (already filtered) tracks + active color. */
function tagData(tracks: Track[], activeColor: string | null, resolved: TagKey[] = ["explore", "stealth", "battle", "calm", "dungeon", "other"]): GridData {
	const tagColors = new Map<TagKey, string | null>([
		["explore", "#4a7fc8"],
		["stealth", "#6b7280"],
		["other", null],
		["battle", "#c8504a"],
		["calm", "#4aa6a0"],
		["dungeon", "#9a6fc8"],
	]);
	return { collections: [], tagColors, tagResolved: new Set(resolved), tracks, activeColor };
}
const NO_DATA: GridData = tagData([], null);

describe("layout — root", () => {
	const data: GridData = { ...NO_DATA, collections: [mkCollection(1, "A"), mkCollection(2, "B")] };
	test("(0,0) reserved; collections start at key 1", () => {
		const grid = layout(rootNav(), XL, data);
		expect(roleAt(grid, { column: 0, row: 0 }, XL)).toEqual({ kind: "empty" }); // reserved in every view
		expect(roleAt(grid, { column: 1, row: 0 }, XL)).toEqual({ kind: "collection", id: 1, name: "A" });
		expect(roleAt(grid, { column: 2, row: 0 }, XL)).toEqual({ kind: "collection", id: 2, name: "B" });
		expect(roleAt(grid, { column: 3, row: 0 }, XL)).toEqual({ kind: "empty" });
	});
});

describe("layout — tag page (XL 8×4)", () => {
	const nav = openCollection(1, "X"); // default tag = calm
	const data = tagData([], "#4aa6a0");
	const grid = layout(nav, XL, data);

	test("top-left key (0,0) is reserved/blank", () => {
		expect(roleAt(grid, { column: 0, row: 0 }, XL)).toEqual({ kind: "empty" });
	});

	test("rightmost column = Back, explore, stealth, other", () => {
		expect(roleAt(grid, { column: 7, row: 0 }, XL)).toEqual({ kind: "back" });
		expect(roleAt(grid, { column: 7, row: 1 }, XL)).toMatchObject({ kind: "navTag", key: "explore", label: "Explore" });
		expect(roleAt(grid, { column: 7, row: 2 }, XL)).toMatchObject({ kind: "navTag", key: "stealth" });
		expect(roleAt(grid, { column: 7, row: 3 }, XL)).toMatchObject({ kind: "navTag", key: "other" });
	});

	test("next column = play/pause, battle, calm, dungeon (calm active by default)", () => {
		expect(roleAt(grid, { column: 6, row: 0 }, XL)).toEqual({ kind: "playPause" });
		expect(roleAt(grid, { column: 6, row: 1 }, XL)).toMatchObject({ kind: "navTag", key: "battle", active: false });
		expect(roleAt(grid, { column: 6, row: 2 }, XL)).toMatchObject({ kind: "navTag", key: "calm", active: true });
		expect(roleAt(grid, { column: 6, row: 3 }, XL)).toMatchObject({ kind: "navTag", key: "dungeon" });
	});

	test("page-control column = info, next?, prev?, stop", () => {
		expect(roleAt(grid, { column: 5, row: 0 }, XL)).toEqual({ kind: "pageInfo", page: 1, total: 1 });
		// single page → no next/prev
		expect(roleAt(grid, { column: 5, row: 1 }, XL)).toEqual({ kind: "empty" });
		expect(roleAt(grid, { column: 5, row: 2 }, XL)).toEqual({ kind: "empty" });
		expect(roleAt(grid, { column: 5, row: 3 }, XL)).toEqual({ kind: "stop" });
	});
});

describe("layout — track tiling (column-major, skips (0,0), colored)", () => {
	const tracks = many(6, (i) => mkTrack(100 + i, `T${i}`, []));
	const grid = layout(openCollection(1, "X"), XL, tagData(tracks, "#4aa6a0"));

	test("tracks tile top→bottom then left→right, starting below the reserved corner", () => {
		// (0,0) reserved → first track at (0,1), then (0,2),(0,3), then column 1 top.
		expect(roleAt(grid, { column: 0, row: 1 }, XL)).toMatchObject({ kind: "track", id: 100, color: "#4aa6a0" });
		expect(roleAt(grid, { column: 0, row: 2 }, XL)).toMatchObject({ kind: "track", id: 101 });
		expect(roleAt(grid, { column: 0, row: 3 }, XL)).toMatchObject({ kind: "track", id: 102 });
		expect(roleAt(grid, { column: 1, row: 0 }, XL)).toMatchObject({ kind: "track", id: 103 });
		expect(roleAt(grid, { column: 1, row: 1 }, XL)).toMatchObject({ kind: "track", id: 104 });
		expect(roleAt(grid, { column: 1, row: 2 }, XL)).toMatchObject({ kind: "track", id: 105 });
	});

	test("track tile carries the active tag color", () => {
		expect(roleAt(grid, { column: 0, row: 1 }, XL)).toMatchObject({ color: "#4aa6a0" });
	});
});

describe("capacity + pagination", () => {
	test("XL track capacity is 19 (5 cols × 4 rows − reserved corner)", () => {
		expect(trackCapacity(XL)).toBe(19);
		expect(trackCells(XL).length).toBe(19);
		expect(trackCells(XL)[0]).toBe(8); // (col0,row1) = 1*8+0
	});

	test("standard 5×3 capacity is 5", () => {
		expect(trackCapacity(STD)).toBe(5);
	});

	test("overflow paginates via the control column", () => {
		const tracks = many(25, (i) => mkTrack(i, `t${i}`, []));
		const p0 = layout(openCollection(1, "X"), XL, tagData(tracks, null));
		expect(roleAt(p0, { column: 5, row: 0 }, XL)).toEqual({ kind: "pageInfo", page: 1, total: 2 });
		expect(roleAt(p0, { column: 5, row: 1 }, XL)).toEqual({ kind: "pageNext" });
		expect(roleAt(p0, { column: 5, row: 2 }, XL)).toEqual({ kind: "empty" }); // no prev on page 0

		const p1 = layout(withPage(openCollection(1, "X"), 1), XL, tagData(tracks, null));
		expect(roleAt(p1, { column: 5, row: 0 }, XL)).toEqual({ kind: "pageInfo", page: 2, total: 2 });
		expect(roleAt(p1, { column: 5, row: 1 }, XL)).toEqual({ kind: "empty" }); // no next on last page
		expect(roleAt(p1, { column: 5, row: 2 }, XL)).toEqual({ kind: "pagePrev" });
		// first tile of page 2 is track index 19
		expect(roleAt(p1, { column: 0, row: 1 }, XL)).toMatchObject({ kind: "track", id: 19 });
	});

	test("totalPages helper", () => {
		expect(totalPages(0, 19)).toBe(1);
		expect(totalPages(19, 19)).toBe(1);
		expect(totalPages(20, 19)).toBe(2);
	});
});

describe("tracksForSelector (named + 'other' catch-all)", () => {
	const explore = mkTag(1, "explore", "#4a7fc8");
	const battle = mkTag(2, "battle", "#c8504a");
	const named = new Map<TagKey, number>([
		["explore", 1],
		["battle", 2],
	]);
	const tracks = [
		mkTrack(10, "a", [explore]),
		mkTrack(11, "b", [battle]),
		mkTrack(12, "c", [explore, battle]),
		mkTrack(13, "d", []), // untagged → 'other'
	];

	test("named selector filters by that tag id", () => {
		expect(tracksForSelector(tracks, "explore", named).map((t) => t.id)).toEqual([10, 12]);
		expect(tracksForSelector(tracks, "battle", named).map((t) => t.id)).toEqual([11, 12]);
	});

	test("'other' = tracks with none of the named tags", () => {
		expect(tracksForSelector(tracks, "other", named).map((t) => t.id)).toEqual([13]);
	});

	test("unresolved named selector yields nothing", () => {
		expect(tracksForSelector(tracks, "dungeon", named)).toEqual([]);
	});
});

describe("navTag resolution / active state", () => {
	test("unresolved named key renders dim (resolved=false)", () => {
		const data = tagData([], null, ["calm", "other"]); // only calm + other resolved
		const grid = layout(openCollection(1, "X"), XL, data);
		expect(roleAt(grid, { column: 7, row: 1 }, XL)).toMatchObject({ kind: "navTag", key: "explore", resolved: false });
		expect(roleAt(grid, { column: 6, row: 2 }, XL)).toMatchObject({ kind: "navTag", key: "calm", resolved: true, active: true });
	});

	test("selecting a tag moves the active highlight", () => {
		const grid = layout(selectTag(openCollection(1, "X"), "battle"), XL, tagData([], "#c8504a"));
		expect(roleAt(grid, { column: 6, row: 1 }, XL)).toMatchObject({ key: "battle", active: true });
		expect(roleAt(grid, { column: 6, row: 2 }, XL)).toMatchObject({ key: "calm", active: false });
	});
});
