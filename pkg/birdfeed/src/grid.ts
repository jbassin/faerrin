/**
 * The heart of birdfeed: given the navigation level, the device grid shape, and resolved library
 * data, compute a row-major `Role[]` — one role per key. Pure (no SDK, no I/O) so it's unit-testable.
 *
 * Layout per level:
 *  - root: every key = a collection (paged on overflow).
 *  - tag page (designed for XL 8×4; positions are relative to the right edge so it degrades on
 *    smaller decks): the top-left key (0,0) is reserved/blank. The three RIGHTMOST columns are
 *    controls; the rest is the track region.
 *      col C-1 (rightmost): Back, explore, stealth, other
 *      col C-2            : play/pause, battle, calm, dungeon
 *      col C-3            : page info, next page, prev page, (empty)
 *    Track keys fill the remaining left region COLUMN-MAJOR (top→bottom, then left→right), skipping
 *    the reserved (0,0) key, and paginate via the C-3 column.
 */

import type { Collection, Track } from "./lark/types";
import type { NavState } from "./nav";
import { tagLabel, type TagKey } from "./tags";

export type Role =
	| { kind: "empty" }
	| { kind: "back" }
	| { kind: "pagePrev" }
	| { kind: "pageNext" }
	| { kind: "pageInfo"; page: number; total: number } // 1-based page / total; info only, no action
	| { kind: "playPause" }
	| { kind: "stop" }
	| { kind: "collection"; id: number; name: string }
	| { kind: "navTag"; key: TagKey; label: string; color: string | null; active: boolean; resolved: boolean }
	| { kind: "track"; id: number; title: string; color: string | null };

export interface DeviceShape {
	columns: number;
	rows: number;
}

export interface GridData {
	collections: Collection[];
	/** Resolved color per fixed tag key (#rrggbb or null when uncolored/unresolved). */
	tagColors: Map<TagKey, string | null>;
	/** Which fixed tag keys resolved to a real selector ("other" is always resolved). */
	tagResolved: Set<TagKey>;
	/** Tracks already filtered to the ACTIVE tag selector. */
	tracks: Track[];
	/** The active tag's color — background for the track tiles (null → default dark). */
	activeColor: string | null;
}

const EMPTY: Role = { kind: "empty" };

function range(start: number, end: number): number[] {
	const out: number[] = [];
	for (let i = start; i < end; i++) out.push(i);
	return out;
}

/** Place items into the named cells (row-major); reserve the last two as pagers on overflow. */
function fillRegion(cells: Role[], indices: number[], items: Role[], page: number): void {
	const n = indices.length;
	if (n === 0) return;
	if (items.length <= n) {
		items.forEach((it, i) => (cells[indices[i]] = it));
		return;
	}
	if (n < 3) {
		indices.forEach((idx, i) => (cells[idx] = items[i] ?? EMPTY));
		return;
	}
	const perPage = n - 2;
	const pageCount = Math.ceil(items.length / perPage);
	const p = Math.min(Math.max(0, page), pageCount - 1);
	const start = p * perPage;
	items.slice(start, start + perPage).forEach((it, i) => (cells[indices[i]] = it));
	cells[indices[n - 2]] = p > 0 ? { kind: "pagePrev" } : EMPTY;
	cells[indices[n - 1]] = p < pageCount - 1 ? { kind: "pageNext" } : EMPTY;
}

/** Ordered (column-major) list of track-region cell indices, skipping the reserved (0,0) key. */
export function trackCells(device: DeviceShape): number[] {
	const { columns: C, rows: R } = device;
	const lastTrackCol = C - 4; // cols 0..C-4 are tracks; C-3,C-2,C-1 are controls
	const out: number[] = [];
	for (let col = 0; col <= lastTrackCol; col++) {
		for (let row = 0; row < R; row++) {
			if (col === 0 && row === 0) continue; // reserved
			out.push(row * C + col);
		}
	}
	return out;
}

/** Number of track tiles that fit on one page for this device. */
export function trackCapacity(device: DeviceShape): number {
	return trackCells(device).length;
}

export function totalPages(trackCount: number, capacity: number): number {
	return Math.max(1, Math.ceil(trackCount / Math.max(1, capacity)));
}

/** Tracks matching the active selector. namedTagIds maps the 5 named keys to a lark tag id. */
export function tracksForSelector(tracks: Track[], key: TagKey, namedTagIds: Map<TagKey, number>): Track[] {
	if (key === "other") {
		const ids = new Set(namedTagIds.values());
		return tracks.filter((t) => !t.tags.some((tg) => ids.has(tg.id)));
	}
	const id = namedTagIds.get(key);
	if (id === undefined) return []; // unresolved named tag → no tracks
	return tracks.filter((t) => t.tags.some((tg) => tg.id === id));
}

function collectionRole(c: Collection): Role {
	return { kind: "collection", id: c.id, name: c.name };
}

/** Compute the full key grid for the current navigation level. */
export function layout(nav: NavState, device: DeviceShape, data: GridData): Role[] {
	const { columns: C, rows: R } = device;
	const cells: Role[] = new Array(C * R).fill(EMPTY);

	if (nav.level === "root") {
		// (0,0) is reserved/blank in every view; collections start at key 1.
		fillRegion(cells, range(1, C * R), data.collections.map(collectionRole), nav.page);
		return cells;
	}

	// ---- tag page ----
	const place = (col: number, row: number, role: Role): void => {
		if (col >= 0 && col < C && row >= 0 && row < R) cells[row * C + col] = role;
	};
	const navTag = (key: TagKey): Role => ({
		kind: "navTag",
		key,
		label: tagLabel(key),
		color: data.tagColors.get(key) ?? null,
		active: nav.tagKey === key,
		resolved: data.tagResolved.has(key),
	});

	const colBack = C - 1;
	const colPlay = C - 2;
	const colPage = C - 3;

	// (0,0) stays reserved/blank (left as EMPTY).

	// Right column: Back, explore, stealth, other.
	place(colBack, 0, { kind: "back" });
	place(colBack, 1, navTag("explore"));
	place(colBack, 2, navTag("stealth"));
	place(colBack, 3, navTag("other"));

	// Next column in: play/pause, battle, calm, dungeon.
	place(colPlay, 0, { kind: "playPause" });
	place(colPlay, 1, navTag("battle"));
	place(colPlay, 2, navTag("calm"));
	place(colPlay, 3, navTag("dungeon"));

	// Track tiling + pagination.
	const cellIdx = trackCells(device);
	const cap = cellIdx.length;
	const pages = totalPages(data.tracks.length, cap);
	const page = Math.min(Math.max(0, nav.page), pages - 1);
	const slice = data.tracks.slice(page * cap, page * cap + cap);
	slice.forEach((t, i) => {
		cells[cellIdx[i]] = { kind: "track", id: t.id, title: t.title, color: data.activeColor };
	});

	// Page-control column: info, next, prev, stop.
	place(colPage, 0, { kind: "pageInfo", page: page + 1, total: pages });
	place(colPage, 1, page < pages - 1 ? { kind: "pageNext" } : EMPTY);
	place(colPage, 2, page > 0 ? { kind: "pagePrev" } : EMPTY);
	place(colPage, 3, { kind: "stop" });

	return cells;
}

/** Index into a computed layout by Stream Deck coordinates. */
export function roleAt(grid: Role[], coord: { column: number; row: number }, device: DeviceShape): Role {
	const idx = coord.row * device.columns + coord.column;
	return grid[idx] ?? EMPTY;
}
