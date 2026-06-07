---
date: 2026-06-03
topic: Monorepo migration discovery — pkg/{caster,heartwood,quartz,strider}
phase: Discover (Double Diamond)
method: 6 parallel Claude persona agents (no external LLMs available — personas substitute per repo rule)
target_decision: Bun workspaces; single source of truth for shared campaign data
status: discovery complete
---

# Monorepo Migration — Discovery Findings

> **Historical note (2026-06-06):** this is a point-in-time discovery snapshot. The `heartwood`
> package referenced throughout was later deemed a failed experiment and removed from the repo
> (commit `e2cb11e`); it no longer exists. Read its mentions below as historical inventory only.

Four independently-developed apps live under `pkg/`. All four serve the same Pathfinder 2e
"Faerrin" TTRPG campaign and share data. Goal: migrate into one Bun-workspaces monorepo with a
single source of truth for shared content. Repo is **jj-backed** (`.jj/` present) — all moves/
deletes must use `jj`, not raw git.

## ⚠️ CORRECTIONS (post stress-test, 2026-06-03)

The initial discovery had three errors, caught by the plan stress-test and verified:
1. **There are FIVE apps/lockfiles, not four.** `pkg/caster/site/` is a nested second Astro site
   (`package.json` name `caster-site` + its own `bun.lock`). The `pkg/*` workspace glob does NOT
   match it. caster's CLAUDE.md bans vite, yet caster/site is Astro(=vite) → nested-instruction conflict.
2. **quartz's parity gates DO NOT EXIST.** No `pkg/quartz/migration/` dir; `parity-{slugs,graph,urls}.ts`
   and `tsconfig.scripts.json` are stale references in quartz's CLAUDE.md to a removed harness. Any
   validation relying on them must instead capture a self-generated pre-migration build baseline.
3. **External cross-repo coupling:** quartz `scripts/config.ts` `podcast.episodesPath` defaults to
   `/ruby/data/experiments/caster/site/dist/episodes.json` — a sibling repo OUTSIDE `pkg/` (verified
   to exist). Missing file is silently skipped. Must be an explicit decision in phase 2.
Also: quartz `.prettierrc` is `semi:false`; strider uses prettier defaults (`semi:true`) and its
CLAUDE.md forbids adding overrides — a single root prettier config is impossible. Keep per-app.

## App inventory

| App (dir) | pkg name | Pkg mgr | Lockfile | Stack | Output | Role |
|-----------|----------|---------|----------|-------|--------|------|
| caster | `caster` | bun | bun.lock | Bun CLI, `@anthropic-ai/sdk@^0.100.1`, msedge-tts | `out/`, `site/` | Audio/podcast TTS pipeline |
| heartwood | `heartwood` | bun | bun.lock | Bun CLI, `@anthropic-ai/sdk@^0.39.0`, commander, zod | GitLab MRs | Transcript→wiki-edit pipeline |
| quartz | **`heart-of-hearts`** | **npm** | package-lock.json | Astro 5 + Solid, tsx, pixi.js | `public/` | Campaign wiki site + transcript ingest |
| strider | `strider` | bun | bun.lock | TanStack Start + Vite 8 + React 19, pixi.js | `dist/client/` | Interactive faction-map site |

Root is greenfield: **no** root `package.json`, `tsconfig`, `.gitignore`, or CI config exists yet.

---

## 1. Workspace tooling (target: Bun workspaces)

- **Layout:** keep `pkg/`, root `package.json` with `"workspaces": ["pkg/*"]`, `private: true`,
  `type: module`. Don't split into `apps/`+`packages/` yet — no shared internal packages exist today.
- **Naming mismatch (must decide):** quartz's package name is `heart-of-hearts`, not `quartz`.
  Bun `--filter` targets by package name. Recommend renaming package → `quartz` (it's `private`,
  not published, so safe).
- **Orchestration:** `bun --filter '*' <script>` for root-level test/build/typecheck. **No
  Turborepo/Nx** — 4 apps, no inter-app build graph; revisit only when a shared package is extracted.
