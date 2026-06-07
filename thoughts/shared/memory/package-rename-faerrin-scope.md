---
name: package-rename-faerrin-scope
description: All packages renamed to @faerrin/* scope with folders matching short-names (supersedes old codenames quartz/listener/shared-content/caster-site)
metadata: 
  node_type: memory
  type: project
  originSessionId: 812e5d1c-0140-42c5-9a4f-7a22ed2d06b6
---

As of 2026-06-05, every workspace package was renamed to the `@faerrin/*` scope and its folder
aligned to the package short-name. **The old codenames in [[monorepo-phase1-done]] are stale** —
translate when reading older notes/commits.

Folder → package name (root `workspaces: ["pkg/*"]`; was 8 packages at rename time, now 7 —
`heartwood` was later removed as a failed experiment, commit `e2cb11e`):
- `pkg/caster` → `@faerrin/caster` (name-only; folder unchanged)
- `pkg/strider` → `@faerrin/strider` (name-only)
- `pkg/wretch` → `@faerrin/wretch` (was `listener`/`pkg/listener`)
- `pkg/aether` → `@faerrin/aether` (was `quartz`/`pkg/quartz` — the live wiki renderer, heart.iridi.cc)
- `pkg/content` → `@faerrin/content` (was `shared-content` — the SSOT wiki+transcripts platform)
- `pkg/face` → `@faerrin/face` (was `caster-site`, un-nested from `pkg/caster/site` to top-level)
- `pkg/llm` → `@faerrin/llm` (folder was `pkg/faerrin-llm`; package name was already correct)

Consequences baked in: all `../shared-content/...` literal paths are now `../content/...`; the
slug-split foot-gun is now `.split("content/wiki/")`; `face` reaches its sibling caster via
`../../../caster/...` (un-nesting); Caddy routes changed to `aether/public`, `face/dist`,
`wretch/data/saved`. Validated green: typecheck + check + lint + 699 tests + aether file-set parity
(763). Done in jj working commit `yvmwsknk` (not pushed).

**Live-site follow-up the repo can't self-apply:** the gitignored host `sites.caddyfile` must be
updated to the new paths and Caddy reloaded, else heart/caster/static-audio.iridi.cc 404 until the
new build dirs are deployed.
