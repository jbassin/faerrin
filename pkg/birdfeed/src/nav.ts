/**
 * Pure navigation state machine: lark (root) → tag page.
 *
 * The old intermediate "collection tag-grid" level was removed — pressing a collection opens its
 * tag page directly (at DEFAULT_TAG_KEY), and you switch tags from the fixed tag buttons on that
 * page. One NavState is held per Stream Deck device by the controller. Transitions return a NEW
 * object and reset `page` to 0 when the level or tag changes.
 */

import { DEFAULT_TAG_KEY, type TagKey } from "./tags";

export type NavState =
	| { level: "root"; page: number }
	| { level: "tag"; collectionId: number; collectionName: string; tagKey: TagKey; page: number };

export function rootNav(): NavState {
	return { level: "root", page: 0 };
}

/** Press a collection → open its tag page at the default tag. */
export function openCollection(id: number, name: string): NavState {
	return { level: "tag", collectionId: id, collectionName: name, tagKey: DEFAULT_TAG_KEY, page: 0 };
}

/** Switch the active tag within the current collection (resets page). No-op from root. */
export function selectTag(nav: NavState, tagKey: TagKey): NavState {
	if (nav.level !== "tag") return nav;
	return { ...nav, tagKey, page: 0 };
}

/** Back: tag → root; root → root. */
export function back(nav: NavState): NavState {
	return nav.level === "tag" ? rootNav() : nav;
}

export function withPage(nav: NavState, page: number): NavState {
	return { ...nav, page: Math.max(0, page) };
}
