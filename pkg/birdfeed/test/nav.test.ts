import { describe, expect, test } from "bun:test";

import { back, openCollection, rootNav, selectTag, withPage } from "../src/nav";

describe("nav state machine", () => {
	test("root → tag page (default tag = calm) on opening a collection", () => {
		expect(rootNav()).toEqual({ level: "root", page: 0 });
		const tag = openCollection(7, "Bloodborne");
		expect(tag).toEqual({ level: "tag", collectionId: 7, collectionName: "Bloodborne", tagKey: "calm", page: 0 });
	});

	test("selectTag switches the active tag and resets page", () => {
		const tag = withPage(openCollection(7, "BB"), 3);
		const switched = selectTag(tag, "battle");
		expect(switched).toEqual({ level: "tag", collectionId: 7, collectionName: "BB", tagKey: "battle", page: 0 });
	});

	test("selectTag is a no-op from root", () => {
		const root = rootNav();
		expect(selectTag(root, "battle")).toBe(root);
	});

	test("back: tag → root, root → root", () => {
		const tag = openCollection(1, "a");
		expect(back(tag)).toEqual({ level: "root", page: 0 });
		const root = rootNav();
		expect(back(root)).toBe(root);
	});

	test("withPage clamps to >= 0", () => {
		const tag = openCollection(1, "a");
		expect(withPage(tag, 4).page).toBe(4);
		expect(withPage(tag, -2).page).toBe(0);
	});
});
