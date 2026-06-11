import { describe, expect, test } from "bun:test";

import { back, enterCollection, enterTag, rootNav, withPage } from "../src/nav";

describe("nav state machine", () => {
	test("root → collection → tag drilldown", () => {
		const root = rootNav();
		expect(root).toEqual({ level: "root", page: 0 });

		const col = enterCollection(7, "Bloodborne");
		expect(col).toEqual({ level: "collection", collectionId: 7, collectionName: "Bloodborne", page: 0 });

		const tag = enterTag(col, 3, "Boss");
		expect(tag).toEqual({
			level: "tag",
			collectionId: 7,
			collectionName: "Bloodborne",
			tagId: 3,
			tagName: "Boss",
			page: 0,
		});
	});

	test("back pops one level: tag → collection → root → root", () => {
		const tag = enterTag(enterCollection(7, "BB"), 3, "Boss");
		const col = back(tag);
		expect(col.level).toBe("collection");
		expect(col.level === "collection" && col.collectionId).toBe(7);

		const root = back(col);
		expect(root.level).toBe("root");
		expect(back(root).level).toBe("root"); // root is terminal
	});

	test("enterTag from another tag keeps the collection but resets page", () => {
		const tag1 = withPage(enterTag(enterCollection(7, "BB"), 3, "Boss"), 2);
		const tag2 = enterTag(tag1, 9, "Ambient");
		expect(tag2).toMatchObject({ level: "tag", collectionId: 7, tagId: 9, tagName: "Ambient", page: 0 });
	});

	test("enterTag from root is a guarded no-op", () => {
		const root = rootNav();
		expect(enterTag(root, 1, "x")).toBe(root);
	});

	test("withPage clamps to >= 0 and changing level resets page", () => {
		const col = withPage(enterCollection(1, "a"), 5);
		expect(col.page).toBe(5);
		expect(withPage(col, -3).page).toBe(0);
		expect(back(col).page).toBe(0);
	});
});
