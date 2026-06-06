import { createServerFn } from "@tanstack/react-start";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { readSessionArtifact, type SessionArtifact } from "@faerrin/heartwood/src/state/store.ts";
import {
  readReviewState,
  writeReviewState,
  type ProposalDecision,
} from "@faerrin/heartwood/src/state/review.ts";
import { parsePageSentences, anchorForSentence } from "@faerrin/heartwood/src/anchor/anchor.ts";
import {
  addRecords,
  makeRecord,
  readPageProvenance,
  reanchorPage,
  writePageProvenance,
} from "@faerrin/heartwood/src/state/provenance.ts";
import { writeFileAtomic } from "@faerrin/heartwood/src/state/atomic.ts";
import { CONTENT_ROOT, WIKI_DIR, within } from "./content.ts";
import { assertSessionId } from "./sessions.ts";

const execFileAsync = promisify(execFile);

const CORE_STATE = join(process.cwd(), "..", "heartwood", "state");
// jj runs from the repo root with repo-relative path filesets.
const REPO_ROOT = join(process.cwd(), "..", "..");

/** Injectable I/O roots + jj runner, so commit logic is testable against a temp tree. */
export interface CommitDeps {
  wikiDir: string;
  sessionsDir: string;
  reviewDir: string;
  /** Durable provenance ledger root — OUTSIDE wiki/ so committing it never changes aether's build. */
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
  sessionsDir: join(CORE_STATE, "sessions"),
  reviewDir: join(CORE_STATE, "review"),
  // dot-dir aether's content walk skips (C6/D-1); committed (it's the ledger).
  provRoot: join(CONTENT_ROOT, ".heartwood", "provenance"),
  runJj: defaultRunJj,
};

type Proposal = SessionArtifact["proposals"][number];

// ---- Pure helpers (unit-tested) --------------------------------------------

/** Append authored prose as a new paragraph at the end of the page body (the chosen v1 amend strategy). */
export function appendAuthoredParagraph(body: string, text: string): string {
  const trimmed = body.replace(/\s+$/, "");
  const para = text.trim();
  return trimmed.length ? `${trimmed}\n\n${para}\n` : `${para}\n`;
}

/** New-page content: plain prose body, no frontmatter (matches many existing wiki pages). */
export function newPageContent(text: string): string {
  return `${text.trim()}\n`;
}

export function commitMessage(arc: string, date: string, amend: number, create: number): string {
  const n = amend + create;
  return `heartwood: ${arc} ${date} — ${n} page${n === 1 ? "" : "s"} (${amend} amend, ${create} create)`;
}

function normalizeWikiPath(p: string): string {
  return p.endsWith(".md") ? p : `${p}.md`;
}

// ---- Provenance --------------------------------------------------------------

async function writeProvenanceFor(
  provRoot: string,
  wikiPath: string,
  newBody: string,
  authoredText: string,
  proposal: Proposal,
  sid: { arc: string; date: string },
): Promise<string | null> {
  const citations = proposal.facts.flatMap((f) => f.citations);
  if (citations.length === 0) return null; // can't make a record without a citation (schema min 1)
  const claimId = proposal.facts[0]?.claimId ?? proposal.id;
  const entityIds = [proposal.entityId];

  // The authored prose was appended at the end, so its sentences are the last K of the body.
  const all = parsePageSentences(newBody);
  const authoredCount = parsePageSentences(authoredText).length;
  const startIdx = Math.max(0, all.length - authoredCount);
  const records = [];
  for (let i = startIdx; i < all.length; i++) {
    records.push(
      makeRecord({ anchor: anchorForSentence(all, i), arc: sid.arc, date: sid.date, citations, claimId, entityIds }),
    );
  }
  if (records.length === 0) return null;

  // Self-heal prior anchors against the new body, then append the new records.
  const existing = await readPageProvenance(provRoot, wikiPath);
  const healed = { wikiPath, records: reanchorPage(existing, newBody).live };
  await writePageProvenance(provRoot, addRecords(healed, records));
  return `pkg/content/.heartwood/provenance/${wikiPath}.prov.json`;
}

// ---- Commit ------------------------------------------------------------------

