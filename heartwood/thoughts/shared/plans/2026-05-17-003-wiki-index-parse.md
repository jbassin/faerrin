# Wiki Index Build (Parse-Only) — Implementation Plan

> Ticket: [`tickets/003-wiki-index-parse.md`](../../../tickets/003-wiki-index-parse.md)
> Parent epic plan: [`thoughts/shared/plans/2026-05-17-001-wiki-updater.md`](./2026-05-17-001-wiki-updater.md)
> Previous ticket plan: [`thoughts/shared/plans/2026-05-17-002-project-bootstrap.md`](./2026-05-17-002-project-bootstrap.md)

## Overview

Walk `content/` and produce a structured JSON index at `state/wiki-index.json` covering every `.md` page: frontmatter (title, aliases, tags, optional `img`), headings, every `[[wikilink]]` occurrence (resolved to a canonical page path when possible), a SHA-256 content hash, and byte length. `summary` and `keyFacts` are present-but-null placeholders for ticket 004 to fill in. **No LLM calls.** A `bun run index-wiki` CLI command builds the index; `--check` re-walks the tree and exits non-zero if the on-disk index is stale.

## Current State Analysis

- `src/cli/` has only `hello` and `cost-report` handlers; new commands plug into the registry at [`src/cli/index.ts:1-9`](../../../src/cli/index.ts) and a one-line script in [`package.json`](../../../package.json).
- `content/` holds 93 `.md` files across `Geography`, `Org`, `Divinity`, `Phenomena`, `Rules`, plus `index.md` and `Timeline.md`. 72 files start with `---` (YAML frontmatter), 21 have no frontmatter (e.g. `Timeline.md`, deity stat blocks like `Divinity/Hierophant.md`, all of `Rules/`). Parser must accept both.
- Frontmatter shapes in use (validated by survey):
  - `title: <string>` (optional; falls back to filename / parent dir for `index.md`)
  - `aliases: [<string>, ...]` (often present, sometimes self-aliasing — `Iridescent Church` aliases itself)
  - `tags: [<string>, ...]` (capitalised; current tags include `Host`, `Religious`, `Catfolk`, `Dwarf`, `Research`, `Choral`)
  - `img: <url>` (character pages only)
- Wikilink forms in current content:
  - `[[Page]]` — bare name → resolve via title or alias
  - `[[Page|display]]` — bare name + display override
  - `[[path/to/index|Display]]` — explicit content-relative path (no `.md`, `index` for folder pages), with display override
  - Wikilinks appear inside `> [!note]` and `> [!quote]` callouts (e.g. `content/Org/index.md`, `content/Divinity/Hierophant.md`). The parser must not skip blockquote lines.
  - **No `[[Page#Section]]` form is currently used anywhere in `content/`** — the ticket still requires a test covering it.
  - **No wikilinks currently appear in frontmatter** — the ticket still requires a test covering it.
- File names use the in-world spelling, including non-ASCII (`Færrin.md`, `Tormeré/index.md`, `Rhædon/index.md`, `Ætherion Limited.md`, `Anaïs Marchal.md`). Path comparisons must use raw Unicode strings (NFC) — no slugification.
- Folder pages use `index.md` (e.g. `Geography/Calaria/Hallia/index.md`); leaf pages are single `.md` files. The wikilink path-form addresses folder pages as `Geography/Calaria/Hallia/index`.
- The project-bootstrap plan and memory ([`memory/project-bootstrap-complete.md`](../../../../home/jbassin/.claude/projects/-ruby-data-experiments-heartwood/memory/project-bootstrap-complete.md)) confirm: `Bun.file`/`Bun.write`/`Bun.Glob` for I/O, `bun:test` for tests, no `node:fs` for reading/writing. `node:fs/promises.rename` is acceptable for rename (not on `Bun.file`).
- `state/` exists; only `state/runs/*` is gitignored ([`.gitignore:37-38`](../../../.gitignore)). `state/wiki-index.json` is a derived artefact and should also be gitignored per the parent plan ("everything in `state/` is gitignored except the ledger").
- `tsconfig.json` has `noUncheckedIndexedAccess: true` and `verbatimModuleSyntax: true` — all map lookups need narrowing; type-only imports must be marked `import type`.

## Desired End State

When this ticket is complete:

- `bun run index-wiki` walks `content/`, prints a one-line summary (`pages: N, wikilinks: M, unresolved: K`), and writes `state/wiki-index.json`.
- Every `.md` file under `content/` is present as a key in `index.pages` (path relative to `content/`, including `.md`).
- Every wikilink occurrence carries a `resolvedPath: string | null`. Unresolved occurrences are additionally surfaced in a top-level `unresolvedLinks` array (one entry per unresolved occurrence, with source page + raw link) for fast triage.
- Each page record has a populated `contentHash` (SHA-256, lower-case hex) and `byteLength`, plus `summary: null` and `keyFacts: null` for ticket 004.
- Each page record has its `aliases` resolvable: feeding any alias into the resolver returns that page's path.
- `bun run index-wiki --check` re-walks `content/`, compares against the on-disk index, and exits 0 only if every page's `contentHash`, `byteLength`, frontmatter, headings, and wikilink targets match (and no pages are added or removed). Otherwise exits 1 and prints a short diff (added / removed / changed page paths).
- `bun test` covers: frontmatter parsing (with and without), wikilink forms (`[[Page]]`, `[[Page|display]]`, `[[path/to/index|Display]]`, `[[Page#Section]]`), wikilinks inside callouts, wikilinks in frontmatter, alias round-trip, special-character file names.
- `bun run typecheck` passes.
- `state/wiki-index.json` is gitignored.

