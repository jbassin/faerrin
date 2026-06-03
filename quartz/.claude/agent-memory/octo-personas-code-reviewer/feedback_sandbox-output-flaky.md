---
name: feedback-sandbox-output-flaky
description: In this environment, sandboxed bash and some Read calls intermittently return empty/synthesized output; prefer plain bash one command at a time
metadata:
  type: feedback
---

When gathering repo evidence here, sandboxed `Bash` calls and occasionally `Read` returned empty,
truncated, or apparently synthesized output (e.g. a `find`/`grep` printing a plausible-looking but
incomplete list, or a "Wasted call" notice).

**Why:** observed repeatedly in one session — batched/sandboxed commands swallowed stdout; the
authoritative reads were the ones run as a single plain `Bash` command (no batching).

**How to apply:** for load-bearing facts (file counts, slug rules), run ONE command per Bash call,
avoid `dangerouslyDisableSandbox` reruns to "confirm," and cross-check any list against a direct
`Read` of the source file. Treat a too-clean tool result with suspicion; re-verify before citing.
