# Plan 0002 — move `services/speaks` → `pkg/speaks`

**Created:** 2026-06-09
**Status:** ✅ DONE 2026-06-09 — executed as `pkg/mouth` / `@faerrin/mouth` (option B name). Env
vars `SPEAKS_*`→`MOUTH_*`, unit `mouth.service`. bun lanes green & skip it; cargo + dagger green.
**Context:** the Rust bot was deliberately put under `services/` (not `pkg/`) during the migration
because `pkg/*` are Bun-workspace members and a Rust crate has no `package.json`. That objection is
now **resolved** — see below. The lone `services/` top-level dir is awkward; fold it into `pkg/`.

## The unblock: `gothic` is the precedent

`bun --filter '*' <script>` **silently skips packages that lack `<script>`** — proven by the live
repo: `pkg/gothic` (pure CSS) has a `package.json` with **zero** lifecycle scripts and CI is green;
`caster`/`content`/`llm`/`wretch` have no `build` script; `aether` has no `test`/`typecheck`. So a
Rust package can live in `pkg/` as a **real workspace member with a thin, script-less
`package.json`** (exactly like `gothic`): the bun `typecheck`/`test`/`build`/`lint`/`check` fan-out
just skips it, and the **dedicated Dagger Rust lane** keeps doing the real `fmt`/`clippy`/`test`/
`build`. No fake cargo-shelling scripts (the earlier worry), no cargo in the bun container.

## Decision to make first: the name

Moving re-touches every path (Dagger workdir, systemd unit, CLAUDE/CUTOVER, docs). Two options:
- **A — `pkg/speaks` / `@faerrin/speaks`** (recommended for a pure move): it *is* the speaks bot;
  keep `mouth` reserved for the eventual TS rewrite ([[mouth-ts-rewrite-deferred]]).
- **B — `pkg/mouth` / `@faerrin/mouth` now** (even as Rust): since the TS rewrite is the agreed end
  name and this move already rewrites all the paths/unit, adopting `mouth` now avoids a *second*
  rename later. Cost: a Rust crate named "mouth" reads oddly until the rewrite.

Pick one before step 1. The steps below say `<name>` = `speaks` or `mouth`.

## Steps

1. **Move the tree (jj):** `services/speaks/` → `pkg/<name>/`; remove the now-empty `services/`.
   (`git mv` is forbidden — jj repo; use `jj` / filesystem move and let jj snapshot.)
2. **Add `pkg/<name>/package.json`** — gothic-style, script-less so the bun fan-out skips it:
   ```json
   {
     "name": "@faerrin/<name>",
     "version": "0.1.0",
     "private": true,
     "description": "Rust PF2e dice/host Discord bot (Cargo workspace; built by the Dagger rust lane, not the bun lanes). See CLAUDE.md."
   }
   ```
   No `typecheck`/`test`/`build`/`lint`/`check`/`format` — those run in the Rust lane.
3. **`bun install`** to register the new member; **commit the updated `bun.lock`** (the workspace
   member set changed). Confirm no other lockfile churn.
4. **Update the Dagger Rust lane** (`.dagger/src/index.ts`): `withWorkdir("/src/services/speaks")` →
   `/src/pkg/<name>`; cache mount `/src/services/speaks/target` → `/src/pkg/<name>/target`; the
   comment on `rustBase`. (Rename the cache volume id too if name changes, e.g.
   `faerrin-speaks-target`.)
5. **Update deploy paths** (`pkg/<name>/deploy/speaks.service` + `CUTOVER.md`): `WorkingDirectory`
   and `ExecStart` absolute paths `…/services/speaks/…` → `…/pkg/<name>/…`. (`.sqlx`, `migrations/`,
   and the `players.toml` default path are crate/cwd-relative — no change.)
6. **Docs:** `pkg/<name>/CLAUDE.md` — **invert** the old "don't move under `pkg/`" gotcha to explain
   why it now lives there (script-less member like `gothic`); fix the layout/paths. Add a row to the
   **root `CLAUDE.md`** packages table (speaks isn't listed there at all today). Note the move in
   `thoughts/speaks/plans/0001-…` §13 + the `speaks-migration` memory.
7. **Rename unit/file** if going with `mouth` (`speaks.service` → `mouth.service`, cache volume id,
   the `SPEAKS_*` env var names → `MOUTH_*`? — optional; env names can stay `SPEAKS_*` to limit
   churn, or rename for consistency).

## Validation gates
1. `bun install --frozen-lockfile` clean after committing the new `bun.lock`.
2. `bun --filter '*' typecheck && … test && … build` stay green and **skip** `@faerrin/<name>`
   (it has none of those scripts).
3. `dagger functions` still lists `rust-check`/`rust-build`; `cargo check`/`fmt --check`/`test` pass
   from `pkg/<name>` (offline `.sqlx`).
4. `grep -rn "services/speaks"` returns nothing (all references updated).
5. The Bun workspace + Dagger module load cleanly.

## Risks / notes
- **`bun.lock` changes** (new member) — expected; commit it.
- **Host re-deploy:** the systemd unit's absolute paths change, so the deployed unit on the host
  must be reinstalled (the binary path moves). Flag in `CUTOVER.md`. Not a code risk; a host action.
- **Pure rename, zero behavior change** — the bot's code/build/runtime are untouched; only its
  location + a thin `package.json`.
- **Effort:** ~30 min mechanical + the validation gates. Low risk.
