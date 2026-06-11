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
	/** Track is the currently-playing track. */
	playing?: boolean;
	/** Track is the current track but paused. */
	paused?: boolean;
	positionMs?: number;
	durationMs?: number | null;
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
	// Hard-truncate an over-long final line.
	const last = lines[lines.length - 1];
	if (last && last.length > maxChars) lines[lines.length - 1] = `${last.slice(0, maxChars - 1)}…`;
	// If we ran out of lines but there were more words, mark the last with an ellipsis.
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
	const inner =
		`<path d="M86 44 L56 72 L86 100" fill="none" stroke="${FG}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>` +
		textBlock(["Back"], "#9aa0aa", 126, 0, 18);
	return frame(inner);
}

export function pagerSvg(dir: "prev" | "next"): string {
	const arrow =
		dir === "next"
			? `<path d="M48 56 L72 84 L96 56" fill="none" stroke="${ACCENT}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`
			: `<path d="M48 88 L72 60 L96 88" fill="none" stroke="${ACCENT}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`;
	return frame(arrow + textBlock([dir === "next" ? "More" : "Prev"], "#9aa0aa", 126, 0, 18));
}

export function collectionSvg(name: string): string {
	const folder =
		`<rect x="34" y="40" width="76" height="52" rx="6" fill="#2a2e37"/>` +
		`<rect x="34" y="34" width="40" height="14" rx="4" fill="#2a2e37"/>`;
	const lines = wrapLines(name, 12, 3);
	const startY = 118 - (lines.length - 1) * 16;
	return frame(folder + textBlock(lines, FG, startY, 16, 15));
}

export function tagSwatchSvg(name: string, color: string | null, active: boolean): string {
	const fill = fillFor(color);
	const txt = contrastText(fill);
	const border = active
		? `<rect x="6" y="6" width="${SIZE - 12}" height="${SIZE - 12}" rx="14" fill="none" stroke="${FG}" stroke-width="6"/>`
		: `<rect x="10" y="10" width="${SIZE - 20}" height="${SIZE - 20}" rx="12" fill="none" stroke="${shade(fill, -0.4)}" stroke-width="3"/>`;
	const lines = wrapLines(name, 11, 3);
	const startY = 80 - (lines.length - 1) * 15;
	const swatch = `<rect x="10" y="10" width="${SIZE - 20}" height="${SIZE - 20}" rx="12" fill="${fill}"/>`;
	return frame(swatch + border + textBlock(lines, txt, startY, 30, 17));
}

export function trackSvg(title: string, opts: RenderOpts): string {
	const active = opts.playing || opts.paused;
	const bg = active ? "#1d2a28" : BG;
	const border = opts.playing
		? `<rect x="4" y="4" width="${SIZE - 8}" height="${SIZE - 8}" rx="12" fill="none" stroke="${ACCENT}" stroke-width="6"/>`
		: opts.paused
			? `<rect x="4" y="4" width="${SIZE - 8}" height="${SIZE - 8}" rx="12" fill="none" stroke="#c8a24a" stroke-width="6"/>`
			: "";
	const glyph = opts.playing
		? `<path d="M58 36 L58 64 L82 50 Z" fill="${ACCENT}"/>`
		: opts.paused
			? `<rect x="58" y="36" width="8" height="28" fill="#c8a24a"/><rect x="74" y="36" width="8" height="28" fill="#c8a24a"/>`
			: "";
	const lines = wrapLines(title, 13, 3);
	const startY = 96 - (lines.length - 1) * 15;
	let progress = "";
	if (active && opts.durationMs && opts.durationMs > 0) {
		const ratio = Math.max(0, Math.min(1, (opts.positionMs ?? 0) / opts.durationMs));
		const w = Math.round((SIZE - 32) * ratio);
		progress =
			`<rect x="16" y="128" width="${SIZE - 32}" height="6" rx="3" fill="#2a2e37"/>` +
			`<rect x="16" y="128" width="${w}" height="6" rx="3" fill="${ACCENT}"/>`;
	}
	return frame(border + glyph + textBlock(lines, FG, startY, 16, 15) + progress, bg);
}

export function messageSvg(text: string, tone: "error" | "info" = "info"): string {
	const color = tone === "error" ? "#c8504a" : "#9aa0aa";
	const lines = wrapLines(text, 13, 4);
	const startY = 80 - (lines.length - 1) * 14;
	return frame(textBlock(lines, color, startY, 22, 15));
}

/** Dispatch a Role (plus optional now-playing context for tracks) to a data-URI image. */
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
		case "collection":
			return dataUri(collectionSvg(role.name));
		case "tag":
			return dataUri(tagSwatchSvg(role.name, role.color, false));
		case "navTag":
			return dataUri(tagSwatchSvg(role.name, role.color, role.active));
		case "track":
			return dataUri(trackSvg(role.title, opts));
	}
}
