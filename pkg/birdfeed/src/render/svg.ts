/**
 * Render a Role to a `data:image/svg+xml,…` string for `action.setImage`. Pure (returns a string),
 * so renders are unit-testable. SVGs use a 144×144 canvas (Stream Deck rasterizes to the key size).
 */

import type { Role } from "../grid";
import { contrastText, fillFor, shade } from "./color";

const SIZE = 144;
const BG = "#16181d";
const FG = "#e6e8ec";
const ACCENT = "#4aa6a0"; // teal, matches the gothic/lark family

export interface RenderOpts {
	/** Track / play-pause is the currently-playing track. */
	playing?: boolean;
	/** Track / play-pause is the current track but paused. */
	paused?: boolean;
	positionMs?: number;
	durationMs?: number | null;
	/** Track tile background (the active tag's color); null → default dark. */
	bg?: string | null;
}

function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function dataUri(svg: string): string {
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Naive word-wrap to at most `maxLines` lines of ~`maxChars` chars; last line gets an ellipsis. */
export function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
	const words = text.trim().split(/\s+/);
	const lines: string[] = [];
	let cur = "";
	for (const w of words) {
		const candidate = cur ? `${cur} ${w}` : w;
		if (candidate.length > maxChars && cur) {
			lines.push(cur);
			cur = w;
			if (lines.length === maxLines - 1) break;
		} else {
			cur = candidate;
		}
	}
	if (cur && lines.length < maxLines) lines.push(cur);
	const last = lines[lines.length - 1];
	if (last && last.length > maxChars) lines[lines.length - 1] = `${last.slice(0, maxChars - 1)}…`;
	const consumed = lines.join(" ").split(/\s+/).length;
	if (consumed < words.length && lines.length) {
		const l = lines[lines.length - 1];
		lines[lines.length - 1] = l.length > maxChars - 1 ? `${l.slice(0, maxChars - 1)}…` : `${l}…`;
	}
	return lines;
}

function textBlock(lines: string[], color: string, y0: number, lh: number, size: number): string {
	return lines
		.map(
			(ln, i) =>
				`<text x="${SIZE / 2}" y="${y0 + i * lh}" fill="${color}" font-family="sans-serif" font-size="${size}" font-weight="600" text-anchor="middle">${esc(ln)}</text>`,
		)
		.join("");
}

function frame(inner: string, bg = BG): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>${inner}</svg>`;
}

export function emptySvg(): string {
	return frame("");
}

export function backSvg(): string {
	// "Up" (one level up to collections). A stemmed up-arrow — visually distinct from the
	// stemless next/prev page chevrons so the two roles don't read the same.
	const inner =
		`<path d="M72 44 L72 100" fill="none" stroke="${FG}" stroke-width="12" stroke-linecap="round"/>` +
		`<path d="M50 62 L72 40 L94 62" fill="none" stroke="${FG}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>` +
		textBlock(["Up"], "#9aa0aa", 128, 0, 20);
	return frame(inner);
}

export function pagerSvg(dir: "prev" | "next"): string {
	const arrow =
		dir === "next"
			? `<path d="M44 54 L72 86 L100 54" fill="none" stroke="${ACCENT}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`
			: `<path d="M44 90 L72 58 L100 90" fill="none" stroke="${ACCENT}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`;
	return frame(arrow + textBlock([dir === "next" ? "Next" : "Prev"], "#9aa0aa", 128, 0, 20));
}

export function pageInfoSvg(page: number, total: number): string {
	return frame(
		textBlock(["Page"], "#9aa0aa", 50, 0, 20) + textBlock([`${page}/${total}`], FG, 96, 0, 40),
	);
}

export function stopSvg(): string {
	return frame(
		`<rect x="48" y="40" width="48" height="48" rx="6" fill="#c8504a"/>` + textBlock(["Stop"], "#9aa0aa", 124, 0, 20),
	);
}

export function playPauseSvg(playing: boolean): string {
	const glyph = playing
		? `<rect x="50" y="40" width="14" height="48" rx="3" fill="${FG}"/><rect x="80" y="40" width="14" height="48" rx="3" fill="${FG}"/>`
		: `<path d="M54 38 L54 90 L98 64 Z" fill="${FG}"/>`;
	return frame(glyph + textBlock([playing ? "Pause" : "Play"], "#9aa0aa", 124, 0, 20));
}