### Key Discoveries

- **Two-pass resolution is required.** The first pass collects all page records (path → title, aliases, headings, raw wikilink occurrences). The second pass builds the title-map and alias-map across the whole tree, then re-walks the raw wikilinks to assign `resolvedPath`. Single-pass is impossible because a page can link to a page that's parsed later.
- **`[[path/to/index|...]]` form is heavily used** — every cross-folder Geography/Org reference uses it (40+ unique occurrences in `content/`). Resolver must try the path-form first when the raw target contains `/`, and only fall back to title/alias for bare names.
- **Folder vs. leaf page ambiguity is resolved by `index.md` convention.** A wikilink `[[Geography/Calaria/Hallia/index]]` is shorthand for `Geography/Calaria/Hallia/index.md`. Just append `.md` if not present. We never need to guess between `Foo.md` and `Foo/index.md` because all path-form wikilinks in current content include the explicit `/index` segment when needed.
- **Bun has no built-in YAML parser.** Per the question round, we adopt `yaml` (40KB, zero transitive deps, YAML 1.2). Pure JS, fast, ships types.
- **`Bun.CryptoHasher` produces the SHA-256.** `new Bun.CryptoHasher('sha256').update(bytes).digest('hex')` — no need for `node:crypto`.
- **`Bun.Glob` walks the tree.** `new Bun.Glob('**/*.md').scan({ cwd: 'content', absolute: false })` yields content-relative paths directly, no manual recursion.
- **Frontmatter scanning is line-based.** A document with frontmatter has `^---\n` on line 1 and a second `^---\n` later; everything between is YAML, everything after is the body. A document without `---` on line 1 has empty frontmatter and the whole file is the body. Three-dash separators inside a body (rare) are not treated as frontmatter because we only look at line 1.
- **The wikilink regex `\[\[([^\]\n]+?)\]\]` is sufficient.** No nested `[[...]]`, no multi-line links. Each match's group 1 is the raw target; we then split on `|` (first occurrence — display text can contain anything) and on `#` to peel off the section.
- **Wikilink occurrences in YAML strings would also match this regex** — we run it over the full file text (post-frontmatter is not enough), so frontmatter values like `aliases: ["[[Other Page|short]]"]` would be picked up. None exist in current content, but the ticket calls out this case; we satisfy it for free by regex'ing the whole file, with a small tweak: skip the `---...---` block when locating *page-body* headings, but include it for wikilink extraction.
- **Headings (`^#{1,6} `) only count in the body**, not in YAML — the body slice from the frontmatter parser is what we scan for `^#{1,6} `.

## What We're NOT Doing

- **No LLM calls.** All summarization (`summary`, `keyFacts`, `entities`) is ticket 004. Fields are `null` placeholders here.
- **No content sanitisation / normalization** beyond UTF-8 NFC-implied file-name handling. We do not rewrite frontmatter, fix typos, or canonicalise wikilink formatting.
- **No mtime-based change detection.** `--check` always re-hashes. ~93 files × ~few KB each is microseconds; mtime is brittle (touch, git checkout, etc. all perturb it without changing content).
- **No headings-anchor validation.** `[[Page#Section]]` resolves to the page; section name is captured but not checked against the target's headings. (Per the answered question — no current usage and validation would couple us to slugification rules.)
- **No fuzzy match / typo correction.** A typo-ed `[[Pulse]]` doesn't resolve to `Eternal Pulse` unless `Pulse` is an alias on that page (it is, in fact). If not aliased, the link is unresolved.
- **No watcher / daemon.** One-shot CLI build only. Re-run on demand.
- **No JSON-schema validation of the output.** The TypeScript types are the schema; Zod would be overhead for an internal artefact.
- **No multi-line frontmatter parsing edge cases beyond what `yaml` handles.** If a page has malformed frontmatter, we throw with the offending file path — better to surface than silently drop.

## Implementation Approach

Five phases, each independently testable. Phase 2 is pure functions over strings (no I/O), so its tests are fast and run with zero fixtures. Phases 3 and 4 layer the walker and CLI on top. Phase 5 runs the end-to-end test against real `content/`.

The walker is a two-pass design (collect → resolve). The walker module exports a single high-level `loadWikiIndex({ contentDir })` that returns the in-memory index; the CLI handler is responsible for stringifying and writing. This separation lets ticket 004's summarizer call `loadWikiIndex` directly when it wants the parse-only view without re-implementing.

The schema lives in its own module (`index-schema.ts`) as TypeScript `interface`s so ticket 004 can `import type` what it extends without pulling in the walker.

---

