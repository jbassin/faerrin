import { mkdir } from 'node:fs/promises';
import { createClient, type GitHubClient, type CommitAction } from './client';
import { buildCommitActions } from './apply';
import { toRepoPath } from './paths';
import { writeDryRun } from './dry-run';
import { writeSubmissions, type DiscussionMapping } from './submissions';
import { parseFilename } from '../transcript/discover';
import { markStage, setPrUrl, setPrNumber, writeLedger, recordError, type Ledger, type LedgerEntry } from '../transcript/ledger';
import type { Proposal, CommentProposal } from '../reconcile/propose';
import { config } from '../config';
import type { Citation } from '../reconcile/cluster';

export interface SubmitCtx {
  transcriptsDir: string;
  ledgerPath:     string;
  proposalsDir:   string;
  contentDir:     string;
  dryRunsDir:     string;
  submissionsDir: string;
  dryRun:         boolean;
  clientFn?:      (apiUrl: string, token: string, repo: string) => GitHubClient;
  writeLedgerFn?: (path: string, ledger: Ledger) => Promise<void>;
}

interface ProposalsFile {
  filename:           string;
  contentHash:        string;
  matchesContentHash: string;
  stats: {
    totalClusters:    number;
    updateClusters:   number;
    createClusters:   number;
    aliasEditClusters: number;
    commentClusters:  number;
    proposalsByKind:  { edit: number; append: number; create: number; comment: number };
    droppedByReason:  Record<string, number>;
    llmCalls:         number;
  };
  proposals: Proposal[];
}

