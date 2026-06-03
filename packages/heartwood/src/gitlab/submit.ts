import { mkdir } from 'node:fs/promises';
import { createClient, type GitLabClient, type CommitAction } from './client';
import { buildCommitActions } from './apply';
import { writeDryRun } from './dry-run';
import { writeSubmissions, type DiscussionMapping } from './submissions';
import { parseFilename } from '../transcript/discover';
import { markStage, setPrUrl, setMrIid, writeLedger, recordError, type Ledger, type LedgerEntry } from '../transcript/ledger';
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
  clientFn?:      (baseUrl: string, token: string, projectId: string) => GitLabClient;
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
  const mrTitle = buildMrTitle(parsed?.campaignName ?? basename, parsed?.sessionDate ?? '');

  if (ctx.dryRun) {
    const description = buildMrBody(actions, proposals, stats, '', '', entry.filename);
    const notes = commentProposals.map((p) => buildNoteBody(p, '', '', entry.filename));
    const output = await writeDryRun(basename, actions, description, notes, [], ctx.dryRunsDir);
    console.log(`dry-run: ${entry.filename}`);
    console.log(`  changes:     ${output.changesPath}`);
    console.log(`  description: ${output.descriptionPath}`);
    console.log(`  notes:       ${output.notesPath}`);
    return ledger;
  }

  let client: GitLabClient;
  if (ctx.clientFn) {
    client = ctx.clientFn('', '', '');
  } else {
    const cfg = config();
    client = createClient(cfg.GITLAB_URL, cfg.GITLAB_TOKEN, cfg.GITLAB_PROJECT_ID);
  }

  try {
    const { defaultBranch, webUrl } = await client.getProject();
    const branch = await findAvailableBranch(client, basename);
    await client.createBranch(branch, defaultBranch);

    const commitMessage = buildCommitMessage(basename, actions, proposals);
    await client.commitFiles(branch, actions, commitMessage);

    const description = buildMrBody(actions, proposals, stats, webUrl, defaultBranch, entry.filename);
    const { iid, webUrl: mrUrl } = await client.createMergeRequest({
      title:        mrTitle,
      description,
      sourceBranch: branch,
      targetBranch: defaultBranch,
    });

    const discussions: DiscussionMapping[] = [];
    for (const p of commentProposals) {
      const body = buildNoteBody(p, webUrl, defaultBranch, entry.filename);
      const { discussionId } = await client.createDiscussion(iid, body);
      discussions.push({ discussionId, proposalIndex: proposals.indexOf(p) });
    }

    await mkdir(ctx.submissionsDir, { recursive: true });
    await writeSubmissions(`${ctx.submissionsDir}/${basename}.json`, {
      filename: entry.filename,
      mrIid:    iid,
      branch,
      discussions,
    });

    let next = markStage(ledger, entry.filename, 'verified');
    next = markStage(next, entry.filename, 'prOpened');
    next = setPrUrl(next, entry.filename, mrUrl);
    next = setMrIid(next, entry.filename, iid);
    await (ctx.writeLedgerFn ?? writeLedger)(ctx.ledgerPath, next);
    console.log(`submitted ${entry.filename}: ${mrUrl}`);
    return next;
  } catch (err) {
    const msg = (err as Error).message;
    const next = recordError(ledger, entry.filename, 'prOpened', msg);
    await (ctx.writeLedgerFn ?? writeLedger)(ctx.ledgerPath, next);
    throw err;
  }
}

async function findAvailableBranch(client: GitLabClient, basename: string): Promise<string> {
  const base = `wiki/${basename}`;
  if (!(await client.branchExists(base))) return base;
  for (let i = 2; i <= 50; i++) {
    const candidate = `${base}-${i}`;
    if (!(await client.branchExists(candidate))) return candidate;
  }
  throw new Error(`no available branch name found for ${base} after 50 attempts`);
}

function buildMrTitle(campaignName: string, sessionDate: string): string {
  const titleCased = campaignName
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return `Wiki: ${titleCased} ${sessionDate}`.trimEnd();
}

function buildMrBody(
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
    const filePath = `content/${p.path}`;
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
    'Every change in this MR is backed by specific lines in the session transcript. Citation links above open the exact lines. Speculative claims and contradictions are posted as MR comments for human review — they are not applied to the wiki automatically.',
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
    ? `\`content/${proposal.relatedPath}\``
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
    const filePath = `content/${p.path}`;
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
  const anchor = start === end ? `L${start}` : `L${start}-${end}`;
  const url = `${webUrl}/-/blob/${defaultBranch}/transcripts/${filename}#${anchor}`;
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
