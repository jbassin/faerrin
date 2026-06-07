---
name: wiki-nonprose-pages
description: not all wiki pages are literary prose — Timeline.md is hand-authored HTML, deity pages are :: stat blocks, flavor docs are <pre>; any prose-quality tooling must be page-type-aware
metadata:
  type: project
---

The `pkg/content/wiki/` corpus is **not uniformly literary prose**. Distinct page types that
break any "reads as human prose" / encyclopedia-opener-regex machinery:

- **`Timeline.md`** — hand-authored HTML (`<ul>`/`<li>`/`<div>` with inline styles and
  `<br />`), small-caps era headers, wikilinks inside. NOT prose at all.
- **Deity stat blocks** — ` :: ` (space-colon-colon-space) label/value lines, each ending
  ` <br />` except the last (e.g. `**Edicts** :: … <br />`).
- **In-universe flavor docs** — wrapped in `<pre>` (logs, letters, transmissions).
- **Stub pages** — frontmatter only, no body (placeholders so wikilinks resolve).

Corpus size (2026-06-06): 196 `.md` files, of which **75 are under `Script/`** (38%) —
aether-generated transcript pages (not wiki articles), but real articles DO wikilink into them,
so `Script/` may still be a valid link *target*.

**Why:** found while critiquing a "good prose acceptance bar" that calibrates only against
literary pages (Sableclutch) and would misfire on stat blocks, HTML Timeline, and `<pre>` docs.

**How to apply:** any voice/slop check, opener regex, or "seamless amend" feature must be
page-type-aware.