export async function submitOne(
  entry: LedgerEntry,
  ledger: Ledger,
  ctx: SubmitCtx,
): Promise<Ledger> {
  const proposalsFile = Bun.file(`${ctx.proposalsDir}/${entry.filename}.json`);
  if (!(await proposalsFile.exists())) {
    throw new Error(`proposals file missing — run 'bun run propose ${entry.filename}' first`);
  }
  const proposalsData: ProposalsFile = JSON.parse(await proposalsFile.text());

  if (proposalsData.contentHash !== entry.contentHash) {
    throw new Error(
      `transcript changed since propose — reset stages and re-propose before submitting`,
    );
  }

  const { proposals, stats } = proposalsData;
  const actions = await buildCommitActions(proposals, { contentDir: ctx.contentDir });
  const commentProposals = proposals.filter((p): p is CommentProposal => p.kind === 'comment');

  const parsed = parseFilename(entry.filename);
  const basename = entry.filename.endsWith('.txt')
    ? entry.filename.slice(0, -4)
    : entry.filename;
  const prTitle = buildPrTitle(parsed?.campaignName ?? basename, parsed?.sessionDate ?? '');

  if (ctx.dryRun) {
    const body = buildPrBody(actions, proposals, stats, '', '', entry.filename);
    const notes = commentProposals.map((p) => buildNoteBody(p, '', '', entry.filename));
    const output = await writeDryRun(basename, actions, body, notes, [], ctx.dryRunsDir);
    console.log(`dry-run: ${entry.filename}`);
    console.log(`  changes:     ${output.changesPath}`);
    console.log(`  description: ${output.descriptionPath}`);
    console.log(`  notes:       ${output.notesPath}`);
    return ledger;
  }

  let client: GitHubClient;
  if (ctx.clientFn) {
    client = ctx.clientFn('', '', '');
  } else {
    const cfg = config();
    client = createClient(cfg.GITHUB_API_URL, cfg.GITHUB_TOKEN, cfg.GITHUB_REPO);
  }

  try {
    const { defaultBranch, webUrl } = await client.getProject();
    const branch = await findAvailableBranch(client, basename);
    await client.createBranch(branch, defaultBranch);

    const commitMessage = buildCommitMessage(basename, actions, proposals);
    const headSha = await client.commitFiles(branch, actions, commitMessage);

    // The first non-delete file action carries the review comments: GitHub only
    // accepts a review comment anchored to a file that appears in the PR diff.
    const carrier = actions.find((a) => a.action !== 'delete');

    let body = buildPrBody(actions, proposals, stats, webUrl, defaultBranch, entry.filename);

    // Fallback: when there are no file edits (only comments), there is no diff to
    // anchor review comments to. Fold the comment bodies into the PR body instead,
    // under a "Flagged for Review" section, so the reviewer still sees them.
    if (!carrier && commentProposals.length > 0) {
      const flagged = commentProposals
        .map((p) => buildNoteBody(p, webUrl, defaultBranch, entry.filename))
        .join('\n\n---\n\n');
      body += `\n\n## Flagged for Review\n\n${flagged}`;
    }

    const { number, webUrl: prUrl } = await client.createPullRequest({
      title:      prTitle,
      body,
      headBranch: branch,
      baseBranch: defaultBranch,
    });

    // The branch + PR now exist on GitHub. Record them to the ledger immediately
    // so a later failure can't orphan them — a retry would otherwise open a
    // second PR. Everything below is best-effort and must not revert this.
    let next = markStage(ledger, entry.filename, 'verified');
    next = markStage(next, entry.filename, 'prOpened');
    next = setPrUrl(next, entry.filename, prUrl);
    next = setPrNumber(next, entry.filename, number);
    await (ctx.writeLedgerFn ?? writeLedger)(ctx.ledgerPath, next);

    // Post each note as an inline review comment anchored to the carrier file.
    // GitHub rejects (422) a comment whose line isn't within the diff hunk, so a
    // failure here must NOT abort the submit — collect rejects and fold them into
    // a single PR-level comment so the reviewer still sees them.
    const discussions: DiscussionMapping[] = [];
    const unanchored: string[] = [];
    if (carrier) {
      for (const p of commentProposals) {
        const noteBody = buildNoteBody(p, webUrl, defaultBranch, entry.filename);
        try {
          const { discussionId } = await client.createReviewComment(number, {
            body:     noteBody,
            commitId: headSha,
            path:     carrier.filePath,
            line:     1,
          });
          discussions.push({ discussionId, proposalIndex: proposals.indexOf(p) });
        } catch (err) {
          console.warn(`submit: could not anchor review comment on ${entry.filename}: ${(err as Error).message}`);
          unanchored.push(noteBody);
        }
      }
    }
    if (unanchored.length > 0) {
      try {
        await client.addIssueComment(number, `## Flagged for Review\n\n${unanchored.join('\n\n---\n\n')}`);
      } catch (err) {
        console.warn(`submit: could not post fallback PR comment on ${entry.filename}: ${(err as Error).message}`);
      }
    }

    try {
      await mkdir(ctx.submissionsDir, { recursive: true });
      await writeSubmissions(`${ctx.submissionsDir}/${basename}.json`, {
        filename: entry.filename,
        prNumber: number,
        branch,
        discussions,
      });
    } catch (err) {
      console.warn(`submit: PR #${number} opened but failed to write submissions for ${entry.filename}: ${(err as Error).message}`);
    }

    console.log(`submitted ${entry.filename}: ${prUrl}`);
    return next;
  } catch (err) {
    const msg = (err as Error).message;
    const next = recordError(ledger, entry.filename, 'prOpened', msg);
    await (ctx.writeLedgerFn ?? writeLedger)(ctx.ledgerPath, next);
    throw err;
  }
}

async function findAvailableBranch(client: GitHubClient, basename: string): Promise<string> {
  const base = `wiki/${basename}`;
  if (!(await client.branchExists(base))) return base;
  for (let i = 2; i <= 50; i++) {
    const candidate = `${base}-${i}`;
    if (!(await client.branchExists(candidate))) return candidate;
  }
  throw new Error(`no available branch name found for ${base} after 50 attempts`);
}

function buildPrTitle(campaignName: string, sessionDate: string): string {
  const titleCased = campaignName
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return `Wiki: ${titleCased} ${sessionDate}`.trimEnd();
}

