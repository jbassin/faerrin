// Pre-build content pipeline.
//
// Reads content/factions/*.md and content/layers/*.md, converts markdown to
// HTML, and emits typed TS modules under src/generated/. The runtime app
// imports those modules — never the filesystem — so the production bundle has
// no fs/remark/gray-matter dependency.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { remark } from "remark";
import remarkHtml from "remark-html";
import {
  foldFactionOverrides,
  foldRegions,
  foldSkein,
  type Change,
  type Layer,
  type Region,
  type SkeinState,
} from "../src/lib/regions.ts";
import {
  FACTION_HEXES,
  UNOWNED_BASE_HEXES,
  computeAssignmentBorders,
  computeEffectiveAssignments,
  type EdgeSegment,
} from "../src/lib/hexUtils.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const FACTIONS_DIR = path.join(ROOT, "content", "factions");
const LAYERS_DIR = path.join(ROOT, "content", "layers");
const SYMBOLS_DIR = path.join(ROOT, "public", "symbols");
const OUT_DIR = path.join(ROOT, "src", "generated");

interface Member {
  name: string;
  bio: string;
}

interface Faction {
  name: string;
  slug: string;
  color: string;
  order: number;
  symbol: string | null;
  description: string;
  members: Member[];
}

async function toHtml(markdown: string): Promise<string> {
  const result = await remark().use(remarkHtml).process(markdown);
  return result.toString().trim();
}

const HIDDEN_RE = /<!--\s*hidden\s*-->/i;

