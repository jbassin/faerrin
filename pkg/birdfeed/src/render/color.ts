/**
 * Color helpers for tag swatches. lark stores tag colors as `#rrggbb` (or null). The 8-swatch
 * curated palette mirrors lark's web UI (pkg/lark/src/web/grouping.ts) for visual parity.
 */

/** lark's curated tag palette (name → hex), for reference/fallback parity. */
export const LARK_PALETTE: Record<string, string> = {
	Crimson: "#c8504a",
	Amber: "#c8a24a",
	Sage: "#6fa86f",
	Teal: "#4aa6a0",
	Azure: "#4a7fc8",
	Violet: "#9a6fc8",
	Rose: "#c86f9a",
	Slate: "#6b7280",
};

/** Fallback fill for an uncolored tag (lark renders these as a plain chip). */
export const NEUTRAL = "#6b7280";

/** Validate + normalize a `#rrggbb` string to lowercase; return null if invalid/empty. */
export function normalizeHex(color: string | null | undefined): string | null {
	if (!color) return null;
	const m = /^#([0-9a-fA-F]{6})$/.exec(color.trim());
	return m ? `#${m[1].toLowerCase()}` : null;
}

/** Resolve a tag color to a concrete fill, falling back to NEUTRAL for null/invalid. */
export function fillFor(color: string | null | undefined): string {
	return normalizeHex(color) ?? NEUTRAL;
}

/**
 * Pick black or white text for legibility on a given background, using the WCAG relative-luminance
 * rule of thumb. `hex` must be `#rrggbb` (already normalized).
 */
export function contrastText(hex: string): "#000000" | "#ffffff" {
	const r = parseInt(hex.slice(1, 3), 16) / 255;
	const g = parseInt(hex.slice(3, 5), 16) / 255;
	const b = parseInt(hex.slice(5, 7), 16) / 255;
	const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
	// WCAG-derived crossover (~0.179) — lighter backgrounds take black text.
	return luminance > 0.179 ? "#000000" : "#ffffff";
}

/** Darken/lighten a hex color by `amount` in [-1,1] (negative = darker). For borders/highlights. */
export function shade(hex: string, amount: number): string {
	const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
	const ch = (i: number) => {
		const v = parseInt(hex.slice(i, i + 2), 16);
		return clamp(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
	};
	const hx = (n: number) => n.toString(16).padStart(2, "0");
	return `#${hx(ch(1))}${hx(ch(3))}${hx(ch(5))}`;
}
