import type { HostConfig, Script } from "../types.ts";
import type { LlmClient, ToolSpec } from "@faerrin/llm";

/**
 * Cross-session "running threads" memory (Phase 5): the inside jokes, bits,
 * grudges, predictions, and beloved/hated recurring characters the hosts have
 * built up over past episodes. Persisted to a small JSON store and injected into
 * the script prompt so the hosts can drop callbacks WITHOUT explaining them — the
 * "shared history" pillar that a single-session generator can't fabricate.
 *
 * The store accumulates: `extractThreads` mines a finished episode, `mergeThreads`
 * dedups and caps, and `formatThreads` renders the block the script prompt consumes.
 */

export type ThreadKind = "joke" | "bit" | "grudge" | "prediction" | "character";

export interface Thread {
  /** A short reference the hosts could drop in a later episode without explaining. */
  text: string;
  kind: ThreadKind;
}

const KINDS: ReadonlySet<string> = new Set<ThreadKind>([
  "joke",
  "bit",
  "grudge",
  "prediction",
  "character",
]);

function isThread(v: unknown): v is Thread {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.text === "string" &&
    t.text.trim() !== "" &&
    typeof t.kind === "string" &&
    KINDS.has(t.kind)
  );
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** Read the running-threads store; tolerant — missing file or garbage → []. */
export async function loadThreads(path: string): Promise<Thread[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  let raw: unknown;
  try {
    raw = await file.json();
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter(isThread).map((t) => ({ text: t.text.trim(), kind: t.kind }));
}

/** Persist threads as pretty JSON. */
export async function saveThreads(path: string, threads: Thread[]): Promise<void> {
  await Bun.write(path, `${JSON.stringify(threads, null, 2)}\n`);
}

const DEFAULT_MAX_THREADS = 40;

/**
 * Append new threads to the store, dedup by normalized text, and keep the most
 * recent `max` so the injected block (and the prompt budget) stays bounded.
 */
export function mergeThreads(
  existing: Thread[],
  incoming: Thread[],
  max: number = DEFAULT_MAX_THREADS,
): Thread[] {
  const seen = new Set(existing.map((t) => normalize(t.text)));
  const merged = [...existing];
  for (const t of incoming) {
    const key = normalize(t.text);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    merged.push(t);
  }
  // Guard `slice(-0)`, which JS treats as `slice(0)` (returns everything).
  return max <= 0 ? [] : merged.slice(-max);
}

/** Render the running-threads block injected into the script prompt. Empty → "". */
export function formatThreads(threads: Thread[]): string {
  if (threads.length === 0) return "";
  const lines = threads.map((t) => `- ${t.text} [${t.kind}]`);
  return `RUNNING THREADS — inside references, bits, and grudges from past episodes that
these three already share. Drop a FEW of them naturally as callbacks, WITHOUT explaining
them to the listener; don't force them and don't gloss them.
${lines.join("\n")}`;
}

// --- extraction (mine a finished episode for new threads) -------------------

export const THREADS_TOOL_NAME = "record_running_threads";

export const threadsTool: ToolSpec = {
  name: THREADS_TOOL_NAME,
  description:
    "Record the running threads from this episode worth carrying into future " +
    "episodes. Call this exactly once.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      threads: {
        type: "array",
        description:
          "Three to seven running threads: inside jokes or bits the hosts coined, a " +
          "grudge or bold prediction one of them staked out, or a recurring character " +
          "they clearly love or love to hate. NOT one-off plot facts — only things with " +
          "legs as a future callback.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: {
              type: "string",
              description:
                "A short reference the hosts could drop unexplained in a later episode.",
            },
            kind: {
              type: "string",
              enum: ["joke", "bit", "grudge", "prediction", "character"],
              description: "What kind of running thread this is.",
            },
          },
          required: ["text", "kind"],
        },
      },
    },
    required: ["threads"],
  },
};

export function buildThreadsSystemPrompt(hosts: HostConfig): string {
  return `You just heard a finished recap episode by three friends — ${hosts.A.name},
${hosts.B.name}, and ${hosts.C.name} — talking about a Pathfinder 2e session at their
tavern table. Identify the RUNNING THREADS worth carrying into FUTURE episodes: inside
jokes or bits they coined, a grudge or a bold prediction one of them staked out, a
recurring character they clearly love or love to hate. Three to seven of them. Each must
be something they could reference again later WITHOUT explaining it — it has legs as a
callback. Do NOT include one-off plot facts, or anything that only made sense this
episode. Record them by calling the tool exactly once.`;
}

export function buildThreadsUserContent(script: Script): string {
  const body = script.turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
  return `EPISODE: ${script.title}\n\n${body}`;
}

function parseThreads(raw: unknown): Thread[] {
  if (typeof raw !== "object" || raw === null) return [];
  const arr = (raw as Record<string, unknown>).threads;
  if (!Array.isArray(arr)) return [];
  return arr.filter(isThread).map((t) => ({ text: t.text.trim(), kind: t.kind }));
}

/** Mine a finished script for running threads (one tool call). */
export async function extractThreads(
  client: LlmClient,
  script: Script,
  hosts: HostConfig,
  model?: string,
): Promise<Thread[]> {
  const raw = await client.callTool({
    system: buildThreadsSystemPrompt(hosts),
    userContent: buildThreadsUserContent(script),
    tool: threadsTool,
    model,
  });
  return parseThreads(raw);
}
