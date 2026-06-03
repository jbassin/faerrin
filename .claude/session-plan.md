# Session Plan — Faerrin Monorepo Migration (v2, post stress-test)

**Created:** 2026-06-03 · **Revised:** 2026-06-03 after persona stress-test (code-reviewer + cloud-architect)
**Intent Contract:** .claude/session-intent.md
**Discovery:** thoughts/shared/research/2026-06-03-monorepo-migration-discovery.md (see CORRECTIONS)
**Mode:** Native, persona-driven (only Claude; persona agents substitute for multi-LLM).

## What You'll End Up With
A working Bun-workspaces monorepo where all apps build/test/typecheck from the root with one
`bun.lock`, unified deps, quartz fully on Bun (proven by a spike first), jj-safe hooks, frozen
live-site output paths, root CI, and a gated plan for collapsing the triplicated campaign data.

## ⚠️ What the stress-test changed (deltas from v1)
- **5 apps, not 4** — `pkg/caster/site/` (`caster-site`, own bun.lock) was missed. Its fate is a gate before any lockfile work.
- **quartz→bun moved BEFORE lockfile consolidation** as a disposable spike (was after). It's the least-proven combo (Astro5+Vite+Pagefind+Playwright on bun); validate before committing the repo to one lock.
- **Parity gates don't exist** — replaced with a self-captured pre-migration `public/` build baseline.
- **No single root prettier/eslint** — fan out per-app (quartz `semi:false` vs strider defaults conflict).
- **husky `prepare` removal moved before the first root `bun install`.**
- **Explicit jj checkpoint + per-gate rollback** (`jj op restore`).
- New explicit decisions surfaced: caster/site fate, external `episodes.json` coupling, Dockerfile fate, frozen output-path contract, OG-render-in-CI.

---

## PHASE 1 — Foundation. Execute semi-autonomously; pause at [GATE].

