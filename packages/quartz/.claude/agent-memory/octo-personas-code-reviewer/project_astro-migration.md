---
name: astro-migration
description: Planned Quartz 4 → Astro+Solid SSG rebuild — top correctness traps (slug fidelity, wikilink resolution, transcript player SPA coupling) and required parity gate
metadata:
  type: project
---

A planned refactor (docs/refactor-plan.md) replaces the vendored Quartz 4 SSG with Astro +
Solid islands; the `scripts/` content pipeline stays. Decision is locked. Reviewed 2026-05-31.

**Why:** escape the vendored fork (~100 deps, unused SPA router/worker pool). Site is ~95%
static reading content; no longer authored in Obsidian.

**How to apply** — correctness traps to watch on any migration work:
- Slug fidelity is the #1 trap; the plan wrongly names `github-slugger` as the page-slug
  helper. See [[quartz-slug-algorithm]]. Port Quartz `sluggify` instead.
- Wikilink resolution must replicate `CrawlLinks markdownLinkResolution:"shortest"` +
  `Folder/index` handling. The "shortest" rule is effectively `allSlugs.find(s => endsWith(s,
  simpleSlug))` — FIRST match in array order wins, so the new resolver must replicate slug array
  ORDER, not just the set. (Note: `linker.ts` itself matches plain-text mentions
  case-INsensitively when injecting links; Quartz's slug resolution is case-sensitive on the
  already-injected target — keep these two stages distinct.) Stock `remark-wiki-link` does NOT
  do "shortest". Auto-linker that injects `[[...]]` is `scripts/lib/linker.ts`, run BEFORE the
  SSG; pipeline output is the contract the SSG only resolves.
- Transcript player (`quartz/components/scripts/transcript.inline.ts`, 393 lines) is coupled
  to SPA primitives: the `"nav"` event, `window.addCleanup`, `getFullSlug(window)` (reads
  `body.dataset.slug`). These vanish under Astro — NOT a trivial port (plan calls it Trivial).
  The remark transformer (`transcript.ts`) is portable but must keep exact contract:
  line `id="${second}-${user}"`, `data-second`/`data-user`, classes, `<audio data-transcript>`.
- Raw-HTML pages `content/Timeline.md` and `content/index.md` contain `[[wikilinks]]` INSIDE
  raw HTML; Quartz uses `enableInHtmlEmbed:true`. Plain rehype-raw leaves literal `[[...]]`.
  They also rely on CSS custom props `--secondary`/`--darkgray` keeping their names. The plan
  is internally inconsistent on the count (says "2 files" in §8 but "9 files" in §3); an earlier
  grep put authored raw-HTML/inline-CSS files closer to ~17. Reconcile the actual count before
  trusting any "Low effort" estimate on the raw-HTML port.
- 48/93 authored filenames have spaces; 5 have non-ASCII (`Færrin`, `Ætherion Limited`,
  `Rhædon`, `Tormeré`, `Anaïs Marchal`); aliases (48 files) are also spaced/Unicode.

**Required parity gate before cutover:** build both stacks, diff (1) URL set, (2) link-graph
edges, (3) alias-redirect set, (4) heading-anchor IDs. Any non-empty diff blocks cutover.