function buildPrBody(
  actions:   CommitAction[],
  proposals: Proposal[],
  stats:     ProposalsFile['stats'],
  webUrl:    string,
  defaultBranch: string,
  filename:  string,
): string {
  const commentProposals = proposals.filter((p): p is CommentProposal => p.kind === 'comment');
  const speculative = commentProposals.filter((p) => p.reason === 'speculative').length;
  const contradictions = commentProposals.filter((p) => p.reason === 'contradict').length;
  const editCount   = stats.proposalsByKind.edit;
  const appendCount = stats.proposalsByKind.append;
  const createCount = stats.proposalsByKind.create;
  const fileChanges = editCount + appendCount + createCount;

  const summaryTable = [
    '## Summary\n',
    '| Stat | Count |',
    '|------|-------|',
    `| Clusters processed | ${stats.totalClusters} |`,
    `| Edits applied | ${fileChanges} (${editCount} edit, ${appendCount} append, ${createCount} create) |`,
    `| Speculative comments | ${speculative} |`,
    `| Contradictions | ${contradictions} |`,
  ].join('\n');

  const citationsByFile = new Map<string, Citation[]>();
  for (const p of proposals) {
    if (p.kind === 'comment') continue;
    const filePath = toRepoPath(p.path);
    if (!citationsByFile.has(filePath)) citationsByFile.set(filePath, []);
    citationsByFile.get(filePath)!.push(...p.citations);
  }

  const fileRows = actions
    .filter((a) => a.action !== 'delete')
    .map((action) => {
      const rawCitations = citationsByFile.get(action.filePath) ?? [];
      const deduped = deduplicateCitations(rawCitations);
      const links = deduped.map((c) => buildCitationLink(c, webUrl, defaultBranch, filename)).join(', ');
      return `| \`${action.filePath}\` | ${links} |`;
    });

  const filesTable = [
    '\n## Files Changed\n',
    '| File | Citations |',
    '|------|-----------|',
    ...fileRows,
  ].join('\n');

  const howToReview = [
    '\n## How to Review\n',
    'Every change in this PR is backed by specific lines in the session transcript. Citation links above open the exact lines. Speculative claims and contradictions are posted as PR review comments for human review — they are not applied to the wiki automatically.',
  ].join('\n');

  return summaryTable + filesTable + howToReview;
}

function buildNoteBody(
  proposal:      CommentProposal,
  webUrl:        string,
  defaultBranch: string,
  filename:      string,
): string {
  const label = proposal.reason === 'speculative' ? '[Speculative]' : '[Contradiction]';
  const pathStr = proposal.relatedPath !== null
    ? `\`${toRepoPath(proposal.relatedPath)}\``
    : '(no related page)';
  const citationLinks = proposal.citations
    .map((c) => buildCitationLink(c, webUrl, defaultBranch, filename))
    .join(', ');
  return `**${label}** — ${pathStr}\n\n${proposal.message}\n\nCitations: ${citationLinks}`;
}

function buildCommitMessage(
  basename:  string,
  actions:   CommitAction[],
  proposals: Proposal[],
): string {
  const citationsByFile = new Map<string, Citation[]>();
  for (const p of proposals) {
    if (p.kind === 'comment') continue;
    const filePath = toRepoPath(p.path);
    if (!citationsByFile.has(filePath)) citationsByFile.set(filePath, []);
    citationsByFile.get(filePath)!.push(...p.citations);
  }

  const lines = actions.map((action) => {
    const citations = citationsByFile.get(action.filePath) ?? [];
    if (citations.length === 0) return action.filePath;
    const minStart = Math.min(...citations.map((c) => c[0]));
    const maxEnd   = Math.max(...citations.map((c) => c[1]));
    const range = minStart === maxEnd ? `${minStart}` : `${minStart}–${maxEnd}`;
    return `${action.filePath} (lines ${range})`;
  });

  return `wiki: integrate ${basename}\n\n${lines.join('\n')}`;
}

function buildCitationLink(
  citation:      Citation,
  webUrl:        string,
  defaultBranch: string,
  filename:      string,
): string {
  const [start, end] = citation;
  const anchor = start === end ? `L${start}` : `L${start}-L${end}`;
  const url = `${webUrl}/blob/${defaultBranch}/transcripts/${filename}#${anchor}`;
  const text = start === end ? `${start}` : `${start}–${end}`;
  return `[${text}](${url})`;
}

function deduplicateCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const result: Citation[] = [];
  const sorted = [...citations].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const c of sorted) {
    const key = `${c[0]}-${c[1]}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(c);
    }
  }
  return result;
}
