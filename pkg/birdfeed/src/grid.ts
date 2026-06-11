/**
 * The heart of birdfeed: given the current navigation level, the device's grid shape, and the
 * loaded library data, compute a row-major `Role[]` — one role per key. Pure (no SDK, no I/O) so
 * the whole layout is unit-testable. The controller renders each role and dispatches presses.
 *
 * Layout per level (research doc §4):
 *  - root:        every key = a collection (paged on overflow).
 *  - collection:  key 0 = Back; the rest = colored-tag swatches (paged).
 *  - tag:         rightmost column = nav column (Back on top, then sibling-tag quick-jumps);
 *                 the left region = track keys (paged), playing track highlighted by the renderer.
 */

import type { Collection, Tag, Track } from "./lark/types";
import type { NavState } from "./nav";
import { normalizeHex } from "./render/color";

export type Role =
	| { kind: "empty" }
	| { kind: "back" }
	| { kind: "pagePrev" }
	| { kind: "pageNext" }
	| { kind: "collection"; id: number; name: string }
	| { kind: "tag"; id: number; name: string; color: string | null }
	| { kind: "navTag"; id: number; name: string; color: string | null; active: boolean }
	| { kind: "track"; id: number; title: string };

export interface DeviceShape {
	columns: number;
	rows: number;
}

export interface GridData {
	collections: Collection[];
	/** Colored tags present in the current collection (already filtered to color != null). */
	tags: Tag[];
	/** All tracks for the current collection; the tag view filters these client-side. */
	tracks: Track[];
}

const EMPTY: Role = { kind: "empty" };

function range(start: number, end: number): number[] {
	const out: number[] = [];
	for (let i = start; i < end; i++) out.push(i);
	return out;
}

/**
 * Place `items` into the cells named by `indices` (row-major order). If they don't all fit, reserve
 * the last two cells as prev/next pagers (consistent page size = indices.length - 2).
 */
function fillRegion(cells: Role[], indices: number[], items: Role[], page: number): void {
	const n = indices.length;
	if (n === 0) return;

	if (items.length <= n) {
		items.forEach((it, i) => (cells[indices[i]] = it));
		return;
	}
	// Too few cells to host items + both pagers: just truncate (degenerate tiny region).
	if (n < 3) {
		indices.forEach((idx, i) => (cells[idx] = items[i] ?? EMPTY));
		return;
	}

	const perPage = n - 2;
	const pageCount = Math.ceil(items.length / perPage);
	const p = Math.min(Math.max(0, page), pageCount - 1);
	const start = p * perPage;
	const slice = items.slice(start, start + perPage);
	slice.forEach((it, i) => (cells[indices[i]] = it));
	cells[indices[n - 2]] = p > 0 ? { kind: "pagePrev" } : EMPTY;
	cells[indices[n - 1]] = p < pageCount - 1 ? { kind: "pageNext" } : EMPTY;
}

function collectionRole(c: Collection): Role {
	return { kind: "collection", id: c.id, name: c.name };
}
function tagRole(t: Tag): Role {
	return { kind: "tag", id: t.id, name: t.name, color: t.color };
}
function trackRole(t: Track): Role {
	return { kind: "track", id: t.id, title: t.title };
}

/** Tracks in the current collection that carry the active tag. */
export function tracksForTag(tracks: Track[], tagId: number): Track[] {
	return tracks.filter((t) => t.tags.some((tg) => tg.id === tagId));
}

/** Distinct colored tags (color != null) appearing on the given tracks, sorted by name. */
export function coloredTagsPresent(tracks: Track[]): Tag[] {
	const byId = new Map<number, Tag>();
	for (const t of tracks) {
		for (const tag of t.tags) {
			if (normalizeHex(tag.color) && !byId.has(tag.id)) byId.set(tag.id, tag);
		}
	}
	return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Compute the full key grid for the current navigation level. */
export function layout(nav: NavState, device: DeviceShape, data: GridData): Role[] {
	const cap = device.columns * device.rows;
	const cells: Role[] = new Array(cap).fill(EMPTY);

	if (nav.level === "root") {
		fillRegion(cells, range(0, cap), data.collections.map(collectionRole), nav.page);
		return cells;
	}

	if (nav.level === "collection") {
		cells[0] = { kind: "back" };
		fillRegion(cells, range(1, cap), data.tags.map(tagRole), nav.page);
		return cells;
	}

	// tag level
	const lastCol = device.columns - 1;
	const navIndices: number[] = [];
	for (let r = 0; r < device.rows; r++) navIndices.push(r * device.columns + lastCol);

	cells[navIndices[0]] = { kind: "back" };
	const navTagCells = navIndices.slice(1);
	const navTagRoles: Role[] = data.tags.map((t) => ({
		kind: "navTag" as const,
		id: t.id,
		name: t.name,
		color: t.color,
		active: t.id === nav.tagId,
	}));
	// Quick-jump column: show as many sibling tags as fit (truncate; the left region is the focus).
	navTagCells.forEach((idx, i) => (cells[idx] = navTagRoles[i] ?? EMPTY));

	const leftIndices: number[] = [];
	for (let r = 0; r < device.rows; r++) {
		for (let c = 0; c < lastCol; c++) leftIndices.push(r * device.columns + c);
	}
	const tracks = tracksForTag(data.tracks, nav.tagId).map(trackRole);
	fillRegion(cells, leftIndices, tracks, nav.page);
	return cells;
}

/** Index into a computed layout by Stream Deck coordinates. */
export function roleAt(grid: Role[], coord: { column: number; row: number }, device: DeviceShape): Role {
	const idx = coord.row * device.columns + coord.column;
	return grid[idx] ?? EMPTY;
}