- **Shared tsconfig:** caster + heartwood tsconfigs are byte-identical (Bun-native) → share a base
  now. strider (DOM/Vite) and quartz (`extends astro/tsconfigs/strict`, Solid JSX,
  `verbatimModuleSyntax:false`) diverge. Recommend a thin root `tsconfig.base.json` that
  caster/heartwood/strider extend; **leave quartz on Astro's base** (TS single-string extends limit).
- **Lockfiles:** 3× bun.lock + 1× package-lock.json → one root `bun.lock`. quartz is resolved by
  Bun for the first time ever → highest-risk install; smoke-test hardest.

## 2. quartz npm→bun blockers (the critical path)

- `.npmrc` → `engine-strict=true` + `engines.npm: ">=10.9.2"` — npm-isms; drop/neutralize.
- `build.sh` uses `npm ci`; also `rm -rf .astro` cache-bust assumes per-app `node_modules/.astro`
  which **moves to root** under hoisting. Rewrite → `bun install --frozen-lockfile` + explicit
  `rm -rf .astro <root>/node_modules/.astro`.
- `npx` everywhere (build.sh, justfile, Dockerfile, package.json, migration/parity-*.ts) → `bunx`.
  `tsx` invocations: safest first step `npx tsx` → `bunx tsx` (keep tsx); evaluate dropping tsx later.
