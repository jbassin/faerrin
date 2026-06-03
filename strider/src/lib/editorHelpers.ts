import {
  CURRENT_FACTION_HEXES,
  CURRENT_UNOWNED_HEXES,
  type Layer,
  type Region,
  type Change,
} from "./layers";
import { FACTIONS } from "@/generated/factions";

// The editor authors region ops, three Skein ops, and the claim op. The other
// two Skein ops (skein-update, skein-disconnect) stay hand-authored.
export type EditableChange = Extract<
  Change,
  {
    op:
      | "add"
      | "update"
      | "remove"
      | "skein-add"
      | "skein-connect"
      | "skein-remove"
      | "claim";
  }
>;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

let _hexFactionMap: Map<string, number> | null = null;

// "Hex → faction index" for hexes currently owned by a faction in the
// post-claim effective state. Unowned hexes are absent from the map (use
// `effectiveHexFactionMap` below if you need to distinguish unowned from
// off-grid). Sourced from CURRENT_FACTION_HEXES so the editor reflects what
// the player sees at the end of the timeline.
export function hexFactionMap(): Map<string, number> {
  if (_hexFactionMap) return _hexFactionMap;
  const m = new Map<string, number>();
  CURRENT_FACTION_HEXES.forEach((hexes, factionIdx) => {
    for (const [q, r] of hexes) {
      m.set(`${q},${r}`, factionIdx);
    }
  });
  _hexFactionMap = m;
  return m;
}

// Returns effective per-hex ownership after applying all claim layers. Faction
// hexes map to their faction slug; explicitly unowned hexes map to `null`.
// Hexes outside the grid are absent from the map.
export function effectiveHexFactionMap(): Map<string, string | null> {
  const m = new Map<string, string | null>();
  CURRENT_FACTION_HEXES.forEach((hexes, factionIdx) => {
    const slug = FACTIONS[factionIdx]?.slug;
    if (!slug) return;
    for (const [q, r] of hexes) m.set(`${q},${r}`, slug);
  });
  for (const [q, r] of CURRENT_UNOWNED_HEXES) {
    m.set(`${q},${r}`, null);
  }
  return m;
}

export function hexRegionMap(regions: Region[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const region of regions) {
    for (const [q, r] of region.hexes) {
      m.set(`${q},${r}`, region.slug);
    }
  }
  return m;
}

// Builds a layer filename whose lexical sort matches chronological order:
// {YYYY}-{MM}-{DD}T{HHMMSS}-{slug}.md. Year is zero-padded to 4 digits so the
// sort stays correct across digit boundaries (e.g. years 999 → 1000).
export function layerFilename(timestamp: string, slug: string): string {
  const m = /^(\d+)-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(timestamp);
  if (!m)
    throw new Error(`layerFilename: timestamp must be ISO-8601: ${timestamp}`);
  const [, year, mm, dd, hh, mi, ss] = m;
  const paddedYear = year.padStart(4, "0");
  return `${paddedYear}-${mm}-${dd}T${hh}${mi}${ss}-${slug}.md`;
}

interface SerializableLayer {
  timestamp: string;
  message: string;
  changes: EditableChange[];
  body?: string;
}

export function serializeLayer(layer: SerializableLayer): string {
  const lines: string[] = ["---"];
  lines.push(`timestamp: ${yamlString(layer.timestamp)}`);
  lines.push(`message: ${yamlString(layer.message)}`);
  if (layer.changes.length === 0) {
    lines.push("changes: []");
  } else {
    lines.push("changes:");
    for (const c of layer.changes) {
      lines.push(...serializeChange(c));
    }
  }
  lines.push("---");
  const body = layer.body?.trim() ?? "";
  return `${lines.join("\n")}\n${body ? `\n${body}\n` : ""}`;
}

function serializeChange(c: EditableChange): string[] {
  const out: string[] = [`  - op: ${c.op}`];
  if (c.op === "add") {
    out.push(`    slug: ${yamlString(c.slug)}`);
    out.push(`    name: ${yamlString(c.name)}`);
    out.push(`    faction: ${yamlString(c.faction)}`);
    out.push("    hexes:");
    for (const [q, r] of c.hexes) out.push(`      - [${q}, ${r}]`);
  } else if (c.op === "update") {
    out.push(`    slug: ${yamlString(c.slug)}`);
    if (c.name !== undefined) out.push(`    name: ${yamlString(c.name)}`);
    if (c.faction !== undefined)
      out.push(`    faction: ${yamlString(c.faction)}`);
    if (c.hexes !== undefined) {
      out.push("    hexes:");
      for (const [q, r] of c.hexes) out.push(`      - [${q}, ${r}]`);
    }
  } else if (c.op === "remove") {
    out.push(`    slug: ${yamlString(c.slug)}`);
  } else if (c.op === "skein-add") {
    out.push(`    slug: ${yamlString(c.slug)}`);
    out.push(`    name: ${yamlString(c.name)}`);
    out.push(`    faction: ${yamlString(c.faction)}`);
    out.push(`    hex: [${c.hex[0]}, ${c.hex[1]}]`);
    out.push(`    symbol: ${yamlString(c.symbol)}`);
  } else if (c.op === "skein-connect") {
    out.push(`    from: ${yamlString(c.from)}`);
    out.push(`    to: ${yamlString(c.to)}`);
  } else if (c.op === "skein-remove") {
    out.push(`    slug: ${yamlString(c.slug)}`);
  } else if (c.op === "claim") {
    out.push(
      `    faction: ${c.faction === null ? "null" : yamlString(c.faction)}`,
    );
    out.push("    hexes:");
    for (const [q, r] of c.hexes) out.push(`      - [${q}, ${r}]`);
  }
  return out;
}

// Always emit double-quoted YAML strings — safe for any of the values we write
// (timestamps, slugs, names, log messages). Escapes the only two chars that
// need it inside a double-quoted YAML scalar.
function yamlString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function nowIsoUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export type { Layer };
