// SERVER-ONLY commit implementation. Statically imports Node fs/child_process + the core
// ledger/anchor modules (which themselves use node:fs/crypto). NEVER statically import this
// from a client component — commit.ts dynamic-imports it inside the server-fn handler so it
// stays out of the client bundle.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  readSessionArtifact,
  type SessionArtifact,
} from "@faerrin/heartwood/src/state/store.ts";
import {
  readReviewState,
  writeReviewState,
  type ProposalDecision,
} from "@faerrin/heartwood/src/state/review.ts";
import {
  parsePageSentences,
  anchorForSentence,
} from "@faerrin/heartwood/src/anchor/anchor.ts";
import {
  addRecords,
  makeRecord,
  readPageProvenance,
  reanchorPage,
  writePageProvenance,
} from "@faerrin/heartwood/src/state/provenance.ts";
import { writeFileAtomic } from "@faerrin/heartwood/src/state/atomic.ts";
import {
  PROV_ROOT,
  REPO_ROOT,
  REVIEW_DIR,
  SESSIONS_DIR,
  WIKI_DIR,
  within,
} from "./paths.ts";
import {
  applySupersede,
  applyWeave,
  commitMessage,
  newPageContent,
  normalizeWikiPath,
  type CommitResult,
} from "./commit.ts";

const execFileAsync = promisify(execFile);

/** Injectable I/O roots + jj runner, so commit logic is testable against a temp tree. */
export interface CommitDeps {
  wikiDir: string;
  sessionsDir: string;
  reviewDir: string;
  provRoot: string;
  runJj: (args: string[]) => Promise<string>;
}

