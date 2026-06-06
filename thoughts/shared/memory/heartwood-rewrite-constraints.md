---
name: heartwood-rewrite-constraints
description: Heartwood is being fully rewritten; fixed stakeholder design constraints + two hard data truths driving the rewrite
metadata:
  type: project
---

Heartwood (transcript → wiki-edit tool) is being **fully rewritten** from first principles. The old 7-stage pipeline (segment→extract→resolve→match→propose→submit→respond shipping GitHub PRs) is being thrown out.

**Why rejected (all 4 stakeholder-confirmed):** (1) edit quality — hallucinated/low-value facts, player guesses treated as canon; (2) review burden — too many tiny proposals + inline PR threads, can't see session as a narrative; (3) wrong surface — GitHub PR diffs are wrong for a worldbuilding wiki; (4) coverage — only ~52% of transcript captured.

**Two hard data truths (confirmed by sampling):**
- Transcripts are ~50% OOC noise (real-world tangents, jokes, rules lookups, scheduling). e.g. `pkg/content/transcripts/106.fey-in-the-mists.2026-4-20.txt` opens with 40 lines of USB-adapter/dead-bird banter.
- Hand-written wiki has a distinctive literary voice (see `pkg/content/wiki/Geography/Calaria/Hallia/Sableclutch/index.md`). The old tool emitted flat AI-slop that breaks that voice. **Voice may be partially unlearnable by LLMs.**

**Fixed stakeholder decisions (inputs to any design):** purpose-built INTERACTIVE REVIEW UI (web app, near aether) with full session context — NOT GitHub PRs. Wiki may gain machine-readable provenance (frontmatter/sidecar, stable IDs, per-fact source citations) but final rendered wiki MUST read as genuine human-quality prose. Aether is a live site behind Caddy with a byte-stable 763-file build — any wiki-format change implies renderer work + re-baseline. Tech: Bun+TS, @faerrin/llm AnthropicClient, jj VCS.

**Spec status:** ratified **v1.0** at `thoughts/heartwood/specs/0001-heartwood-rewrite-spec.md` (26 acceptance criteria; all 12 open questions resolved). Read it before any heartwood-rewrite work.

**Key ratified decisions (D-1..D-12):** provenance = render-invisible **sidecar** keyed by `(wikiPath, sentence-anchor)`, best-effort/self-healing (keeps aether byte-stable); **one shared world canon, every fact arc-tagged**, cross-arc conflicts possible; conflict detection is **entity-scoped**; in-character speech recorded as **attributed** canon ("NPC claimed X"), not bare fact; retcons update the **page only** (tool never auto-writes `Timeline.md`); noise discard **conservative+tunable** (borderline→Uncertain); one batched **jj commit per session**; new-page placement tool-proposed + one-click human confirm; rejected claims **auto-suppressed into a collapsed tray**; review app = **standalone local-first TanStack Start + React** (not inside aether); prose authored by human, optional in-voice **draft+critic deferred to Phase 4**; worldbuilder hand-labels **~2 sessions across 2 arcs** as the coverage/slop eval set.

**Remaining design details (not stakeholder questions):** durable sentence-anchor representation (D-1) and the aether-faithful render strategy for the standalone app (D-8) — Phase 0a.

**Still-live risk:** the review UI is the actual product (~70% of effort); voice may be partially unlearnable, so the design keeps the human on the pen.

**Why:** Team-mode (Claude personas) spec effort for the rewrite, June 2026.
**How to apply:** Treat these as fixed constraints when proposing/critiquing rewrite architectures. Favor designs that keep the human on the prose pen and draw automation at fact-extraction/citation, not authoring. See [[octo-personas-not-llms]].
