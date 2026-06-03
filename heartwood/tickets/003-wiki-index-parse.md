id: 003
title: wiki-index-parse
parent: 001
type: task
author: jbassin
---

## Overview
Walk `content/` and produce a structured JSON index of every page. **No LLM calls** in this ticket — pure parsing. This index is the cheap-lookup surface that lets later passes avoid loading full page text.

## Changes Required

### Wiki walker
**File**: `src/wiki/load.ts` (new)
**Changes**: Recursive walk of `content/` using `Bun.file` and `Bun.$`. For each `.md`: parse YAML frontmatter, extract title (frontmatter or filename), aliases, tags, wikilinks (regex over `[[...]]`), section headings, content hash (SHA-256). Resolve `[[name]]` and `[[path|display]]` forms to canonical paths.

### Index schema + writer
**File**: `src/wiki/index-schema.ts` (new), `state/wiki-index.json` (output)
**Changes**: Schema `{ pages: { [path]: { path, title, aliases, tags, wikilinks: [path], headings, contentHash, byteLength, summary?: null, keyFacts?: null } } }`. `summary` and `keyFacts` are nullable here and populated in ticket 004.

### CLI command
**File**: `src/cli/index-wiki.ts` (new), `package.json` (script)
**Changes**: `bun run index-wiki` writes `state/wiki-index.json`. Idempotent. `--check` flag exits non-zero if index is stale relative to current `content/` (used in CI later).

## Success Criteria

### Automated Verification
- [ ] `bun run index-wiki` succeeds on the current `content/` tree
- [ ] Output index contains an entry for every `.md` file under `content/` (count check)
- [ ] Every wikilink in the index resolves to a real entry (or is recorded in `unresolvedLinks`)
- [ ] Alias map is bidirectional: each alias resolves back to its page path
- [ ] Unit tests cover Obsidian wikilink edge cases: `[[Page]]`, `[[path/to/index|Display]]`, `[[Page#Section]]`, links inside callouts, links in frontmatter

### Manual Verification
- [ ] Spot-check 5 random entries against their source files
- [ ] Special-character filenames (`Færrin.md`, `Tormeré/index.md`, `Rhædon`, `Ætherion`) round-trip correctly
