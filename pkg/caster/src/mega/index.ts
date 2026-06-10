// "Mega" episode: a fresh, regenerated month-in-review recap fused from several
// sessions in a date range. The ONLY genuinely new pipeline step is the fuse
// below — it collapses the members' already-distilled digests into one digest
// under a synthetic mega id. From there the existing stages run unchanged:
//   fuse → script (Stage 3) → tts (Stage 4) → assemble (Stage 5)
// and the face site auto-surfaces the result (it scans out/ for *.episode.mp3).

import type { Session, SessionDigest } from "../types.ts";
import type { LlmClient } from "@faerrin/llm";
import { AnthropicClient } from "@faerrin/llm";
import { distillTool } from "../distill/schema.ts";
import { parseDigest } from "../distill/parse.ts";
import { DEFAULT_OUT_DIR, digestPath, readDigest, writeDigest } from "../distill/store.ts";
import { MEGA_SYSTEM_PROMPT, buildMegaUserContent } from "./prompt.ts";
import { megaId, selectMembers, type MegaMember, type SelectOptions } from "./select.ts";

export type { MegaMember, SelectOptions } from "./select.ts";
export { dateInRange, selectMembers, megaId } from "./select.ts";
export { MEGA_SYSTEM_PROMPT, buildMegaUserContent } from "./prompt.ts";

export interface FuseOptions {
  client?: LlmClient;
  model?: string;
  maxTokens?: number;
  /**
   * Target beat count for the fused digest — the episode-length control (each
   * beat is ~2 min of finished audio). Passed to the model as the beat budget.
   */
  targetBeats?: number;
}

/**
 * Gather the cached digests for the member sessions. Throws (rather than silently
 * re-distilling — an unexpected per-session LLM cost) if any member hasn't been
 * distilled yet, naming the exact command to run.
 */
export async function collectMembers(
  sessions: Session[],
  outDir: string = DEFAULT_OUT_DIR,
): Promise<MegaMember[]> {
  const members: MegaMember[] = [];
  for (const session of sessions) {
    const digest = await readDigest(session.id, outDir);
    if (!digest) {
      throw new Error(`No digest for ${session.id}. Run \`bun run distill ${session.id}\` first.`);
    }
    members.push({ session, digest });
  }
  return members;
}

/**
 * Fuse the member digests into one month-in-review SessionDigest under `id`.
 * Reuses the distill tool + parseDigest, so the fused output is a normal digest
 * the script stage consumes with no special-casing. The LLM call sits behind
 * `LlmClient`; pass a stub in tests.
 */
export async function fuseDigests(
  id: string,
  members: MegaMember[],
  options: FuseOptions = {},
): Promise<SessionDigest> {
  if (members.length === 0) throw new Error("fuseDigests needs at least one member.");
  const client = options.client ?? new AnthropicClient();

  const raw = await client.callTool({
    system: MEGA_SYSTEM_PROMPT,
    userContent: buildMegaUserContent(members, options.targetBeats),
    tool: distillTool,
    model: options.model,
    maxTokens: options.maxTokens,
  });

  return parseDigest(id, raw);
}

export interface LoadOrFuseOptions extends FuseOptions {
  outDir?: string;
  force?: boolean;
}

export interface LoadOrFuseResult {
  digest: SessionDigest;
  /** True when served from the on-disk artifact (no LLM call). */
  cached: boolean;
  /** Path to the mega digest artifact. */
  path: string;
  /** The synthetic mega id the digest (and downstream artifacts) are keyed by. */
  id: string;
}

/**
 * Cached seam for the fuse step: select members, derive the mega id, reuse
 * out/<megaId>.digest.json when present, and otherwise fuse + persist. Mirrors
 * loadOrDistill so an expensive fuse happens at most once per range unless `force`.
 */
export async function loadOrFuseMega(
  sessions: Session[],
  selection: SelectOptions,
  options: LoadOrFuseOptions = {},
): Promise<LoadOrFuseResult> {
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const members = selectMembers(sessions, selection);
  const id = megaId(members);
  const path = digestPath(id, outDir);

  if (!options.force) {
    const existing = await readDigest(id, outDir);
    if (existing) return { digest: existing, cached: true, path, id };
  }

  const collected = await collectMembers(members, outDir);
  const digest = await fuseDigests(id, collected, options);
  await writeDigest(digest, outDir);
  return { digest, cached: false, path, id };
}