function splitBody(body: string): {
  descriptionMd: string;
  memberEntries: Array<{ name: string; content: string }>;
} {
  const knownMembersMatch = body.match(/^## Known Members([^\n]*)$/m);
  let descriptionMd = body.trim();
  const memberEntries: Array<{ name: string; content: string }> = [];

  if (knownMembersMatch && knownMembersMatch.index !== undefined) {
    const knownMembersIndex = knownMembersMatch.index;
    descriptionMd = body.slice(0, knownMembersIndex).trim();

    if (HIDDEN_RE.test(knownMembersMatch[1])) {
      return { descriptionMd, memberEntries };
    }

    const afterHeading = body
      .slice(knownMembersIndex)
      .replace(/^## Known Members[^\n]*\n/, "")
      .trim();

    for (const part of afterHeading.split(/^### /m).filter(Boolean)) {
      const newlineIdx = part.indexOf("\n");
      if (newlineIdx === -1) continue;
      const headingLine = part.slice(0, newlineIdx).trim();
      if (HIDDEN_RE.test(headingLine)) continue;
      memberEntries.push({
        name: headingLine,
        content: part.slice(newlineIdx).trim(),
      });
    }
  }

  return { descriptionMd, memberEntries };
}

async function parseFaction(filePath: string): Promise<Faction> {
  const filename = path.basename(filePath, ".md");
  const dashIndex = filename.indexOf("-");
  const order = Number.parseInt(filename.slice(0, dashIndex), 10);
  const slug = filename.slice(dashIndex + 1);

  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);
  const { descriptionMd, memberEntries } = splitBody(content);

  const description = await toHtml(descriptionMd);
  const members = await Promise.all(
    memberEntries.map(async ({ name, content: bioMd }) => ({
      name,
      bio: await toHtml(bioMd),
    })),
  );

  return {
    name: data.name as string,
    slug,
    color: data.color as string,
    order,
    symbol: (data.symbol as string | null) ?? null,
    description,
    members,
  };
}

async function buildFactions(): Promise<Faction[]> {
  const files = fs.readdirSync(FACTIONS_DIR).filter((f) => f.endsWith(".md"));
  const factions = await Promise.all(
    files.map((f) => parseFaction(path.join(FACTIONS_DIR, f))),
  );
  return factions.sort((a, b) => a.order - b.order);
}

// Layer parsing — mirrors src/lib/layers.ts.

function isHexPair(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number"
  );
}

function parseChange(raw: unknown, ctx: string): Change {
  if (!raw || typeof raw !== "object")
    throw new Error(`${ctx}: change must be an object`);
  const c = raw as Record<string, unknown>;

  if (c.op === "skein-connect" || c.op === "skein-disconnect") {
    if (typeof c.from !== "string" || c.from === "") {
      throw new Error(`${ctx}: ${c.op} missing string 'from'`);
    }
    if (typeof c.to !== "string" || c.to === "") {
      throw new Error(`${ctx}: ${c.op} missing string 'to'`);
    }
    return { op: c.op, from: c.from, to: c.to };
  }

  if (c.op === "claim") {
    if (!Array.isArray(c.hexes) || !c.hexes.every(isHexPair)) {
      throw new Error(`${ctx}: claim 'hexes' must be an array of [q, r] pairs`);
    }
    if (c.faction !== null && typeof c.faction !== "string") {
      throw new Error(`${ctx}: claim 'faction' must be a string slug or null`);
    }
    if (typeof c.faction === "string" && c.faction === "") {
      throw new Error(`${ctx}: claim 'faction' must not be an empty string`);
    }
    return {
      op: "claim",
      hexes: c.hexes as Array<[number, number]>,
      faction: c.faction as string | null,
    };
  }

  const slug = c.slug;
  if (typeof slug !== "string" || slug === "") {
    throw new Error(`${ctx}: change is missing a string 'slug'`);
  }

  if (c.op === "add") {
    if (typeof c.name !== "string")
      throw new Error(`${ctx}: add ${slug} missing 'name'`);
    if (typeof c.faction !== "string")
      throw new Error(`${ctx}: add ${slug} missing 'faction'`);
    if (!Array.isArray(c.hexes) || !c.hexes.every(isHexPair)) {
      throw new Error(
        `${ctx}: add ${slug} 'hexes' must be an array of [q, r] pairs`,
      );
    }
    return {
      op: "add",
      slug,
      name: c.name,
      faction: c.faction,
      hexes: c.hexes as Array<[number, number]>,
    };
  }

  if (c.op === "update") {
    const out: Change = { op: "update", slug };
    if (c.name !== undefined) {
      if (typeof c.name !== "string")
        throw new Error(`${ctx}: update ${slug} 'name' must be a string`);
      out.name = c.name;
    }
    if (c.faction !== undefined) {
      if (typeof c.faction !== "string")
        throw new Error(`${ctx}: update ${slug} 'faction' must be a string`);
      out.faction = c.faction;
    }
    if (c.hexes !== undefined) {
      if (!Array.isArray(c.hexes) || !c.hexes.every(isHexPair)) {
        throw new Error(
          `${ctx}: update ${slug} 'hexes' must be an array of [q, r] pairs`,
        );
      }
      out.hexes = c.hexes as Array<[number, number]>;
    }
    return out;
  }

  if (c.op === "remove") return { op: "remove", slug };

  if (c.op === "skein-add") {
    if (typeof c.name !== "string")
      throw new Error(`${ctx}: skein-add ${slug} missing 'name'`);
    if (typeof c.faction !== "string")
      throw new Error(`${ctx}: skein-add ${slug} missing 'faction'`);
    if (!isHexPair(c.hex)) {
      throw new Error(`${ctx}: skein-add ${slug} 'hex' must be a [q, r] pair`);
    }
    if (typeof c.symbol !== "string" || c.symbol === "")
      throw new Error(`${ctx}: skein-add ${slug} missing 'symbol'`);
    return {
      op: "skein-add",
      slug,
      name: c.name,
      faction: c.faction,
      hex: c.hex,
      symbol: c.symbol,
    };
  }

  if (c.op === "skein-update") {
    const out: Change = { op: "skein-update", slug };
    if (c.name !== undefined) {
      if (typeof c.name !== "string")
        throw new Error(`${ctx}: skein-update ${slug} 'name' must be a string`);
      out.name = c.name;
    }
    if (c.faction !== undefined) {
      if (typeof c.faction !== "string")
        throw new Error(
          `${ctx}: skein-update ${slug} 'faction' must be a string`,
        );
      out.faction = c.faction;
    }
    if (c.hex !== undefined) {
      if (!isHexPair(c.hex)) {
        throw new Error(
          `${ctx}: skein-update ${slug} 'hex' must be a [q, r] pair`,
        );
      }
      out.hex = c.hex;
    }
    if (c.symbol !== undefined) {
      if (typeof c.symbol !== "string")
        throw new Error(
          `${ctx}: skein-update ${slug} 'symbol' must be a string`,
        );
      out.symbol = c.symbol;
    }
    return out;
  }

  if (c.op === "skein-remove") return { op: "skein-remove", slug };

  throw new Error(
    `${ctx}: unknown op '${String(c.op)}' (expected add | update | remove | skein-add | skein-update | skein-remove | skein-connect | skein-disconnect | claim)`,
  );
}

const LAYER_FILENAME_RE = /^(\d{4}-\d{2}-\d{2}T\d{6})-(.+)$/;

function parseLayer(filePath: string): Layer {
  const filename = path.basename(filePath, ".md");
  const m = LAYER_FILENAME_RE.exec(filename);
  if (!m) {
    throw new Error(
      `Layer filename must be {YYYY}-{MM}-{DD}T{HHMMSS}-{slug}.md: ${filename}.md`,
    );
  }
  const slug = m[2];

  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);

  if (typeof data.timestamp !== "string") {
    throw new Error(`Layer ${slug} missing string 'timestamp' in frontmatter`);
  }
  const message = typeof data.message === "string" ? data.message : "";
  if (!Array.isArray(data.changes))
    throw new Error(`Layer ${slug} 'changes' must be an array`);

  const changes = data.changes.map((c, i) =>
    parseChange(c, `layer ${slug} change #${i}`),
  );
  return {
    slug,
    timestamp: data.timestamp,
    message,
    changes,
    body: content.trim(),
  };
}