> VCS: all ops via `jj`. Rollback at any gate: `jj op log` → `jj op restore <id>` (or `jj undo`).
> Root rule: **root scripts only delegate via `bun --filter` (per-app cwd) — never re-implement
> `tsc`/`astro build`/`vite build` at root** (relative outDir/publicDir would resolve wrong → live-site break).
> Invariant: per-app `.gitignore` (heartwood's negated allow-lists), `CLAUDE.md`, `.prettierrc`,
> eslint configs all stay **nested**. Root configs add root-level rules only.

### Step 0 — Checkpoint + caster/site decision  [GATE]
- `jj` commit the plan/discovery/memory; `jj new` for a clean migration change (untangle from plan files).
- **[USER DECISION] caster/site fate:** (a) promote to workspace member (`workspaces:["pkg/*","pkg/caster/site"]`),
  (b) exclude as standalone, or (c) fold into caster. Until decided, do NOT delete its bun.lock.

### Step 1 — quartz-on-bun feasibility SPIKE (disposable jj change)  [GATE]
- On a throwaway `jj new`, inside `pkg/quartz` only: neutralize `.npmrc engine-strict` + drop
  `engines.npm`; `bun install`; `bunx tsx scripts/run.ts all`; `rm -rf .astro <root>/node_modules/.astro`;
  `bunx astro build` → `public/`.
- **PROVE:** astro build green · astro-pagefind index emitted (`public/pagefind/`) · Playwright OG
  render green under bun · sampled page-output hash unchanged.
- Green → carry the proven `build.sh` recipe forward. Red → STOP, surface to user before committing
  the repo to an all-bun lock. `jj abandon` the spike (knowledge is the deliverable).
- Persona: **deployment-engineer** drives; **debugger** if it breaks.

### Step 2 — Scaffold root  [AUTO]
- Root `.gitignore` **FIRST** (`node_modules`, `.env`, `.env.*`, `!.env.example`, `*.tsbuildinfo`).
- Root `package.json` (workspaces per Step 0 decision; root scripts = `bun --filter '*' <script>`).
- Root `.env.example` (all vars: ANTHROPIC_API_KEY shared; heartwood GITLAB_*+MODEL_FILTER/RESOLVE; caster ELEVENLABS).
- `tsconfig.base.json` — **compilerOptions only** (strict/target/moduleResolution). Apps keep own
  include/exclude/paths/types. quartz stays on `astro/tsconfigs/strict`. strider keeps `@/*` alias.
- Persona: **backend-architect** drafts; lead reviews.

### Step 3 — Pre-install prep + apply proven quartz conversion  [AUTO]
- Capture **pre-migration baselines**: current `pkg/quartz/public/` and `pkg/strider/dist/client/`
  build manifests (file list + sampled hashes) as the de-facto parity baseline.
- Apply the spike-proven quartz changes for real: rename pkg `heart-of-hearts`→`quartz`;
  `.npmrc`/engines; rewrite `build.sh` (install BEFORE pipeline; `bun install --frozen-lockfile`;
  explicit `rm -rf pkg/quartz/.astro <root>/node_modules/.astro`); `npx`→`bunx` in build.sh +
  **package.json (`check`/`format`)** + justfile + (Dockerfile per decision below); remove stale
  `tsconfig.scripts.json` ref.
- Remove `prepare:"husky"` from strider **now** (before any root install).
- Pin `@types/bun` to the concrete installed version (both bun apps, identical). Drop the speculative
  caster `zod` add (verified: caster has no `import … from "zod"` — only add if a real import exists).
- **[USER DECISION] Dockerfile fate:** `npm ci` breaks once the lockfile is deleted → either migrate
  to `oven/bun`+`bun install`, or mark dead/unused (its comment says prod uses the proxy).

### Step 4 — Consolidate lockfiles  [GATE after]
- `jj` rm all lockfiles (5, incl. caster/site per Step 0); one root `bun install`.
- Validate every app installs + typechecks. quartz is now actually bun-runnable (spike proved the build).

### Step 5 — Live-site build validation  [GATE after]  ← highest stakes
- Build quartz + strider (+ caster/site if included) under the new workspace; **diff against the
  Step-3 baselines** (URL/file set, sampled hashes). Pagefind + OG renders green.
- **[USER DECISION] Freeze output-path contract:** confirm proxy expects `pkg/quartz/public` and
  `pkg/strider/dist/client` at root-relative `/` assets — do NOT change `outDir`/`publicDir`/`base`.

### Step 6 — husky → jj-compatible hooks  [AUTO]
- Replace strider's `.husky/pre-commit` (git-hook + `git update-index`; never fires under jj) with a
  jj-aware pre-commit (or drop). Persona: **deployment-engineer**.

### Step 7 — heartwood @anthropic-ai/sdk 0.39→0.100  [GATE after]  ← isolated, 1 file
- Verified: `Anthropic` imported only in `src/llm.ts:46` (`Tool['input_schema']`→`Tool.InputSchema`).
- `bun run typecheck` + heartwood tests must pass. Persona: **typescript-pro**.

### Step 8 — Unify shared dep versions  [AUTO]
- typescript ^5.9.3 (dev everywhere; drop caster peer); @types/node ^24.2.1; prettier ^3.8.3;
  pixi.js ^8.18.1. Re-validate all apps.

### Step 9 — Root CI + per-app lint/format  [GATE after]
- CI: jj is git-colocated → CI clones git, **just works**. Changed-app matrix from
  `git diff --name-only <base>...HEAD` → `pkg/<app>`; **root-config change (package.json/bun.lock/
  tsconfig.base) ⇒ test ALL apps**. Add `playwright install --with-deps chromium` (cache); keep
  OG-rendering `build` OFF non-deploy jobs.
- Format/lint **fan out per-app** (`bun --filter '*' format/lint`) — NO root prettier/eslint config.
- **[USER DECISION] OG-render-in-CI:** run Playwright OG only on deploy jobs, or every build?
- Persona: **deployment-engineer** (CI) + **code-reviewer** (config).

**Phase-1 exit (Deliver):** from a CLEAN checkout (delete `src/generated/`, `routeTree.gen.ts` first
to prove self-bootstrapping), `bun --filter '*' typecheck` + `test` green; all site builds match
baselines; no tracked secrets; rollback documented per gate. Persona **code-reviewer** final pass.

---

## PHASE 2 — Shared-data SSOT + shared packages. GATED — separate plan, after Phase 1 merges.

> Destructive jj deletes of triplicated data — every delete is a **[GATE]** with a named jj checkpoint.

### Step 10 — Shared-content SSOT
1. **[GATE] Decide wiki owner:** persona **database-architect** compares heartwood-edits→quartz-publishes
   vs quartz-owns→heartwood-proposes, incl. frontmatter + Org layout (flat vs folder) reconciliation.
2. **Reconcile drift:** diff the 3 wiki copies + transcript copies (caster newest); report; **[GATE]**.
3. **Mechanism (architecture decision):** shared data is read via `fs` (not imported) by all apps →
   make it a **plain directory** (`pkg/shared-content/` or root `content/`) referenced via each app's
   `repoRoot`-derived path module — NOT a workspace package, NOT symlinks. Optional thin typed loader
   may be a package (`@faerrin/content-loader`).
4. **Resolve external `episodes.json` coupling** (`/ruby/data/experiments/caster/site/dist/episodes.json`):
   keep env override / vendor into shared-content / drop.
5. Extract via `jj`; repoint quartz `scripts/lib/paths.ts`, heartwood, caster reads.
6. Delete `update-transcripts.sh` + duplicate copies. **[GATE]** per delete.

### Step 11 — Extract `@faerrin/llm`
- After Step 7. Merge caster wrapper (streaming, max-tokens guard, provider seam) + heartwood cost
  layer (`pricing.ts`, `recordLLMCall`, Zod-at-boundary). Hoist `pricing.ts` first. Persona:
  **backend-architect** + **code-reviewer** (preserve cost-log semantics exactly).
- Do NOT build `@faerrin/content`/`@faerrin/slug` — overlap is intentional divergence.

---

## Outstanding USER DECISIONS (surfaced by stress-test)
| # | Decision | When |
|---|----------|------|
| D1 | caster/site fate → **DECIDED: promote to workspace member** (add to workspaces glob; 5th live site, hoisted deps, one root lock) | Step 0 ✅ |
| D2 | Dockerfile fate (migrate to bun / mark dead) | Step 3 |
| D3 | Freeze output-path contract w/ proxy | Step 5 |
| D4 | OG-render in CI (deploy-only vs every build) | Step 9 |
| D5 | Wiki ownership flow | Phase 2 Step 10 |
| D6 | External episodes.json coupling | Phase 2 Step 10 |

## Provider Requirements
🔴 Codex ✗ · 🟡 Gemini ✗ · 🟣 Perplexity ✗ · 🔵 Claude ✓ — all roles via `octo:personas:*`.

## Success Criteria — see .claude/session-intent.md