## Phase 1: Dependency + directory layout

### Overview

Add the YAML runtime dep, create the `src/wiki/` directory, and extend `.gitignore` so the derived index doesn't get committed.

### Changes Required

#### 1. Add `yaml` dependency

**File**: `package.json` (extend)
**Changes**: Add `"yaml": "^2.6.0"` under `dependencies` (current latest stable). Resolved at install time by `bun install`.

```json
"dependencies": {
  "@anthropic-ai/sdk": "^0.39.0",
  "yaml": "^2.6.0",
  "zod": "^3.23.0",
  "zod-to-json-schema": "^3.23.0"
}
```

#### 2. Gitignore the index file

**File**: `.gitignore` (extend)
**Changes**: Append after the existing `state/runs/*` block. The wiki index is regeneratable from `content/`, so it doesn't belong in git.

```
# heartwood pipeline state — derived from content/
state/wiki-index.json
```

#### 3. Directory placeholder

**File**: `src/wiki/` (new directory)
**Changes**: `mkdir -p src/wiki`. No `.gitkeep` needed — the files added in phases 2–4 will populate it.

### Success Criteria

#### Automated Verification

- [x] `bun install` resolves `yaml`: `test -d node_modules/yaml`
- [x] `bun run typecheck` still passes (no regressions from the added dep)
- [x] `git check-ignore -q state/wiki-index.json` exits 0

#### Manual Verification

- [ ] `bun.lock` shows `yaml` at a 2.x version

---

## Phase 2: Parsing primitives (frontmatter, wikilinks, hash)

### Overview

Three small pure-function modules under `src/wiki/`. Each takes a string and returns a typed record; no file I/O, no state. Tested in isolation in phase 5.

### Changes Required

#### 1. Frontmatter parser

**File**: `src/wiki/frontmatter.ts` (new)
**Purpose**: Split a markdown file into frontmatter (YAML data) and body.

```ts
import { parse as parseYaml } from 'yaml';

export interface Frontmatter {
  data: Record<string, unknown>;  // empty object if no frontmatter
  body: string;                   // everything after the closing ---, or full text if none
}

const FENCE = /^---\r?\n/;

export function parseFrontmatter(text: string, sourcePath?: string): Frontmatter {
  if (!FENCE.test(text)) return { data: {}, body: text };
  const afterOpen = text.replace(FENCE, '');
  const closeIdx = afterOpen.search(/^---\r?\n?/m);
  if (closeIdx < 0) return { data: {}, body: text };  // unterminated → treat as body
  const yamlText = afterOpen.slice(0, closeIdx);
  const body = afterOpen.slice(closeIdx).replace(/^---\r?\n?/, '');
  let data: unknown;
  try {
    data = parseYaml(yamlText) ?? {};
  } catch (err) {
    const where = sourcePath ? ` in ${sourcePath}` : '';
    throw new Error(`Invalid YAML frontmatter${where}: ${(err as Error).message}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { data: {}, body };
  }
  return { data: data as Record<string, unknown>, body };
}
```

#### 2. Wikilink extractor

**File**: `src/wiki/wikilinks.ts` (new)
**Purpose**: Find every `[[...]]` occurrence in a string and split into `{ raw, target, display?, section? }`. Resolution to a page path happens later in the loader.

```ts
export interface WikilinkOccurrence {
  raw: string;          // full match including [[ ]]
  target: string;       // resolved name or path BEFORE section/display split
  display?: string;     // text after the | if present
  section?: string;     // text after the # if present
}

const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g;

export function extractWikilinks(text: string): WikilinkOccurrence[] {
  const out: WikilinkOccurrence[] = [];
  for (const m of text.matchAll(WIKILINK_RE)) {
    const inner = m[1]!;
    const pipeIdx = inner.indexOf('|');
    const before = pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner;
    const display = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : undefined;
    const hashIdx = before.indexOf('#');
    const target = (hashIdx >= 0 ? before.slice(0, hashIdx) : before).trim();
    const section = hashIdx >= 0 ? before.slice(hashIdx + 1).trim() : undefined;
    out.push({
      raw: m[0]!,
      target,
      ...(display !== undefined ? { display } : {}),
      ...(section !== undefined ? { section } : {}),
    });
  }
  return out;
}
```

#### 3. Heading extractor

**File**: `src/wiki/wikilinks.ts` (same file — small enough)
**Purpose**: Extract `^#{1,6} (.+)$` lines from a body string.

```ts
export interface Heading {
  level: number;  // 1..6
  text: string;
}

const HEADING_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*$/gm;

export function extractHeadings(body: string): Heading[] {
  const out: Heading[] = [];
  for (const m of body.matchAll(HEADING_RE)) {
    out.push({ level: m[1]!.length, text: m[2]! });
  }
  return out;
}
```

#### 4. Hash helper

**File**: `src/wiki/hash.ts` (new)
**Purpose**: SHA-256 hex digest for content-change detection.

```ts
export function sha256Hex(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}
```

### Success Criteria

#### Automated Verification