export function collectionSvg(name: string): string {
	const folder =
		`<rect x="34" y="40" width="76" height="52" rx="6" fill="#2a2e37"/>` +
		`<rect x="34" y="34" width="40" height="14" rx="4" fill="#2a2e37"/>`;
	const lines = wrapLines(name, 12, 3);
	const startY = 118 - (lines.length - 1) * 16;
	return frame(folder + textBlock(lines, FG, startY, 16, 15));
}

/** A fixed tag button. Dim when the named tag didn't resolve to a lark tag. */
export function navTagSvg(label: string, color: string | null, active: boolean, resolved: boolean): string {
	const fill = resolved ? fillFor(color) : "#23262d";
	const txt = resolved ? contrastText(fill) : "#6b7280";
	const border = active
		? `<rect x="6" y="6" width="${SIZE - 12}" height="${SIZE - 12}" rx="14" fill="none" stroke="${FG}" stroke-width="7"/>`
		: `<rect x="10" y="10" width="${SIZE - 20}" height="${SIZE - 20}" rx="12" fill="none" stroke="${shade(fill, -0.4)}" stroke-width="3"/>`;
	const swatch = `<rect x="10" y="10" width="${SIZE - 20}" height="${SIZE - 20}" rx="12" fill="${fill}"/>`;
	const lines = wrapLines(label, 9, 2);
	const startY = 84 - (lines.length - 1) * 16;
	return frame(swatch + border + textBlock(lines, txt, startY, 32, 22));
}

/** A track tile. Background = the active tag's color; bigger title font for legibility. */
export function trackSvg(title: string, opts: RenderOpts): string {
	const base = opts.bg ? fillFor(opts.bg) : BG;
	const txt = opts.bg ? contrastText(base) : FG;
	const active = opts.playing || opts.paused;
	const border = opts.playing
		? `<rect x="4" y="4" width="${SIZE - 8}" height="${SIZE - 8}" rx="12" fill="none" stroke="#ffffff" stroke-width="7"/>`
		: opts.paused
			? `<rect x="4" y="4" width="${SIZE - 8}" height="${SIZE - 8}" rx="12" fill="none" stroke="#ffffff" stroke-width="7" stroke-dasharray="10 8"/>`
			: "";
	const glyph = opts.playing
		? `<path d="M12 14 L12 36 L30 25 Z" fill="${txt}"/>`
		: opts.paused
			? `<rect x="12" y="14" width="6" height="22" fill="${txt}"/><rect x="24" y="14" width="6" height="22" fill="${txt}"/>`
			: "";
	const lines = wrapLines(title, 9, 4);
	const startY = 78 - (lines.length - 1) * 13;
	let progress = "";
	if (active && opts.durationMs && opts.durationMs > 0) {
		const ratio = Math.max(0, Math.min(1, (opts.positionMs ?? 0) / opts.durationMs));
		const w = Math.round((SIZE - 24) * ratio);
		const trough = opts.bg ? shade(base, -0.35) : "#2a2e37";
		progress =
			`<rect x="12" y="130" width="${SIZE - 24}" height="7" rx="3" fill="${trough}"/>` +
			`<rect x="12" y="130" width="${w}" height="7" rx="3" fill="${txt}"/>`;
	}
	return frame(border + glyph + textBlock(lines, txt, startY, 25, 23) + progress, base);
}

export function messageSvg(text: string, tone: "error" | "info" = "info"): string {
	const color = tone === "error" ? "#c8504a" : "#9aa0aa";
	const lines = wrapLines(text, 13, 4);
	const startY = 80 - (lines.length - 1) * 14;
	return frame(textBlock(lines, color, startY, 22, 15));
}

/** Dispatch a Role (plus optional now-playing context) to a data-URI image. */
export function renderRole(role: Role, opts: RenderOpts = {}): string {
	switch (role.kind) {
		case "empty":
			return dataUri(emptySvg());
		case "back":
			return dataUri(backSvg());
		case "pagePrev":
			return dataUri(pagerSvg("prev"));
		case "pageNext":
			return dataUri(pagerSvg("next"));
		case "pageInfo":
			return dataUri(pageInfoSvg(role.page, role.total));
		case "playPause":
			return dataUri(playPauseSvg(!!opts.playing));
		case "stop":
			return dataUri(stopSvg());
		case "collection":
			return dataUri(collectionSvg(role.name));
		case "navTag":
			return dataUri(navTagSvg(role.label, role.color, role.active, role.resolved));
		case "track":
			return dataUri(trackSvg(role.title, { ...opts, bg: role.color }));
	}
}
