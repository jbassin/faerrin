---
name: faerrin-schema-mismatches
description: Format/schema divergences between Faerrin apps' shared data (frontmatter, slugs, transcript format)
metadata:
  type: project
---

Divergences found that complicate unifying Faerrin shared data:

- **Wiki frontmatter drift:** heartwood and quartz content/ are the "same" corpus but NOT byte-identical in every file. Example: `Geography/Calaria/index.md` — heartwood version has `--- title: Calaria / aliases: [Calaria] ---` frontmatter; quartz version is identical prose but has NO frontmatter block. So a naive dedup/diff will show spurious conflicts; one side adds frontmatter the other strips.
- **Org structure drift:** heartwood collapses some orgs to single files (e.g. `Org/Prime Meridian.md`, `Org/The Scale.md`) while quartz uses folders with `index.md` + `People/` subpages (`Org/Prime Meridian/index.md`, `Org/The Scale/People/*.md`). Same org, different file layout.
- **Slug logic:** quartz has `scripts/lib/slug.ts` — the SINGLE SOURCE OF TRUTH for URL slugs, ported verbatim from Quartz SSG, preserves case/commas/apostrophes/Unicode; `github-slugger` used ONLY for heading anchors. Astro build + pipeline both import it (isomorphic). heartwood has no equivalent — it edits raw Obsidian files and relies on `[[wikilink]]` resolution, not quartz's slug rules. strider uses its own lowercase kebab-case slugs derived from filenames.
- **Strider naming mismatch:** strider faction slugs sometimes misspell the canonical wiki name — e.g. strider `15-hildebrant-corp.md` / `hildebrant-base` vs wiki `Org/Hildebrandt Corporation`; strider `13-runggunners`/`rungunners` vs wiki `Org/RunGunners`. No shared identifier links a strider faction to its wiki Org page.
- **Transcript format:** quartz `scripts/script/*.txt` = header (context+billing, ~37 lines) + `> Speaker: text  ` quoted lines. heartwood/transcripts and caster/content/transcripts = header stripped, `> ` prefix removed, zero-padded line numbers prepended (the update-transcripts.sh transform). Two distinct on-disk formats for the same underlying transcript.

See [[faerrin-data-topology]].
