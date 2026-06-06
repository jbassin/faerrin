---
name: octo-personas-not-llms
description: "In this monorepo, octo workflows must use Claude persona agents instead of orchestrating other LLMs"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a41d7bcb-21c6-477e-98c0-11899c79da15
---

For this monorepo, the only available octo provider is Claude. Wherever an octo workflow (discover, plan, develop, deliver, debate, council, multi, parallel, etc.) would call out to other LLM providers (codex, gemini, perplexity, etc.) to orchestrate work, substitute Claude persona subagents (the `octo:personas:*` and `octo:droids:*` agent types) to fulfill the same roles instead.

**Hard rule (user, 2026-06-05, emphatic):** ALWAYS, under any circumstance, use the multi-team setup with Claude persona agents. Do NOT default to solo. Do NOT ask the user to run `/octo:setup`. When an octo workflow's preflight reports zero external providers, do NOT stop or fall back to solo — spawn the Claude persona-agent team and proceed.

**Why:** Other LLM CLIs/providers are not installed/available here and the user does not want to install them; the value of multi-provider orchestration (diverse perspectives, parallel role specialization) is recreated through distinct Claude personas acting as independent agents.

**How to apply:** When a workflow's banner or steps list multiple providers, map each provider role to an appropriate persona agent (e.g. backend-architect, code-reviewer, security-auditor, database-architect, deployment-engineer, typescript-pro) spawned via the Agent tool, and synthesize their outputs the way the workflow would synthesize cross-model results. The user has authorized spawning agents for octo workflows, so the "don't spawn unless asked" default does not apply to octo:* invocations.
