---
name: ssot-migration-goal
description: The Faerrin monorepo migration goal — a single source of truth for shared campaign data
metadata:
  type: project
---

Goal: establish a SINGLE SOURCE OF TRUTH for shared campaign data across the four Faerrin apps, eliminating duplication and the ad-hoc `update-transcripts.sh` cross-app sync.

**Why:** the same wiki corpus is triplicated (quartz/content, heartwood/content, caster/content/wiki) and the same derived transcripts are triplicated (quartz scripts/script, heartwood/transcripts, caster/content/transcripts), kept in sync by a hardcoded-path bash script that broke when the repos moved into pkg/. Copies are already drifting (caster has newer sessions than heartwood).

**How to apply:** when designing, treat two data types as genuinely shared and app-specific data as NOT shared:
- Shared: the world wiki (markdown) + the transcript corpus (raw JSON from quartz ingest + the derived per-campaign txt) + campaigns.yaml.
- App-specific: strider's faction/layer hex-map data (different schema entirely), each app's rendering/build code.
Recommend a workspace package (e.g. pkg/shared-content or similar) holding wiki + transcripts + campaigns.yaml that the other apps import/reference, rather than copy. Central question the user flagged: are quartz's and heartwood's wikis the same content? Answer: yes, byte-identical (verified). See [[faerrin-data-topology]].
