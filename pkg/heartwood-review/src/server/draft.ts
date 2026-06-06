import { createServerFn } from "@tanstack/react-start";
// CLIENT-SAFE shell (load-bearing rule): static imports are only createServerFn, the pure
// assertSessionId guard, and path constants. The core draft module (which calls the LLM via
// complete()) and all node:fs are dynamic-imported inside the handler, so nothing server-only
// reaches the client bundle. The draft NEVER writes or commits — it returns text only (D-5/C2).
import { assertSessionId } from "./sessions.ts";
import { SESSIONS_DIR } from "./paths.ts";

export interface DraftResponse {
  draft: string;
}

/**
 * Deferred in-voice draft assist (D-5): generate ONE editable starting-point passage for a
 * proposal from its cited facts (+ the existing page prose for an amend). Requires
 * ANTHROPIC_API_KEY in the app's environment; the reviewer is always the gate (it auto-commits
 * nothing). The §9 voice warnings already shown on the editor are the warn-only "voice critic".
 */
export const draftProposal = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { arc: string; date: string; proposalId: string }) => data,
  )
  .handler(async ({ data }): Promise<DraftResponse> => {
    const sessionId = assertSessionId(data.arc, data.date);
    const { readSessionArtifact } =
      await import("@faerrin/heartwood/src/state/store.ts");
    const { draftProse } =
      await import("@faerrin/heartwood/src/pipeline/draft.ts");
    const { readWikiPage } = await import("./content.ts");

    const artifact = await readSessionArtifact(SESSIONS_DIR, sessionId);
    const proposal = artifact?.proposals.find((p) => p.id === data.proposalId);
    if (!proposal) throw new Error(`proposal ${data.proposalId} not found`);

    let pageContext: string | undefined;
    if (proposal.kind === "amend" && proposal.targetPath) {
      try {
        pageContext = await readWikiPage(proposal.targetPath);
      } catch {
        /* page missing → no voice reference, still draft from facts */
      }
    }

    const { draft } = await draftProse({
      canonicalName: proposal.canonicalName,
      kind: proposal.kind,
      facts: proposal.facts.map((f) => ({ text: f.text })),
      pageContext,
    });
    return { draft };
  });