async function pathExists(abs: string): Promise<boolean> {
  try {
    await readFile(abs);
    return true;
  } catch {
    return false;
  }
}

export interface CommitResult {
  committed: boolean;
  revision?: string;
  message?: string;
  written: string[];
  skipped: { proposal: string; reason: string }[];
  amend: number;
  create: number;
}

/**
 * Write all approved proposals' authored prose to the wiki working tree + the provenance
 * sidecar, then create ONE jj revision containing exactly those files (AC-7, AC-15, D-2).
 * Path-scoped `jj commit` leaves any unrelated working changes (e.g. Obsidian edits) alone.
 * Idempotent: a proposal already committed (committedAt set) is skipped. Deps are injectable
 * so this runs against a temp tree with a stubbed jj in tests.
 */
export async function performCommit(
  sid: { arc: string; date: string },
  deps: CommitDeps = defaultCommitDeps,
): Promise<CommitResult> {
  const artifact = await readSessionArtifact(deps.sessionsDir, sid);
  if (!artifact) throw new Error(`Session ${sid.arc}@${sid.date} not ingested`);
  const review = await readReviewState(deps.reviewDir, sid);

  const written: string[] = [];
  const skipped: { proposal: string; reason: string }[] = [];
  const committedIds: string[] = [];
  let amend = 0;
  let create = 0;

  for (const p of artifact.proposals) {
    const dec = review.decisions[p.id];
    if (!dec || dec.decision !== "approved") continue;
    if (dec.committedAt) continue; // already committed (idempotent)
    const text = (dec.authoredText ?? "").trim();
    if (!text) {
      skipped.push({ proposal: p.canonicalName, reason: "approved but no prose authored" });
      continue;
    }

    if (p.kind === "amend" && p.targetPath) {
      const abs = within(deps.wikiDir, p.targetPath);
      const existing = await readFile(abs, "utf8");
      const newBody = appendAuthoredParagraph(existing, text);
      await writeFileAtomic(abs, newBody);
      written.push(`pkg/content/wiki/${p.targetPath}`);
      const sc = await writeProvenanceFor(deps.provRoot, p.targetPath, newBody, text, p, sid);
      if (sc) written.push(sc);
      amend++;
      committedIds.push(p.id);
    } else if (p.kind === "create") {
      const tp = dec.targetPath?.trim();
      if (!tp) {
        skipped.push({ proposal: p.canonicalName, reason: "create needs a target path (set it on the proposal)" });
        continue;
      }
      const wikiPath = normalizeWikiPath(tp);
      const abs = within(deps.wikiDir, wikiPath);
      if (await pathExists(abs)) {
        skipped.push({ proposal: p.canonicalName, reason: `page already exists: ${wikiPath}` });
        continue;
      }
      const newBody = newPageContent(text);
      await writeFileAtomic(abs, newBody);
      written.push(`pkg/content/wiki/${wikiPath}`);
      const sc = await writeProvenanceFor(deps.provRoot, wikiPath, newBody, text, p, sid);
      if (sc) written.push(sc);
      create++;
      committedIds.push(p.id);
    } else {
      skipped.push({ proposal: p.canonicalName, reason: "amend proposal has no target path" });
    }
  }

  if (written.length === 0) {
    return { committed: false, written, skipped, amend, create };
  }

  const message = commitMessage(sid.arc, sid.date, amend, create);
  await deps.runJj(["commit", "-m", message, ...written]);
  const revision = (await deps.runJj(["log", "-r", "@-", "--no-graph", "-T", "commit_id.short()"])).trim();

  // Mark committed proposals so a second commit doesn't re-append (idempotency).
  const now = new Date().toISOString();
  const decisions: Record<string, ProposalDecision> = { ...review.decisions };
  for (const id of committedIds) {
    const d = decisions[id];
    if (d) decisions[id] = { ...d, committedAt: now };
  }
  await writeReviewState(deps.reviewDir, { ...review, decisions, updatedAt: now });

  return { committed: true, revision, message, written, skipped, amend, create };
}

export const commitSession = createServerFn({ method: "POST" })
  .inputValidator((data: { arc: string; date: string }) => data)
  .handler(async ({ data }): Promise<CommitResult> =>
    performCommit(assertSessionId(data.arc, data.date)),
  );