async function defaultRunJj(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("jj", ["--no-pager", ...args], {
    cwd: REPO_ROOT,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

export const defaultCommitDeps: CommitDeps = {
  wikiDir: WIKI_DIR,
  sessionsDir: SESSIONS_DIR,
  reviewDir: REVIEW_DIR,
  provRoot: PROV_ROOT,
  runJj: defaultRunJj,
};

type Proposal = SessionArtifact["proposals"][number];

async function writeProvenanceFor(
  provRoot: string,
  wikiPath: string,
  newBody: string,
  authoredText: string,
  proposal: Proposal,
  sid: { arc: string; date: string },
): Promise<string | null> {
  const citations = proposal.facts.flatMap((f) => f.citations);
  if (citations.length === 0) return null; // schema requires ≥1 citation per record
  const claimId = proposal.facts[0]?.claimId ?? proposal.id;
  const entityIds = [proposal.entityId];

  // Locate each authored sentence in the new body by normalized match (works whether the
  // prose was appended at the end or spliced in as a Supersede correction).
  const all = parsePageSentences(newBody);
  const records = [];
  for (const a of parsePageSentences(authoredText)) {
    const idx = all.findIndex((b) => b.norm === a.norm);
    if (idx === -1) continue;
    records.push(
      makeRecord({
        anchor: anchorForSentence(all, idx),
        arc: sid.arc,
        date: sid.date,
        citations,
        claimId,
        entityIds,
      }),
    );
  }
  if (records.length === 0) return null;

  const existing = await readPageProvenance(provRoot, wikiPath);
  const healed = { wikiPath, records: reanchorPage(existing, newBody).live };
  await writePageProvenance(provRoot, addRecords(healed, records));
  return `pkg/content/.heartwood/provenance/${wikiPath}.prov.json`;
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    await readFile(abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write all approved proposals' authored prose to the wiki working tree + the provenance
 * sidecar, then create ONE jj revision containing exactly those files (AC-7, AC-15, D-2).
 * Path-scoped `jj commit` leaves any unrelated working changes (e.g. Obsidian edits) alone.
 * Idempotent: a proposal already committed (committedAt set) is skipped. Deps are injectable.
 */
export async function performCommit(
  sid: { arc: string; date: string },
  deps: CommitDeps = defaultCommitDeps,
): Promise<CommitResult> {
  const artifact = await readSessionArtifact(deps.sessionsDir, sid);
  if (!artifact) throw new Error(`Session ${sid.arc}@${sid.date} not ingested`);
  const review = await readReviewState(deps.reviewDir, sid);

  // Supersede resolutions (AC-21): map a conflicting claimId → the existing statement to replace.
  const supersededByClaim = new Map<string, string>();
  for (const c of artifact.conflicts) {
    if (review.conflictResolutions[c.claimId] === "supersede")
      supersededByClaim.set(c.claimId, c.existingStatement);
  }

  const written: string[] = [];
  const skipped: { proposal: string; reason: string }[] = [];
  const committedIds: string[] = [];
  let amend = 0;
  let create = 0;
  let corrected = 0;

  for (const p of artifact.proposals) {
    const dec = review.decisions[p.id];
    if (!dec || dec.decision !== "approved") continue;
    if (dec.committedAt) continue; // already committed (idempotent)
    const text = (dec.authoredText ?? "").trim();
    if (!text) {
      skipped.push({
        proposal: p.canonicalName,
        reason: "approved but no prose authored",
      });
      continue;
    }

    if (p.kind === "amend" && p.targetPath) {
      const abs = within(deps.wikiDir, p.targetPath);
      const existing = await readFile(abs, "utf8");
      // If a fact on this proposal has a Supersede resolution, REPLACE the existing statement
      // (a correction, AC-21); otherwise append the new prose.
      const supersedeStmt = p.facts
        .map((f) => supersededByClaim.get(f.claimId))
        .find(Boolean);
      let newBody: string;
      let isCorrection = false;
      if (supersedeStmt) {
        const r = applySupersede(existing, supersedeStmt, text);
        newBody = r.body;
        isCorrection = r.located;
      } else {
        // Weave at the reviewer's chosen location (AC-12); defaults to append-at-end.
        newBody = applyWeave(existing, text, dec.weave).body;
      }
      await writeFileAtomic(abs, newBody);
      written.push(`pkg/content/wiki/${p.targetPath}`);
      const sc = await writeProvenanceFor(
        deps.provRoot,
        p.targetPath,
        newBody,
        text,
        p,
        sid,
      );
      if (sc) written.push(sc);
      if (isCorrection) corrected++;
      else amend++;
      committedIds.push(p.id);
    } else if (p.kind === "create") {
      const tp = dec.targetPath?.trim();
      if (!tp) {
        skipped.push({
          proposal: p.canonicalName,
          reason: "create needs a target path (set it on the proposal)",
        });
        continue;
      }
      const wikiPath = normalizeWikiPath(tp);
      const abs = within(deps.wikiDir, wikiPath);
      if (await pathExists(abs)) {
        skipped.push({
          proposal: p.canonicalName,
          reason: `page already exists: ${wikiPath}`,
        });
        continue;
      }
      const newBody = newPageContent(text);
      await writeFileAtomic(abs, newBody);
      written.push(`pkg/content/wiki/${wikiPath}`);
      const sc = await writeProvenanceFor(
        deps.provRoot,
        wikiPath,
        newBody,
        text,
        p,
        sid,
      );
      if (sc) written.push(sc);
      create++;
      committedIds.push(p.id);
    } else {
      skipped.push({
        proposal: p.canonicalName,
        reason: "amend proposal has no target path",
      });
    }
  }

  if (written.length === 0) {
    return { committed: false, written, skipped, amend, create, corrected };
  }

  const message = commitMessage(sid.arc, sid.date, amend, create, corrected);
  await deps.runJj(["commit", "-m", message, ...written]);
  const revision = (
    await deps.runJj([
      "log",
      "-r",
      "@-",
      "--no-graph",
      "-T",
      "commit_id.short()",
    ])
  ).trim();

  // Mark committed proposals so a second commit doesn't re-append (idempotency).
  const now = new Date().toISOString();
  const decisions: Record<string, ProposalDecision> = { ...review.decisions };
  for (const id of committedIds) {
    const d = decisions[id];
    if (d) decisions[id] = { ...d, committedAt: now };
  }
  await writeReviewState(deps.reviewDir, {
    ...review,
    decisions,
    updatedAt: now,
  });

  return {
    committed: true,
    revision,
    message,
    written,
    skipped,
    amend,
    create,
    corrected,
  };
}