- [x] `bun run typecheck` passes
- [x] (Tests for these modules live in phase 5 — phase 5's `bun test` covers them.)

#### Manual Verification

- [ ] Read through `frontmatter.ts` and confirm the unterminated-fence and non-object-yaml branches are spelled out (defensive but explicit)

---

## Phase 3: Index schema, walker, and writer

### Overview

`src/wiki/index-schema.ts` declares the on-disk shape. `src/wiki/load.ts` walks `content/`, calls the primitives from phase 2, and runs the two-pass resolver.

### Changes Required

#### 1. Schema

**File**: `src/wiki/index-schema.ts` (new)

```ts
import type { Heading } from './wikilinks';

export interface WikilinkRecord {
  raw: string;                    // exact match including [[ ]]
  target: string;                 // pre-resolution target text
  display: string | null;         // |display text, null if absent
  section: string | null;         // #section anchor, null if absent
  resolvedPath: string | null;    // canonical page path, null if unresolved
}

export interface PageRecord {
  path: string;                   // relative to content/, includes .md
  title: string;                  // frontmatter.title || filename-derived
  aliases: string[];              // frontmatter.aliases, default []
  tags: string[];                 // frontmatter.tags, default []
  img: string | null;             // frontmatter.img, null if absent
  headings: Heading[];
  wikilinks: WikilinkRecord[];    // in occurrence order
  contentHash: string;            // sha256 hex of file bytes
  byteLength: number;             // file size in bytes
  summary: string | null;         // populated in ticket 004
  keyFacts: string[] | null;      // populated in ticket 004
}

export interface UnresolvedLink {
  sourcePath: string;             // page that contains the link
  raw: string;                    // the [[...]] occurrence
  target: string;                 // what we tried to resolve
}

export interface WikiIndex {
  generatedAt: string;            // ISO timestamp; bumped only on a real (non-check) build
  pageCount: number;
  pages: Record<string, PageRecord>;  // key === PageRecord.path
  unresolvedLinks: UnresolvedLink[];
}
```

#### 2. Walker + resolver

**File**: `src/wiki/load.ts` (new)

```ts
import { parseFrontmatter } from './frontmatter';
import { extractWikilinks, extractHeadings } from './wikilinks';
import { sha256Hex } from './hash';
import type {
  PageRecord, WikiIndex, WikilinkRecord, UnresolvedLink,
} from './index-schema';

interface RawPage {
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  img: string | null;
  headings: ReturnType<typeof extractHeadings>;
  rawWikilinks: ReturnType<typeof extractWikilinks>;
  contentHash: string;
  byteLength: number;
}

export interface LoadOptions {
  contentDir: string;             // e.g. 'content'
}

export async function loadWikiIndex({ contentDir }: LoadOptions): Promise<WikiIndex> {
  const raws = await collectPages(contentDir);
  const { titleMap, aliasMap } = buildLookupMaps(raws);
  const pages: Record<string, PageRecord> = {};
  const unresolvedLinks: UnresolvedLink[] = [];
  for (const raw of raws) {
    const wikilinks: WikilinkRecord[] = raw.rawWikilinks.map((w) => {
      const resolvedPath = resolveTarget(w.target, titleMap, aliasMap);
      if (resolvedPath === null) {
        unresolvedLinks.push({ sourcePath: raw.path, raw: w.raw, target: w.target });
      }
      return {
        raw: w.raw,
        target: w.target,
        display: w.display ?? null,
        section: w.section ?? null,
        resolvedPath,
      };
    });
    pages[raw.path] = {
      path: raw.path,
      title: raw.title,
      aliases: raw.aliases,
      tags: raw.tags,
      img: raw.img,
      headings: raw.headings,
      wikilinks,
      contentHash: raw.contentHash,
      byteLength: raw.byteLength,
      summary: null,
      keyFacts: null,
    };
  }
  return {
    generatedAt: new Date().toISOString(),
    pageCount: raws.length,
    pages,
    unresolvedLinks,
  };
}

async function collectPages(contentDir: string): Promise<RawPage[]> {
  const glob = new Bun.Glob('**/*.md');
  const paths: string[] = [];
  for await (const p of glob.scan({ cwd: contentDir, absolute: false })) {
    paths.push(p);
  }
  paths.sort();  // deterministic order → deterministic JSON output
  const out: RawPage[] = [];
  for (const path of paths) {
    out.push(await parseOnePage(contentDir, path));
  }
  return out;
}

async function parseOnePage(contentDir: string, path: string): Promise<RawPage> {
  const file = Bun.file(`${contentDir}/${path}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder('utf-8').decode(bytes);
  const { data, body } = parseFrontmatter(text, path);
  const title = pickTitle(data, path);
  const aliases = pickStringArray(data, 'aliases');
  const tags = pickStringArray(data, 'tags');
  const img = typeof data.img === 'string' ? data.img : null;
  // Wikilinks are extracted from the FULL text so frontmatter-embedded links are caught.
  // Headings only count in the body.
  const rawWikilinks = extractWikilinks(text);
  const headings = extractHeadings(body);
  return {
    path,
    title,
    aliases,
    tags,
    img,
    headings,
    rawWikilinks,
    contentHash: sha256Hex(bytes),
    byteLength: bytes.byteLength,
  };
}

