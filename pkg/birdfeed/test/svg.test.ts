import { describe, expect, test } from "bun:test";

import type { Role } from "../src/grid";
import { navTagSvg, renderRole, trackSvg, wrapLines } from "../src/render/svg";

describe("svg rendering", () => {
	test("renderRole returns an svg data URI for every role kind", () => {
		const roles: Role[] = [
			{ kind: "empty" },
			{ kind: "back" },
			{ kind: "pagePrev" },
			{ kind: "pageNext" },
			{ kind: "pageInfo", page: 1, total: 3 },
			{ kind: "playPause" },
			{ kind: "collection", id: 1, name: "Bloodborne" },
			{ kind: "navTag", key: "battle", label: "Battle", color: "#c8504a", active: true, resolved: true },
			{ kind: "track", id: 3, title: "Cleric Beast", color: "#4aa6a0" },
		];
		for (const r of roles) {
			const uri = renderRole(r);
			expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
			expect(decodeURIComponent(uri)).toContain("<svg");
		}
	});

	test("play/pause key shows Pause when playing, Play otherwise", () => {
		expect(decodeURIComponent(renderRole({ kind: "playPause" }, { playing: true }))).toContain("Pause");
		expect(decodeURIComponent(renderRole({ kind: "playPause" }, { playing: false }))).toContain("Play");
	});

	test("track tile background = its tag color", () => {
		const svg = decodeURIComponent(renderRole({ kind: "track", id: 1, title: "X", color: "#c8504a" }));
		expect(svg).toContain("#c8504a");
	});

	test("a playing track draws a highlight border + progress", () => {
		const svg = decodeURIComponent(
			renderRole({ kind: "track", id: 1, title: "X", color: "#4aa6a0" }, { playing: true, positionMs: 5, durationMs: 10 }),
		);
		expect(svg).toContain("#ffffff"); // highlight border
	});

	test("unresolved navTag renders dim", () => {
		const svg = navTagSvg("Explore", null, false, false);
		expect(svg).toContain("#23262d"); // dim fill
	});

	test("track title is XML-escaped", () => {
		const svg = trackSvg("Mix & <hr>", { bg: null });
		expect(svg).toContain("&amp;");
		expect(svg).toContain("&lt;hr&gt;");
		expect(svg).not.toContain("<hr>");
	});

	test("wrapLines respects max lines and truncates", () => {
		const lines = wrapLines("one two three four five six seven eight nine", 8, 2);
		expect(lines.length).toBeLessThanOrEqual(2);
		expect(lines[lines.length - 1].endsWith("…")).toBe(true);
	});
});
