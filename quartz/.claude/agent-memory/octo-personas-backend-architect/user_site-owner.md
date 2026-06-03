---
name: site-owner
description: The user maintains a personal TTRPG campaign wiki and values long-term simplicity over feature breadth
metadata:
  type: user
---

The user owns/maintains "Heart of Hearts," a TTRPG campaign wiki for the Faerrin setting.
They author content by hand (no longer via Obsidian) and run a custom TypeScript content
pipeline (`scripts/`) that ingests session transcripts/audio and generates wiki + LLM artifacts.

Signals about how to help them:
- Explicitly framed the Astro migration around getting OFF a vendored fork they can't maintain —
  they care about total cost of ownership and dependency independence, not novelty.
- Stated the site "stays a reading wiki" and that the framework choice (Solid) is "a means to an
  end, not a goal." Frame recommendations around long-term maintainability and scope discipline;
  be willing to recommend cutting/deferring low-value work. See [[astro-refactor]].
