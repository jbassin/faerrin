/**
 * Tag-color palette + pure helpers for the library's color grouping (design
 * decision: single-home grouping, home = alphabetically-first colored tag).
 * Kept dependency-free so it can be unit-tested without React/DOM.
 */
import type { CSSProperties } from "react";
import type { Tag, Track } from "./types";

/** Curated, dark-theme-safe swatches offered in the tag-color picker. */
export const TAG_PALETTE: { name: string; value: string }[] = [
  { name: "Crimson", value: "#c8504a" },
  { name: "Amber", value: "#c8a24a" },
  { name: "Sage", value: "#6fa86f" },
  { name: "Teal", value: "#4aa6a0" },
  { name: "Azure", value: "#4a7fc8" },
  { name: "Violet", value: "#9a6fc8" },
  { name: "Rose", value: "#c86f9a" },
  { name: "Slate", value: "#6b7280" },
];

/** Row-tint strength: keeps `--ink` text well above WCAG AA on the dark bg. */
const TINT_ALPHA = 0.13;

/** The colored tag that "owns" a track: the alphabetically-first one with a color. */
export function homeColoredTag(track: Track): Tag | null {
  const colored = track.tags.filter((t) => t.color).sort((a, b) => a.name.localeCompare(b.name));
  return colored[0] ?? null;
}

export interface TrackSection {
  /** Stable key: the home tag id, or "__other__" for uncolored tracks. */
  key: string;
  label: string;
  color: string | null;
  tracks: Track[];
}

/**
 * Split tracks into sections by home colored tag. Colored sections come first
 * (ordered by tag name); the uncolored "Other" bucket is always last. Empty
 * sections are dropped; track order within a section follows the input.
 */
export function groupByColor(tracks: Track[]): TrackSection[] {
  const sections = new Map<string, TrackSection>();
  for (const t of tracks) {
    const home = homeColoredTag(t);
    const key = home ? String(home.id) : "__other__";
    let sec = sections.get(key);
    if (!sec) {
      sec = { key, label: home?.name ?? "Other", color: home?.color ?? null, tracks: [] };
      sections.set(key, sec);
    }
    sec.tracks.push(t);
  }
  const colored = [...sections.values()]
    .filter((s) => s.key !== "__other__")
    .sort((a, b) => a.label.localeCompare(b.label));
  const other = sections.get("__other__");
  return other ? [...colored, other] : colored;
}

/** `#rrggbb` → `rgba(r,g,b,a)`; returns the input untouched if not parseable. */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Inline style for a tinted row: subtle background fill + a solid left accent. */
export function rowTintStyle(color: string | null): CSSProperties | undefined {
  if (!color) return undefined;
  return { background: hexToRgba(color, TINT_ALPHA), boxShadow: `inset 3px 0 0 ${color}` };
}
