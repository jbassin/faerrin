import { describe, expect, test } from "bun:test";

import { contrastText, fillFor, NEUTRAL, normalizeHex, shade } from "../src/render/color";

describe("color helpers", () => {
	test("normalizeHex validates and lowercases", () => {
		expect(normalizeHex("#C8504A")).toBe("#c8504a");
		expect(normalizeHex("#abc")).toBeNull();
		expect(normalizeHex("c8504a")).toBeNull();
		expect(normalizeHex(null)).toBeNull();
		expect(normalizeHex(undefined)).toBeNull();
	});

	test("fillFor falls back to NEUTRAL for invalid/null", () => {
		expect(fillFor("#4aa6a0")).toBe("#4aa6a0");
		expect(fillFor(null)).toBe(NEUTRAL);
		expect(fillFor("nope")).toBe(NEUTRAL);
	});

	test("contrastText picks legible foreground", () => {
		expect(contrastText("#ffffff")).toBe("#000000");
		expect(contrastText("#000000")).toBe("#ffffff");
		expect(contrastText("#c8a24a")).toBe("#000000"); // light amber → black text
	});

	test("shade darkens and lightens within bounds", () => {
		expect(shade("#000000", 1)).toBe("#ffffff");
		expect(shade("#ffffff", -1)).toBe("#000000");
		expect(shade("#808080", 0)).toBe("#808080");
	});
});
