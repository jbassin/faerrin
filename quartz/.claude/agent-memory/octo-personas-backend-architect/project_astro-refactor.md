---
name: astro-refactor
description: Plan to replace vendored Quartz 4 SSG with Astro + Solid islands, keeping scripts/ pipeline. Status planning, no code as of 2026-05-31.
metadata:
  type: project
---

Refactor plan at `docs/refactor-plan.md`: rebuild the rendering layer (job B, vendored `quartz/`) on **Astro + Solid islands**, leaving the `scripts/` content pipeline (job A: ingest→export→script→knowledge→upload) untouched. ~100 deps → ~15. 168 md files (93 hand-authored + 75 generated `content/Script/`). Site `heart.iridi.cc`.

**Why:** little of Quartz's surface is used, no longer authoring in Obsidian, chained to a fork that can't be upgraded. User framing: site "stays a reading wiki" (not an app); Solid is "a means to an end, not a goal."

**How to apply:** Optimize recommendations for long-term maintainability and scope discipline. The contract between `scripts/` and the renderer is `content/` markdown + the frozen transcript directive syntax (`::transcript-audio` / `:::transcript-line`). The single biggest correctness risk is **slug + wikilink "shortest" resolution**: 48/93 authored filenames have spaces/commas/apostrophes/Unicode, and the linker (`scripts/lib/linker.ts`) emits `[[wikilinks]]` that Astro must resolve byte-identically to Quartz's github-slugger output or links break and URLs change. URL/slug scheme, content schema (lenient zod, `img` not `image`, title optional), and search engine (Pagefind vs FlexSearch) are the expensive-to-reverse decisions that must be locked in Phase 0. Graph view (d3+pixi) is the lowest value-per-effort item — candidate to defer/cut. See [[user-profile]].

(Note: the linker emits `[[target|match]]` where target is `title` for normal files and the dir path for index.md; slug derivation in `scripts/lib/content.ts` is `replaceAll(" ","_").toLowerCase()` — this is NOT github-slugger, so the Astro slug resolver must reconcile two different slug conventions. Confirmed by reading the code 2026-05-31.)
