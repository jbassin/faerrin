/**
 * Pure navigation state machine: lark (root) → collection → tag.
 * One NavState is held per Stream Deck device by the controller. All transitions return a NEW
 * object (no mutation) and reset `page` to 0 when changing level.
 */

export type NavState =
	| { level: "root"; page: number }
	| { level: "collection"; collectionId: number; collectionName: string; page: number }
	| {
			level: "tag";
			collectionId: number;
			collectionName: string;
			tagId: number;
			tagName: string;
			page: number;
	  };

export function rootNav(): NavState {
	return { level: "root", page: 0 };
}

export function enterCollection(id: number, name: string): NavState {
	return { level: "collection", collectionId: id, collectionName: name, page: 0 };
}

/** Enter a tag from within a collection (or switch tags from another tag — keeps the collection). */
export function enterTag(prev: NavState, tagId: number, tagName: string): NavState {
	if (prev.level === "root") return prev; // not reachable from root; no-op guard
	return {
		level: "tag",
		collectionId: prev.collectionId,
		collectionName: prev.collectionName,
		tagId,
		tagName,
		page: 0,
	};
}

/** Pop one level: tag → its collection, collection → root, root → root. */
export function back(nav: NavState): NavState {
	switch (nav.level) {
		case "tag":
			return enterCollection(nav.collectionId, nav.collectionName);
		case "collection":
			return rootNav();
		case "root":
			return nav;
	}
}

export function withPage(nav: NavState, page: number): NavState {
	return { ...nav, page: Math.max(0, page) };
}