- Astro 5 + Vite under Bun is the **least-validated** combo of the four — smoke-test, don't assume
  (watch `astro-pagefind`'s post-build Pagefind binary step).
- Dockerfile (`FROM node:22-slim`) encodes npm assumptions — defer; treat as standalone node artifact
  or switch to `oven/bun`.
- Stale ref: quartz `tsconfig.json` mentions a `tsconfig.scripts.json` that **does not exist**.

## 3. Shared data — the heart of the migration (SINGLE SOURCE OF TRUTH)

**The wiki corpus is TRIPLICATED** and already drifting:
- Identical Obsidian wiki tree (`Geography/ Divinity/ Org/ Phenomena/ Rules/ Timeline.md`) exists in
  `quartz/content/`, `heartwood/content/`, AND `caster/content/wiki/`. Sampled files byte-identical
  in prose; **frontmatter differs** (heartwood has frontmatter, quartz copy doesn't).
- **Org file-layout drift:** heartwood uses flat files (`Org/The Scale.md`); quartz uses folders
  (`Org/The Scale/People/*.md`). Same orgs, different on-disk shape.

**Transcripts are TRIPLICATED and drifting:**
- Canonical origin: quartz `scripts/pipeline/ingest.ts` fetches from `static-audio.iridi.cc`
  (unauthenticated GET) → `scripts/data/*.json`. `export.ts` → `content/Script/*.md`;
  `script.ts` → `scripts/script/*.txt` + `shibboleth.json`.
- heartwood's `update-transcripts.sh` copies quartz's `script/*.txt`, strips headers, line-numbers
  them → `heartwood/transcripts/`. **Its hardcoded sibling-repo paths are already broken post-`pkg/`
  move.** caster has the same derived txt under `content/transcripts/` — **and has newer sessions
  heartwood lacks** (copies have diverged).
- `shibboleth.json` duplicated in quartz + caster.

**Canonical producers:**
| Data | Producer | Stale copies |
|------|----------|--------------|
| Raw transcripts | quartz `ingest` ← remote API | — |
| Per-campaign txt | quartz `script.ts` | heartwood/transcripts, caster/content/transcripts |
| World wiki md | hand-edited (heartwood claims SSOT via MR flow) | quartz/content, caster/content/wiki |
| campaigns.yaml | quartz `scripts/campaigns.yaml` | — |
| shibboleth.json | generated from campaigns.yaml | caster copy |
| Faction/hex-map data | strider `content/{factions,layers}` | — (genuinely app-specific) |

**Proposed SSOT design:** extract a `pkg/shared-content` workspace package holding `wiki/`,
`transcripts/{data,script}/`, `campaigns.yaml`, `shibboleth.json`. Apps reference it (paths already
derived at runtime in quartz `scripts/lib/paths.ts`; heartwood/caster point their content/transcript
reads there). Delete `update-transcripts.sh` and the caster/heartwood copies. strider's faction/layer
data stays app-local.

**OPEN DECISION (blocks SSOT impl):** who owns the wiki edit→publish flow? heartwood edits via MRs but
quartz's `content/` is what renders the live site (`heart.iridi.cc`) — no declared sync between them.
Cleanest: heartwood edits shared `wiki/`, quartz builds the public site from that same `wiki/`.
Also needs: which frontmatter convention + Org file-layout wins; a one-time reconcile of the drifted
copies (caster is newest) before merge.

**Slug logic is NOT duplicated (do not unify):** quartz `scripts/lib/slug.ts` is the canonical
URL-slugger (verbatim Quartz port, parity-gated, preserves case/commas/Unicode). caster's `slugify`
does the opposite (lowercase-kebab, for transcript filename matching). strider slices slugs from
filenames. heartwood has none. Three different problems — keep per-app. If wiki becomes shared,
slug.ts rules must travel with it and heartwood's link-editing must respect them.

## 4. Dependency dedup

Version conflicts across apps:
| Dep | caster | heartwood | quartz | strider | Action |
|-----|--------|-----------|--------|---------|--------|
| `@anthropic-ai/sdk` | ^0.100.1 | **^0.39.0** | — | — | Upgrade heartwood → ^0.100.1 (own PR) |
| `typescript` | ^5 (peer) | ^5 (dev) | ^5.9.3 | ^5.0.0 | Unify → ^5.9.3 (dev everywhere) |
| `@types/node` | — | — | ^24.2.1 | ^25.9.1 | Align → ^24.2.1 |
| `@types/bun` | latest | latest | — | — | **Pin** (unpinned `latest` is dangerous in shared lock) |
| `prettier` | — | — | ^3.6.2 | ^3.8.3 | → ^3.8.3 |
| `pixi.js` | — | — | ^8.18.1 | ^8 | → ^8.18.1 |
| `gray-matter` | — | — | ^4.0.3 | ^4.0.3 (dev) | aligned |

- **`@anthropic-ai/sdk` 0.39→0.100 upgrade:** blast radius is ONE file — heartwood `src/llm.ts`
  (`complete()` wrapper; direct SDK calls forbidden). Risk is type-level, not runtime: likely
  `Anthropic.Tool['input_schema']` → `Anthropic.Tool.InputSchema` (caster already uses the new path).
  `bun run typecheck` surfaces every break. Do it as an isolated PR before any shared extraction.
- **Shared `@faerrin/llm` package — STRONG candidate** but a *redesign*, not lift-and-shift: caster
  has streaming + max-tokens guard + provider-agnostic seam; heartwood has cost logging
  (`pricing.ts`, `recordLLMCall`) + Zod-at-boundary. Merge best of both. Sequence: SDK upgrade first,
  then extract (hoist `pricing.ts` first — pure data, zero deps).
- **Do NOT build `@faerrin/content` or `@faerrin/slug`** — overlap is shallow (only `gray-matter`
  truly shared; three different YAML libs: `js-yaml`/`yaml`/gray-matter's embedded).
- **devDep cleanup:** caster missing explicit `zod` (resolves transitively — will break under
  stricter hoisting); typescript peer→dev in caster; pin `@types/bun`.

## 5. Build / test / CI / hooks

- **No CI exists** anywhere — greenfield. Recommend root CI (bun setup, `--filter` matrix on changed apps).
- **Codegen ordering hazards:** strider must run `build-content` (`src/generated/`) + `generate-routes`
  (`routeTree.gen.ts`) before typecheck/test; vitest global-setup regenerates if missing. quartz build
  runs content pipeline before astro build. Root aggregate scripts must respect these.
- **husky under jj — BLOCKER:** strider's `.husky/pre-commit` runs `bun run format/lint/build` +
  `git update-index --again`. Husky installs **git** hooks; **jj does not run git hooks**, so the
  hook silently won't fire under a jj workflow, and the raw `git update-index` call is jj-hostile.
  Move to a jj-aware or root-level hook strategy (or drop husky). The `prepare: "husky"` script also
  runs on every root `bun install`.
- **Deploy:** quartz → `public/`, strider → `dist/client/`; both served by an external reverse proxy
  **not in this repo**. Both do Playwright OG-image renders. Consolidation may change output paths the
  proxy expects — **must confirm with user** before changing any output path / basepath.
- **Lint/format:** strider (eslint flat + prettier), quartz (prettier + astro check), bun CLIs (neither).
  Recommend unified root prettier + eslint; keep astro-check local to quartz.

## 6. Secrets / env (audit: PASS — no tracked secrets)

- Only `ANTHROPIC_API_KEY` is genuinely shared (caster + heartwood) — currently **duplicated** across
  two `.env` files (rotation hazard). App-specific: `ELEVENLABS_API_KEY` (caster, optional),
  `GITLAB_TOKEN`/`GITLAB_PROJECT_ID`/`GITLAB_URL` (heartwood). quartz/strider need no secrets.
- Real `.env` files (caster, heartwood) are correctly gitignored; only `heartwood/.env.example` is
  tracked. **No HIGH findings.**
- **Bun `.env` does NOT hoist to workspace root** — it loads from cwd. A single root `.env` only
  reaches apps launched from the repo root. quartz is npm/tsx (no built-in `.env` loader at all).
- **MEDIUM guardrail:** no root `.gitignore` exists — the moment a root `.env` is created it would be
  committable. Add root `.gitignore` (`.env`, `.env.*`, `!.env.example`) **before** any root `.env`.
- Consolidate one root `.env.example` (heartwood's omits `MODEL_FILTER`/`MODEL_RESOLVE`; caster has none).

## 7. Per-app / cross-cutting blockers

- **No nested `.git` dirs** inside `pkg/*` (verified) — clean for a single jj repo. ✅
- **Per-app CLAUDE.md conflict:** caster's CLAUDE.md mandates "Don't use vite / express" (bun-only),
  but strider USES vite and quartz USES astro/vite. These must stay **nested per-app** — never hoist
  to a root CLAUDE.md. Each app also has its own `.claude/`.
- **tsconfig path aliases:** strider uses `@/* → ./src/*`; check for collisions when configs share a base.
- quartz dir-name (`quartz`) vs package-name (`heart-of-hearts`) mismatch (see §1).
- App-local dirs to leave in place: `tickets/`, `thoughts/`, `docs/`, heartwood `state/`.

---

## Recommended migration sequencing (feeds the Plan phase)

1. **Scaffold root** — `package.json` (workspaces), root `.gitignore` (incl. `.env`), root
   `.env.example`, `tsconfig.base.json`. (jj-tracked)
2. **Consolidate lockfiles** — delete 4 lockfiles, one root `bun install`, smoke-test each app.
3. **quartz npm→bun** — `.npmrc`/engines, `build.sh`, `npx`→`bunx`, rename package→`quartz`,
   validate Astro+Vite+Pagefind under bun. (highest risk — isolate)
4. **husky/jj hooks** — replace strider's git-hook strategy with a jj-compatible one.
5. **heartwood `@anthropic-ai/sdk` 0.39→0.100** — isolated PR, fix `Tool.InputSchema` type path.
6. **Dependency unification** — align shared versions, pin `@types/bun`, add caster `zod`.
7. **Shared data SSOT** — resolve wiki-ownership decision → reconcile drifted copies → extract
   `pkg/shared-content` → repoint apps → delete `update-transcripts.sh` + copies. (largest effort)
8. **`@faerrin/llm` extraction** — after SDK upgrade; merge caster+heartwood wrappers + pricing/cost log.
9. **Root CI + unified lint/format**.

Steps 1–2 unblock everything; 3 and 7 are the heavy hitters; 7 is gated on a product decision
(wiki ownership) that needs the user.
