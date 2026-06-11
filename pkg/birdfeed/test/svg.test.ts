import { describe, expect, test } from "bun:test";

import { renderRole } from "../src/render/svg";
import { trackSvg, wrapLines } from "../src/render/svg";

describe("svg rendering", () => {
	test("renderRole returns an svg data URI for every role kind", () => {
		const roles = [
			{ kind: "empty" as const },
			{ kind: "back" as const },
			{ kind: "pagePrev" as const },
			{ kind: "pageNext" as const },
			{ kind: "collection" as const, id: 1, name: "Bloodborne" },
			{ kind: "tag" as const, id: 2, name: "Boss", color: "#c8504a" },
			{ kind: "navTag" as const, id: 2, name: "Boss", color: "#c8504a", active: true },
			{ kind: "track" as const, id: 3, title: "Cleric Beast" },
		];
		for (const r of roles) {
			const uri = renderRole(r);
			expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
			expect(decodeURIComponent(uri)).toContain("<svg");
		}
	});

	test("a playing track draws an accent border and progress bar", () => {
		const uri = renderRole({ kind: "track", id: 3, title: "X" }, { playing: true, positionMs: 50000, durationMs: 100000 });
		const svg = decodeURIComponent(uri);
		expect(svg).toContain("#4aa6a0"); // accent
	});

	test("track title is XML-escaped", () => {
		const svg = trackSvg("Rock & Roll <hr>", {});
		expect(svg).toContain("Rock &amp; Roll");
		expect(svg).not.toContain("<hr>");
	});

	test("wrapLines respects max lines and truncates", () => {
		const lines = wrapLines("one two three four five six seven eight", 8, 2);
		expect(lines.length).toBeLessThanOrEqual(2);
		expect(lines[lines.length - 1].endsWith("…")).toBe(true);
	});
});
