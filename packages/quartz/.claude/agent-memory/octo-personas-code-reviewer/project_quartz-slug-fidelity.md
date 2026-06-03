---
name: quartz-slug-fidelity
description: The single biggest correctness risk in the Quartz→Astro+Solid rebuild — slug/wikilink fidelity vs Quartz's custom sluggify (NOT github-slugger)
metadata:
  type: project
---

The site (`heart.iridi.cc`) is being rebuilt from vendored Quartz 4 to Astro+Solid. Plan: `/ruby/data/experiments/quartz/docs/refactor-plan.md`. Pipeline in `scripts/` stays; only the SSG is replaced.

**Critical correctness fact:** Quartz does NOT slugify page paths with `github-slugger`. Page/file slugs come from `sluggify()` in `quartz/util/path.ts` (~line 57), which only does: `\s→-`, `&→-and-`, `%→-percent`, strip `?` and `#`. It does **NOT** lowercase, does **NOT** transliterate Unicode, does **NOT** strip commas/apostrophes/parens. `github-slugger` is used ONLY for heading anchors (`splitAnchor`, toc.ts). The refactor plan lists `github-slugger` as a build helper — using it for page slugs would change URLs for ~60 files.

Concrete divergence cases that WILL break if Astro uses github-slugger or default slugs:
- `Watcher With 1,000 Eyes.md` → Quartz `Watcher-With-1,000-Eyes` (comma kept) vs github-slugger `watcher-with-1000-eyes`.
- `Teller's Run/index.md` → apostrophe kept vs stripped.
- `Færrin.md`, `Tormeré`, `Rhædon`, `Ætherion Limited`, `Anaïs Marchal` → Unicode preserved verbatim vs transliterated/stripped.
- Case preserved (`Pale-Lantern-Society`) vs lowercased.

**Why:** 60 of 94 authored files have spaces/Unicode/commas/apostrophes in names (verified via find). The pipeline's `linker.ts` auto-injects `[[Title|match]]` wikilinks using the bare title (or `folder/index` path) as target — the new resolver must map those targets to the exact same slugs Quartz produced.

**How to apply:** Any review of the Astro markdown layer must verify the slug function is a port of Quartz `sluggify`, not github-slugger or Astro defaults. Require a URL-set diff against `npx quartz build` output before cutover. Tags ARE lowercased differently — `slugTag` calls `sluggify` per segment (no lowercase either), and `frontmatter.ts` line 81 dedupes; verify tag-page URLs separately.
