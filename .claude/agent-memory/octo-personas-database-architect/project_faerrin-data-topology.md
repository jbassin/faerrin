---
name: faerrin-data-topology
description: How the four pkg/ apps in the Faerrin monorepo produce/consume/duplicate shared TTRPG campaign data
metadata:
  type: project
---

The monorepo at /ruby/data/experiments/faerrin has four apps under pkg/: caster, heartwood, quartz, strider. All concern one Pathfinder 2e "Faerrin" campaign and share data.

**Canonical producers (verified by reading files):**
- Transcripts: quartz `scripts/pipeline/ingest.ts` fetches from remote API `https://static-audio.iridi.cc/` (config in `scripts/config.ts`) → `scripts/data/*.json`. This is the ONLY origin of transcript data.
- Campaign/character config: quartz `scripts/campaigns.yaml` (source of truth). `scripts/shibboleth.json` is a GENERATED artifact from it (via `scripts/pipeline/script.ts` → `toShibbolethJson`).
- World wiki: hand-maintained Obsidian markdown. heartwood `content/` is the human-edited copy (heartwood ships GitLab MRs against it per pkg/heartwood/CLAUDE.md). quartz `content/` and caster `content/wiki/` are byte-identical copies of the same corpus (same tree: Geography/Phenomena/Org/Rules/Divinity/Timeline.md).
- Faction/map data: strider `content/factions/*.md` and `content/layers/*.md` — DIFFERENT schema (name/color/symbol frontmatter + axial hex coords), app-specific to "The Strider" city map.

**Duplication (the core problem):**
- Wiki corpus exists in 3 places: quartz/content, heartwood/content, caster/content/wiki.
- Per-campaign transcripts (filename stem from `campaignFilename` in scripts/lib/campaigns.ts, e.g. `000.through-a-song-darkly.2025-10-27.txt`) exist in 3 places: quartz scripts/script/, heartwood/transcripts/, caster/content/transcripts/.
- shibboleth.json exists in quartz/scripts and caster/content.

**The ad-hoc sync:** pkg/heartwood/update-transcripts.sh copies quartz `scripts/script/*` → heartwood `transcripts/`, applying `tail -n +38 | cut -c 3- | nl -n rz` (strips the campaign/billing header, strips the `> ` quote prefix, line-numbers). It uses HARDCODED pre-monorepo sibling paths `/emerald/data/experiments/{quartz,heartwood}` — stale after the `pkg/` move; broken in the monorepo.

**Format note:** caster/content/transcripts are already line-numbered+header-stripped (same as heartwood output), NOT raw quartz `> Speaker: text` format — so caster consumes the heartwood-style derived form, not quartz's raw script.txt. Caster has MORE recent dates than heartwood (e.g. 2026-6-1, 2026-5-25), so the copies are out of sync.

See [[ssot-migration-goal]] for the migration objective and [[faerrin-schema-mismatches]] for frontmatter/slug divergences.
