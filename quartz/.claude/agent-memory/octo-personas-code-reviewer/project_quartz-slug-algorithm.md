---
name: quartz-slug-algorithm
description: Quartz page-URL slugs come from a bespoke sluggify (case/comma/Unicode preserving), NOT github-slugger — the load-bearing fact for any SSG migration
metadata:
  type: project
---

Page/file URLs in this site are slugged by `sluggify` in `quartz/util/path.ts` (~line 57),
which ONLY replaces whitespace→`-`, `&`→`-and-`, `%`→`-percent`, and strips `?`/`#`. It
**preserves case, commas, apostrophes, periods, and Unicode**. `github-slugger` is used in
this codebase *only for heading/anchor IDs* (`splitAnchor`, `slugTag` partially), never for page URLs.

Proof (verify before relying): the live build emits
`public/Divinity/Outer-Gods/Watcher-With-1,000-Eyes.html` — capital letters and a literal
comma in the path. `github-slugger` would yield `watcher-with-1000-eyes` (lowercased, comma
dropped) — a different, broken URL. Same for `Teller's Run`→`Tellers-Run`, `Tormeré`, `Anaïs Marchal`.

**Why:** matters because auto-injected `[[wikilinks]]` (see [[astro-migration]]) target raw
titles like `Watcher With 1,000 Eyes` or `Folder/index`, and link resolution must reproduce
this exact slugging or every internal link, alias redirect, sitemap, and RSS entry breaks.

**How to apply:** any rebuild/replacement of the SSG must port `sluggify` verbatim and must
NOT substitute github-slugger or a framework default slugger for page URLs. Heading anchors
are the one place github-slugger is correct. Always diff the new URL set against
`find public -name '*.html'` from the current Quartz build.