function buildLayers(): Layer[] {
  if (!fs.existsSync(LAYERS_DIR)) return [];
  const files = fs
    .readdirSync(LAYERS_DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md" && f !== "CLAUDE.md");
  const layers = files.map((f) => parseLayer(path.join(LAYERS_DIR, f)));
  return layers.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
    return a.slug.localeCompare(b.slug);
  });
}

// Emit.

const HEADER = `// AUTO-GENERATED by scripts/build-content.ts. Do not edit.\n`;

function emit(filename: string, source: string): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, filename), source);
}

function emitFactions(factions: Faction[]): void {
  const source = `${HEADER}import type { Faction } from "@/lib/factions";

export const FACTIONS: readonly Faction[] = ${JSON.stringify(factions, null, 2)};

const BY_SLUG: ReadonlyMap<string, Faction> = new Map(FACTIONS.map((f) => [f.slug, f]));

export function factionBySlug(slug: string): Faction | undefined {
  return BY_SLUG.get(slug);
}
`;
  emit("factions.ts", source);
}

function emitLayers(
  layers: Layer[],
  regions: Region[],
  skein: SkeinState,
  factionHexes: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  unownedHexes: ReadonlyArray<readonly [number, number]>,
  factionBorders: ReadonlyArray<EdgeSegment>,
  territoryBorders: ReadonlyArray<ReadonlyArray<EdgeSegment>>,
): void {
  const source = `${HEADER}import type { Layer, Region, SkeinState } from "@/lib/regions";
import type { EdgeSegment } from "@/lib/hexUtils";

export const LAYERS: readonly Layer[] = ${JSON.stringify(layers, null, 2)};

export const CURRENT_REGIONS: readonly Region[] = ${JSON.stringify(regions, null, 2)};

export const CURRENT_SKEIN: SkeinState = ${JSON.stringify(skein, null, 2)};

export const CURRENT_FACTION_HEXES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = ${JSON.stringify(factionHexes)};

export const CURRENT_UNOWNED_HEXES: ReadonlyArray<readonly [number, number]> = ${JSON.stringify(unownedHexes)};

export const CURRENT_FACTION_BORDERS: ReadonlyArray<EdgeSegment> = ${JSON.stringify(factionBorders)};

export const CURRENT_FACTION_TERRITORY_BORDERS: ReadonlyArray<ReadonlyArray<EdgeSegment>> = ${JSON.stringify(territoryBorders)};
`;
  emit("layers.ts", source);
}

function emitContentHash(hash: string): void {
  emit(
    "contentHash.ts",
    `${HEADER}export const CONTENT_HASH = ${JSON.stringify(hash)};\n`,
  );
}

function emitGitignore(): void {
  emit(".gitignore", "*\n!.gitignore\n");
}

function walkFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFilesRecursive(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function computeContentHash(): string {
  const factionFiles = fs.existsSync(FACTIONS_DIR)
    ? fs
        .readdirSync(FACTIONS_DIR)
        .filter((f) => f.endsWith(".md"))
        .map((f) => path.join(FACTIONS_DIR, f))
    : [];
  const layerFiles = fs.existsSync(LAYERS_DIR)
    ? fs
        .readdirSync(LAYERS_DIR)
        .filter(
          (f) => f.endsWith(".md") && f !== "README.md" && f !== "CLAUDE.md",
        )
        .map((f) => path.join(LAYERS_DIR, f))
    : [];
  const symbolFiles = walkFilesRecursive(SYMBOLS_DIR);

  const files = [...factionFiles, ...layerFiles, ...symbolFiles]
    .map((abs) => ({ abs, rel: path.relative(ROOT, abs) }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const hash = crypto.createHash("sha256");
  for (const { abs, rel } of files) {
    hash.update(rel);
    hash.update("\0");
    hash.update(fs.readFileSync(abs));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

async function main(): Promise<void> {
  const factions = await buildFactions();
  const layers = buildLayers();
  const regions = foldRegions(layers);
  const skein = foldSkein(layers);
  const overrides = foldFactionOverrides(layers);
  const factionSlugs = factions.map((f) => f.slug);
  const effective = computeEffectiveAssignments(
    FACTION_HEXES,
    UNOWNED_BASE_HEXES,
    overrides,
    factionSlugs,
  );
  const { allBorders: factionBorders, perFaction: territoryBorders } =
    computeAssignmentBorders(effective.perFaction);

  const contentHash = computeContentHash();

  emitFactions(factions);
  emitLayers(
    layers,
    regions,
    skein,
    effective.perFaction,
    effective.unowned,
    factionBorders,
    territoryBorders,
  );
  emitContentHash(contentHash);
  emitGitignore();

  console.log(
    `[build-content] ${factions.length} factions, ${layers.length} layers, ${regions.length} regions, ${skein.regions.length} skein regions, ${skein.connections.length} skein connections, ${overrides.size} hex overrides (${effective.unowned.length} unowned), hash=${contentHash}`,
  );
}

main().catch((err: unknown) => {
  console.error("[build-content] failed:", err);
  process.exit(1);
});