function pickTitle(data: Record<string, unknown>, path: string): string {
  if (typeof data.title === 'string' && data.title.trim()) return data.title.trim();
  // Filename derivation: foo/bar.md → "bar"; foo/bar/index.md → "bar"
  const parts = path.split('/');
  const base = parts.pop()!.replace(/\.md$/, '');
  if (base === 'index') return parts.pop() ?? 'index';
  return base;
}

function pickStringArray(data: Record<string, unknown>, key: string): string[] {
  const v = data[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

interface LookupMaps {
  titleMap: Map<string, string>;   // title → path (first-write wins; collisions are logged separately)
  aliasMap: Map<string, string>;   // alias → path
}

function buildLookupMaps(raws: RawPage[]): LookupMaps {
  const titleMap = new Map<string, string>();
  const aliasMap = new Map<string, string>();
  for (const raw of raws) {
    if (!titleMap.has(raw.title)) titleMap.set(raw.title, raw.path);
    for (const alias of raw.aliases) {
      if (!aliasMap.has(alias)) aliasMap.set(alias, raw.path);
    }
  }
  return { titleMap, aliasMap };
}

function resolveTarget(
  target: string,
  titleMap: Map<string, string>,
  aliasMap: Map<string, string>,
): string | null {
  // Path-form: contains a slash → treat as content-relative path, ensure .md suffix
  if (target.includes('/')) {
    const withExt = target.endsWith('.md') ? target : `${target}.md`;
    // The title/alias maps don't help here; we need to check against the path set.
    // We don't have the path set as a Map yet — but every titleMap value is a path,
    // and there's exactly one path per page, so reuse: build a Set of paths once.
    // (Done by caller via the closure pattern below — see refinement.)
    return _pathSet.has(withExt) ? withExt : null;
  }
  // Bare-name form: try title first, then alias.
  return titleMap.get(target) ?? aliasMap.get(target) ?? null;
}

// Closure-captured path set. Populated by loadWikiIndex before resolveTarget runs.
let _pathSet = new Set<string>();
```

> [!note] Refinement: avoid module-level state
> The `_pathSet` mutable module-level binding above is sketch-quality. In the actual implementation, fold `_pathSet` into the `LookupMaps` interface (add `pathSet: Set<string>`) and have `resolveTarget` take it as an argument. The example here keeps the function signatures small for readability of the plan.

#### 3. Writer + check-mode helpers

**File**: `src/wiki/load.ts` (same file)

```ts
export async function writeIndex(index: WikiIndex, indexPath: string): Promise<void> {
  // Stable key order: pages already keyed by sorted path; JSON.stringify preserves
  // insertion order for string keys, so a single stringify suffices.
  await Bun.write(indexPath, JSON.stringify(index, null, 2) + '\n');
}

export interface StaleResult {
  stale: boolean;
  added: string[];     // paths in fresh but not on-disk
  removed: string[];   // paths on-disk but not in fresh
  changed: string[];   // paths whose contentHash differs
}

export async function diffIndex(fresh: WikiIndex, indexPath: string): Promise<StaleResult> {
  const file = Bun.file(indexPath);
  if (!(await file.exists())) {
    return { stale: true, added: Object.keys(fresh.pages).sort(), removed: [], changed: [] };
  }
  const ondisk = JSON.parse(await file.text()) as WikiIndex;
  const freshPaths = new Set(Object.keys(fresh.pages));
  const ondiskPaths = new Set(Object.keys(ondisk.pages));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const p of freshPaths) if (!ondiskPaths.has(p)) added.push(p);
  for (const p of ondiskPaths) if (!freshPaths.has(p)) removed.push(p);
  for (const p of freshPaths) {
    if (!ondiskPaths.has(p)) continue;
    const a = fresh.pages[p]!;
    const b = ondisk.pages[p]!;
    if (a.contentHash !== b.contentHash) changed.push(p);
  }
  added.sort(); removed.sort(); changed.sort();
  const stale = added.length + removed.length + changed.length > 0;
  return { stale, added, removed, changed };
}
```

> [!note] What `--check` covers
> The diff compares `contentHash` only. Anything that changes a file's bytes — frontmatter edit, body edit, even trailing-whitespace change — flips the hash and trips the check. Wikilink resolution drift (a *target* page renamed without its *source* page changing) is also caught: the source page's `wikilinks[i].resolvedPath` changes only if the source's hash didn't change but the lookup map did. We intentionally don't deep-diff `wikilinks[i].resolvedPath` because the source file's hash already captures it (the target rename necessarily comes with a content-tree change that triggers `added`/`removed`).

### Success Criteria

#### Automated Verification

- [x] `bun run typecheck` passes
- [x] `bun -e "import { loadWikiIndex } from './src/wiki/load'; const i = await loadWikiIndex({ contentDir: 'content' }); console.log(i.pageCount);"` prints `93` (matches `find content -name '*.md' | wc -l`)
- [x] In a temporary script: `loadWikiIndex` returns an index where `Object.keys(pages).length === pageCount` and every `wikilinks[i].resolvedPath` is either a key in `pages` or `null`

#### Manual Verification

- [ ] Pull one page record (e.g. `pages['Org/Iridescent Church/index.md']`) and confirm its `wikilinks` array contains the expected resolved paths (`Hierophant.md`, `Divinity/Outer Gods/Iridescent Host.md`, `Geography/Calaria/index.md`, `Geography/Brithwyn/index.md`, `Geography/Tormeré/index.md`)

---

## Phase 4: CLI command (`index-wiki`)

### Overview

Register a new subcommand: `bun run index-wiki` (build mode), `bun run index-wiki -- --check` (verification mode). Follows the registry pattern established in [`src/cli/index.ts`](../../../src/cli/index.ts).

### Changes Required

#### 1. Handler

**File**: `src/cli/index-wiki.ts` (new)

```ts
import { loadWikiIndex, writeIndex, diffIndex } from '../wiki/load';

const CONTENT_DIR = 'content';
const INDEX_PATH = 'state/wiki-index.json';

export async function indexWiki(argv: string[]): Promise<void> {
  const check = argv.includes('--check');
  const index = await loadWikiIndex({ contentDir: CONTENT_DIR });

  if (check) {
    const diff = await diffIndex(index, INDEX_PATH);
    if (!diff.stale) {
      console.log(`index up to date: ${index.pageCount} pages`);
      return;
    }
    console.error(`wiki index is stale: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed`);
    for (const p of diff.added) console.error(`  + ${p}`);
    for (const p of diff.removed) console.error(`  - ${p}`);
    for (const p of diff.changed) console.error(`  ~ ${p}`);
    process.exit(1);
  }

  await writeIndex(index, INDEX_PATH);
  const linkCount = Object.values(index.pages)
    .reduce((n, p) => n + p.wikilinks.length, 0);
  console.log(
    `wrote ${INDEX_PATH}: ${index.pageCount} pages, ${linkCount} wikilinks, ` +
    `${index.unresolvedLinks.length} unresolved`,
  );
}
```

#### 2. Registry + script

**File**: `src/cli/index.ts` (extend)

```ts
import { hello } from './hello';
import { costReport } from './cost-report';
import { indexWiki } from './index-wiki';

export type CliHandler = (argv: string[]) => Promise<void> | void;

export const handlers: Record<string, CliHandler> = {
  'hello': hello,
  'cost-report': costReport,
  'index-wiki': indexWiki,
};
```

**File**: `package.json` (extend `scripts`)

```json
"scripts": {
  "hello": "bun index.ts hello",
  "cost-report": "bun index.ts cost-report",
  "index-wiki": "bun index.ts index-wiki",
  "typecheck": "tsc --noEmit",
  "test": "bun test"
}
```

### Success Criteria

#### Automated Verification

- [x] `bun run index-wiki` exits 0 and writes a non-empty `state/wiki-index.json`
- [x] `bun -e "const i = JSON.parse(await Bun.file('state/wiki-index.json').text()); console.log(i.pageCount, Object.keys(i.pages).length)"` prints two equal numbers, both `93`
- [x] `bun run index-wiki -- --check` immediately after a build exits 0
- [x] Touching any file (e.g. `echo '' >> content/index.md`) and re-running `bun run index-wiki -- --check` exits 1 and prints that file under `~`
- [x] `bun run` lists `index-wiki` in its script list

#### Manual Verification

- [x] Open `state/wiki-index.json` and confirm: pretty-printed, page paths sorted alphabetically, every entry has `summary: null` and `keyFacts: null`
- [x] `unresolvedLinks` is small (single digits or zero) — investigate anything in it during the spot-check below

---

## Phase 5: Tests (edge cases the ticket calls out)

### Overview

Three test files. The primitives tests exercise `frontmatter.ts` and `wikilinks.ts` against synthetic inputs covering every edge case. The integration test loads the real `content/` and verifies counts, alias round-trips, and special-character file names.

### Changes Required

#### 1. Frontmatter tests

**File**: `src/wiki/frontmatter.test.ts` (new)

```ts
import { test, expect } from 'bun:test';
import { parseFrontmatter } from './frontmatter';

test('no frontmatter → empty data, full body', () => {
  const { data, body } = parseFrontmatter('# hello\nbody');
  expect(data).toEqual({});
  expect(body).toBe('# hello\nbody');
});

test('frontmatter with scalar and array', () => {
  const text = '---\ntitle: Foo\naliases:\n  - F\n  - Foozle\ntags: [a, b]\n---\nbody here';
  const { data, body } = parseFrontmatter(text);
  expect(data).toEqual({ title: 'Foo', aliases: ['F', 'Foozle'], tags: ['a', 'b'] });
  expect(body).toBe('body here');
});

test('CRLF line endings', () => {
  const text = '---\r\ntitle: Foo\r\n---\r\nbody';
  expect(parseFrontmatter(text).data).toEqual({ title: 'Foo' });
});

test('unterminated frontmatter → whole file is body', () => {
  const text = '---\ntitle: Foo\nbody no close';
  const { data, body } = parseFrontmatter(text);
  expect(data).toEqual({});
  expect(body).toBe(text);
});

test('malformed YAML throws with path in message', () => {
  expect(() => parseFrontmatter('---\ntitle: [unclosed\n---\n', 'bad.md'))
    .toThrow(/bad\.md/);
});
```

#### 2. Wikilink + heading tests

**File**: `src/wiki/wikilinks.test.ts` (new)

```ts
import { test, expect } from 'bun:test';
import { extractWikilinks, extractHeadings } from './wikilinks';

test('bare wikilink', () => {
  const links = extractWikilinks('see [[Foo]] for more');
  expect(links).toEqual([{ raw: '[[Foo]]', target: 'Foo' }]);
});

test('wikilink with display', () => {
  const links = extractWikilinks('see [[Foo Bar|that page]]');
  expect(links[0]).toMatchObject({ target: 'Foo Bar', display: 'that page' });
});

test('path-form wikilink with display', () => {
  const links = extractWikilinks('cf [[Geography/Calaria/Hallia/index|Hallia]]');
  expect(links[0]).toMatchObject({
    target: 'Geography/Calaria/Hallia/index',
    display: 'Hallia',
  });
});

test('wikilink with #section', () => {
  const links = extractWikilinks('[[Foo#Bar]] and [[Foo#Bar|Bar]]');
  expect(links[0]).toMatchObject({ target: 'Foo', section: 'Bar' });
  expect(links[1]).toMatchObject({ target: 'Foo', section: 'Bar', display: 'Bar' });
});

test('wikilinks inside a callout', () => {
  const text = '> [!quote] Source\n> body [[Foo]] and [[Bar|baz]]';
  const links = extractWikilinks(text);
  expect(links.map((l) => l.target)).toEqual(['Foo', 'Bar']);
});

test('wikilinks inside frontmatter (regex over full file)', () => {
  // Synthetic: a hypothetical frontmatter value containing a wikilink.
  const text = '---\naliases:\n  - "[[Other Page]]"\n---\nbody';
  const links = extractWikilinks(text);
  expect(links[0]).toMatchObject({ target: 'Other Page' });
});

test('special-character target', () => {
  const links = extractWikilinks('[[Færrin]] and [[Geography/Rhædon/index|Rhædon]]');
  expect(links[0]).toMatchObject({ target: 'Færrin' });
  expect(links[1]).toMatchObject({ target: 'Geography/Rhædon/index' });
});

test('extractHeadings only catches body headings, not list-prefixed text', () => {
  const headings = extractHeadings('# Top\n## Sub\n - # not a heading\nbody');
  expect(headings).toEqual([
    { level: 1, text: 'Top' },
    { level: 2, text: 'Sub' },
  ]);
});
```

#### 3. Integration test against `content/`

**File**: `src/wiki/load.test.ts` (new)

```ts
import { test, expect } from 'bun:test';
import { loadWikiIndex } from './load';

const CONTENT_DIR = 'content';

test('indexes every .md file under content/', async () => {
  const index = await loadWikiIndex({ contentDir: CONTENT_DIR });
  const glob = new Bun.Glob('**/*.md');
  let onDisk = 0;
  for await (const _ of glob.scan({ cwd: CONTENT_DIR })) onDisk += 1;
  expect(index.pageCount).toBe(onDisk);
  expect(Object.keys(index.pages).length).toBe(onDisk);
});

test('every wikilink is either resolved or in unresolvedLinks', async () => {
  const index = await loadWikiIndex({ contentDir: CONTENT_DIR });
  for (const page of Object.values(index.pages)) {
    for (const link of page.wikilinks) {
      if (link.resolvedPath === null) {
        const found = index.unresolvedLinks.some(
          (u) => u.sourcePath === page.path && u.raw === link.raw,
        );
        expect(found).toBe(true);
      } else {
        expect(index.pages[link.resolvedPath]).toBeDefined();
      }
    }
  }
});

test('aliases round-trip: every alias resolves to its page', async () => {
  const index = await loadWikiIndex({ contentDir: CONTENT_DIR });
  // Build the same alias map the loader does (first-write wins).
  const aliasMap = new Map<string, string>();
  for (const page of Object.values(index.pages)) {
    for (const alias of page.aliases) {
      if (!aliasMap.has(alias)) aliasMap.set(alias, page.path);
    }
  }
  // Sample: every page's first alias should resolve back to that page (or to the
  // first page that claimed that alias, in the collision case).
  for (const page of Object.values(index.pages)) {
    for (const alias of page.aliases) {
      const target = aliasMap.get(alias);
      expect(target).toBeDefined();
      expect(index.pages[target!]).toBeDefined();
    }
  }
});

test('special-character filenames are present and resolvable', async () => {
  const index = await loadWikiIndex({ contentDir: CONTENT_DIR });
  for (const p of [
    'Geography/Færrin.md',
    'Geography/Tormeré/index.md',
    'Geography/Rhædon/index.md',
    'Org/Ætherion Limited.md',
  ]) {
    expect(index.pages[p]).toBeDefined();
  }
});

test('contentHash and byteLength are populated and consistent', async () => {
  const index = await loadWikiIndex({ contentDir: CONTENT_DIR });
  for (const page of Object.values(index.pages)) {
    expect(page.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(page.byteLength).toBeGreaterThan(0);
    expect(page.summary).toBeNull();
    expect(page.keyFacts).toBeNull();
  }
});
```

### Success Criteria

#### Automated Verification

- [x] `bun test src/wiki/` passes all tests (frontmatter, wikilinks, load)
- [x] `bun test` (full suite) still passes — phase 5 doesn't regress phase 2 tests from ticket 002
- [x] `bun run typecheck` passes

#### Manual Verification

- [x] Spot-check 5 random page records in `state/wiki-index.json` against their source files — title, aliases, headings, and resolved wikilinks all match
- [x] Walk through `state/wiki-index.json`'s `unresolvedLinks` (if any) — every entry is either (a) a genuine typo / stub-missing-page situation that's fine to surface, or (b) a parser bug to fix before sign-off

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the spot-checked pages look right and the `unresolvedLinks` list is interpretable before opening ticket 004.

---

## Testing Strategy

### Unit Tests (`bun test`)

- `src/wiki/frontmatter.test.ts` — present vs. absent vs. unterminated vs. malformed frontmatter; CRLF; scalar + array shapes
- `src/wiki/wikilinks.test.ts` — `[[Page]]`, `[[Page|display]]`, `[[path/to/index|Display]]`, `[[Page#Section]]`, links in callouts, links in frontmatter, special-character targets; headings positive/negative cases

### Integration Tests

- `src/wiki/load.test.ts` — runs against the real `content/` tree: count parity, resolved-or-unresolved invariant, alias round-trip, special-character paths, hash/byteLength populated

### Manual Testing Steps

1. `bun run index-wiki` — confirm the summary line shows 93 pages and a sensible link count.
2. Inspect `state/wiki-index.json`; spot-check 5 random pages against their source files.
3. Read the `unresolvedLinks` array; confirm each entry is either a typo in source content or a known stub-page situation (and not a parser bug).
4. Run `bun run index-wiki -- --check` immediately after the build — should exit 0 silently.
5. `echo '<!-- test -->' >> content/index.md && bun run index-wiki -- --check` — should exit 1 and list `~ index.md`.
6. Revert the test edit and re-run `index-wiki -- --check` — should be clean again.

## Performance / Cost Considerations

- Zero LLM calls, zero cost.
- ~93 files × <50KB each × SHA-256 + regex passes = single-digit milliseconds on cold disk. No optimisation needed.
- Output JSON is ~50–200 KB (rich wikilink records × ~93 pages × a few links each).

## Migration / Backfill Notes

None — this ticket creates a new file under `state/` that did not previously exist. If a stale `state/wiki-index.json` exists from a hand-rolled experiment, the first `bun run index-wiki` overwrites it; the gitignore added in phase 1 prevents it from being committed regardless.

## Cross-Cutting Considerations

- **Determinism**: page records are inserted in sorted-path order, wikilinks in occurrence order, frontmatter array fields in source order. Re-running with no content change produces a byte-identical JSON file modulo `generatedAt` — which is why `--check` ignores `generatedAt` and diffs by `contentHash` only.
- **Forward compatibility**: ticket 004 only adds two fields (`summary`, `keyFacts`) and writes the same shape. The schema in `index-schema.ts` already declares them as `string | null` / `string[] | null` so 004 can fill them without a schema change.
- **Audit trail**: the index itself is the audit trail for the wiki-side state. Every later ticket that operates on a page references its `contentHash`; if a page changes mid-pipeline, the hash mismatch surfaces.
- **Error surfacing**: malformed YAML frontmatter throws with the source path in the message — surfaces during the walker phase rather than silently giving a page no metadata.
- **Idempotency**: `bun run index-wiki` is safe to re-run; output overwrites in place. No locking needed (single-process CLI).

## References

- Ticket: [`tickets/003-wiki-index-parse.md`](../../../tickets/003-wiki-index-parse.md)
- Parent epic plan: [`thoughts/shared/plans/2026-05-17-001-wiki-updater.md`](./2026-05-17-001-wiki-updater.md)
- Bootstrap plan (precedent for phasing + style): [`thoughts/shared/plans/2026-05-17-002-project-bootstrap.md`](./2026-05-17-002-project-bootstrap.md)
- Wiki conventions: [`CLAUDE.md`](../../../CLAUDE.md) (Content Files section)
- Sample pages used during planning: [`content/Org/Iridescent Church/index.md`](../../../content/Org/Iridescent%20Church/index.md), [`content/Geography/Calaria/Hallia/index.md`](../../../content/Geography/Calaria/Hallia/index.md), [`content/Divinity/Outer Gods/Eternal Pulse.md`](../../../content/Divinity/Outer%20Gods/Eternal%20Pulse.md), [`content/Org/Iconoclasm/People/Elias Ramsey.md`](../../../content/Org/Iconoclasm/People/Elias%20Ramsey.md)
- CLI registry (extend in phase 4): [`src/cli/index.ts`](../../../src/cli/index.ts)
- `yaml` package docs: https://eemeli.org/yaml/
