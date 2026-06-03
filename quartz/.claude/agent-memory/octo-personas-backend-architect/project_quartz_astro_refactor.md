---
name: project-quartz-astro-refactor
description: Planned rebuild of the render layer from vendored Quartz 4 onto Astro + Solid islands, keeping scripts/ pipeline
metadata:
  type: project
---

Plan at `/ruby/data/experiments/quartz/docs/refactor-plan.md` (status: Planning, no code yet).
Replace vendored Quartz 4 SSG with **Astro + Solid islands**. The `scripts/` content
pipeline (ingest→export→script→knowledge→upload) stays unchanged; it emits plain markdown
into `content/`, which Astro will consume behind a stable contract. Only `build.sh`'s final
step changes (`npx quartz build` → `astro build`).

Key facts (as of 2026-05-31):
- 168 md files = 93 hand-authored + 75 generated (`content/Script/`). No longer authored in Obsidian.
- Frontmatter is sparse/lenient: only aliases/tags/title/img observed; 21 files have none; key is `img` not `image`.
- 48/93 authored filenames contain spaces/Unicode — slug + wikilink "shortest" resolution is the top correctness risk.
- Current deps ~100 (incl. pixi.js, d3, flexsearch, workerpool, preact SPA). Target ~15.
- Graph view (d3-force + pixi) is the one genuinely hard port; lowest value-per-effort.

**Why:** escape vendored-fork maintenance burden; site uses little of Quartz's surface.
**How to apply:** Evaluate changes on a 2-year maintainability/TCO horizon. See [[user-profile]].
