import { z } from 'zod';
import { createClient, type GitHubClient, type CommitAction, type Discussion } from './client';
import { readSubmissions } from './submissions';
import { buildCommitActions } from './apply';
import { toRepoPath, fromRepoPath } from './paths';
import { loadConventions } from '../reconcile/propose';
import { complete as defaultComplete } from '../llm';
import { config } from '../config';
import type { LedgerEntry } from '../transcript/ledger';
import type { CommentProposal, EditProposal, AppendProposal, CreateProposal } from '../reconcile/propose';
import type { Citation } from '../reconcile/cluster';

export interface RespondCtx {
  ledgerPath:      string;
  submissionsDir:  string;
  proposalsDir:    string;
  contentDir:      string;
  transcriptsDir:  string;
  conventionsPath: string;
  clientFn?:       (apiUrl: string, token: string, repo: string) => GitHubClient;
  completeFn?:     typeof defaultComplete;
}

interface ProposalsFile {
  filename:  string;
  proposals: Array<{ kind: string; [k: string]: unknown }>;
}

// ---- Sentinel strings posted by the bot ----
const APPLIED_SENTINEL = 'Applied.';
const DENIED_SENTINEL  = 'Denied — no changes applied.';
const NEEDS_PATH_PREFIX = 'No related page to apply this to';
const NEEDS_PATH_REPLY =
  NEEDS_PATH_PREFIX +
  ' — reply `approve <path>` (e.g. `approve Phenomena/Bestiary/Auger.md`) to create that page and apply the claim there.';

export interface ReviewDecision {
  kind: 'approve' | 'deny';
  /** A target wiki page (contentDir-relative) parsed from `approve <path.md>`, else null. */
  path: string | null;
}

/**
 * Parse a reviewer's reply. `approve` accepts an optional trailing page path
 * (`approve Phenomena/Bestiary/Auger.md`) used to create/redirect where the claim
 * lands; the path is only taken when the trailing text looks like a wiki file
 * (ends in `.md`), so `approve looks good` stays a bare approval. Returns null for
 * anything that isn't a decision (the bot's own notes, sentinels, chatter).
 */
export function parseDecision(body: string): ReviewDecision | null {
  const t = body.trim();
  const approve = /^approve\b[ \t]*(.*)$/i.exec(t);
  if (approve) {
    const rest = (approve[1] ?? '').trim();
    return { kind: 'approve', path: /\.md$/i.test(rest) ? rest : null };
  }
  if (/^deny\b/i.test(t)) return { kind: 'deny', path: null };
  return null;
}

/** A bot outcome note for a decision — its presence means the decision was handled. */
function isOutcomeNote(body: string): boolean {
  return body === APPLIED_SENTINEL || body === DENIED_SENTINEL || body.startsWith(NEEDS_PATH_PREFIX);
}

// ---- LLM schemas ----

const EditSchema = z.object({
  kind:      z.literal('edit'),
  oldText:   z.string().min(1),
  newText:   z.string(),
  citations: z.array(z.tuple([z.number().int().positive(), z.number().int().positive()])).min(1),
});

const AppendSchema = z.object({
  kind:         z.literal('append'),
  afterHeading: z.string().nullable(),
  content:      z.string().min(1),
  citations:    z.array(z.tuple([z.number().int().positive(), z.number().int().positive()])).min(1),
});

const CreateSchema = z.object({
  kind:      z.literal('create'),
  path:      z.string().min(1),
  content:   z.string().min(1),
  citations: z.array(z.tuple([z.number().int().positive(), z.number().int().positive()])).min(1),
});

const ApprovalOutputSchema = z.object({
  proposal: z.discriminatedUnion('kind', [EditSchema, AppendSchema, CreateSchema]),
});

const DiffActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), filePath: z.string(), content: z.string() }),
  z.object({ action: z.literal('delete'), filePath: z.string() }),
  z.object({ action: z.literal('move'),   filePath: z.string(), previousPath: z.string(), content: z.string().optional() }),
]);

const DiffCommentOutputSchema = z.object({
  actions: z.array(DiffActionSchema),
});

// ---- Main entry point ----

export async function respondOne(entry: LedgerEntry, ctx: RespondCtx): Promise<void> {
  if (entry.stages.prOpened === null) {
    throw new Error(`PR not opened — run 'bun run submit ${entry.filename}' first`);
  }

  // Legacy GitLab entries (pre-migration) carry a gitlab.com prUrl and GitLab
  // discussion hashes that will never match GitHub IDs. Skip them rather than
  // risk acting on an unrelated GitHub PR of the same number. Reset to reprocess.
  if (entry.prUrl && /gitlab\.com|\/-\/merge_requests\//.test(entry.prUrl)) {
    console.warn(
      `respond: skipping ${entry.filename} — legacy GitLab PR (${entry.prUrl}); ` +
      `run 'bun run transcripts reset ${entry.filename}' to reprocess on GitHub`,
    );
    return;
  }

  const basename = entry.filename.endsWith('.txt')
    ? entry.filename.slice(0, -4)
    : entry.filename;

  const submissionsPath = `${ctx.submissionsDir}/${basename}.json`;
  const sub = await readSubmissions(submissionsPath);
  if (!sub) {
    throw new Error(`submissions file missing for ${entry.filename} — no discussion tracking available`);
  }

  let client: GitHubClient;
  if (ctx.clientFn) {
    client = ctx.clientFn('', '', '');
  } else {
    const cfg = config();
    client = createClient(cfg.GITHUB_API_URL, cfg.GITHUB_TOKEN, cfg.GITHUB_REPO);
  }

  const allDiscussions = await client.listDiscussions(sub.prNumber);
  const trackedIds = new Set(sub.discussions.map((d) => d.discussionId));

  // Load proposals file to resolve proposal objects by index
  const proposalsFile = Bun.file(`${ctx.proposalsDir}/${entry.filename}.json`);
  let allProposals: ProposalsFile['proposals'] = [];
  if (await proposalsFile.exists()) {
    const data: ProposalsFile = JSON.parse(await proposalsFile.text());
    allProposals = data.proposals;
  }

  const fn = ctx.completeFn ?? defaultComplete;
  let conventions: string | null = null;

  const accumulatedActions: CommitAction[] = [];
  const queuedReplies: Array<{ discussionId: string; body: string }> = [];
  let speculativeApplied = 0;
  let diffApplied = 0;

  // ---- Process tracked discussions (our speculative/contradiction notes) ----
  for (const mapping of sub.discussions) {
    const disc = allDiscussions.find((d) => d.id === mapping.discussionId);
    if (!disc) continue;

    // Act on the most recent reviewer decision (notes[0] is the bot's own note),
    // and skip if the bot has already responded to it. Using the *latest* decision
    // — not the first — lets a follow-up `approve <path>` re-open a thread the bot
    // earlier answered with "no related page".
    let decisionIdx = -1;
    for (let i = disc.notes.length - 1; i >= 1; i--) {
      if (parseDecision(disc.notes[i]!.body)) { decisionIdx = i; break; }
    }
    if (decisionIdx < 0) continue;
    if (disc.notes.slice(decisionIdx + 1).some((n) => isOutcomeNote(n.body))) continue;

    const decision = parseDecision(disc.notes[decisionIdx]!.body)!;
    if (decision.kind === 'deny') {
      queuedReplies.push({ discussionId: mapping.discussionId, body: DENIED_SENTINEL });
      continue;
    }

    // Approve. Only comment proposals carry a claim to apply; others are just acked.
    const proposal = allProposals[mapping.proposalIndex];
    if (proposal?.kind !== 'comment') {
      queuedReplies.push({ discussionId: mapping.discussionId, body: APPLIED_SENTINEL });
      continue;
    }
    const commentProposal = proposal as unknown as CommentProposal;

    // An explicit `approve <path>` wins; otherwise fall back to the claim's related
    // page. With neither, there's nowhere to write it — ask for a path.
    const targetPath = decision.path ?? commentProposal.relatedPath;
    if (targetPath === null) {
      queuedReplies.push({ discussionId: mapping.discussionId, body: NEEDS_PATH_REPLY });
      continue;
    }

    if (conventions === null) conventions = await loadConventions(ctx.conventionsPath);
    const actions = await applySpeculativeApproval(
      commentProposal, targetPath, entry.filename, ctx, fn, conventions,
    );
    accumulatedActions.push(...actions);
    speculativeApplied++;
    queuedReplies.push({ discussionId: mapping.discussionId, body: APPLIED_SENTINEL });
  }

  // ---- Process diff discussions (inline comments on changed files) ----
  for (const disc of allDiscussions) {
    if (trackedIds.has(disc.id)) continue;
    const firstNote = disc.notes[0];
    if (!firstNote?.position) continue;

    // Skip if already handled
    if (disc.notes.some((n) => n.body === APPLIED_SENTINEL)) continue;

    const actions = await applyDiffComment(disc, ctx, fn);
    accumulatedActions.push(...actions);
    diffApplied++;
    queuedReplies.push({ discussionId: disc.id, body: APPLIED_SENTINEL });
  }

  // ---- Commit all accumulated actions in one shot ----
  if (accumulatedActions.length > 0) {
    const parts: string[] = [];
    if (speculativeApplied > 0) parts.push(`${speculativeApplied} speculative approval(s) applied`);
    if (diffApplied > 0)        parts.push(`${diffApplied} diff comment(s) applied`);
    const message = `wiki: apply PR responses for ${basename}\n\n${parts.join('\n')}`;
    await client.commitFiles(sub.branch, accumulatedActions, message);
  }

  // ---- Post replies ----
  for (const { discussionId, body } of queuedReplies) {
    await client.addDiscussionNote(sub.prNumber, discussionId, body);
  }

  const total = speculativeApplied + diffApplied;
  if (total > 0 || queuedReplies.length > 0) {
    console.log(`responded ${entry.filename}: ${total} change(s) applied, ${queuedReplies.length} discussion(s) updated`);
  } else {
    console.log(`responded ${entry.filename}: nothing to do`);
  }
}

// ---- Speculative approval via LLM ----

async function applySpeculativeApproval(
  proposal:    CommentProposal,
  targetPath:  string,
  filename:    string,
  ctx:         RespondCtx,
  fn:          typeof defaultComplete,
  conventions: string,
): Promise<CommitAction[]> {
  // targetPath may be an existing page (edit/append) or a brand-new one the
  // reviewer named via `approve <path>` (create) — when it doesn't exist on disk
  // the LLM is told the page is empty and produces a `create`.
  const pageFile = Bun.file(`${ctx.contentDir}/${targetPath}`);
  const pageText = (await pageFile.exists()) ? await pageFile.text() : '';

  const transcriptLines = await readTranscriptLines(
    `${ctx.transcriptsDir}/${filename}`, proposal.citations,
  );

  const system = [
    'You incorporate a stakeholder-approved claim into a Pathfinder 2e campaign wiki page.',
    'The claim was initially flagged as speculative but has now been approved.',
    'Given the current page content and the approved claim, output exactly ONE proposal:',
    '  - kind:"edit"   — literal-substring replacement (oldText must appear exactly once in the page)',
    '  - kind:"append" — add content under a heading (afterHeading: null for end-of-file)',
    '  - kind:"create" — new page (only if the page is empty/does not exist)',
    'Follow wiki conventions verbatim. Do NOT add information beyond what the claim states.',
    '',
    '--- WIKI CONVENTIONS ---',
    conventions,
  ].join('\n');

  const user = [
    `Page path: ${toRepoPath(targetPath)}`,
    '',
    '--- Current page content ---',
    pageText || '(empty — page does not exist yet)',
    '',
    '--- Approved claim ---',
    proposal.message,
    '',
    '--- Relevant transcript excerpt ---',
    transcriptLines,
  ].join('\n');

  const cfg = ctx.completeFn ? null : config();
  const model = cfg?.MODEL_PROPOSE ?? 'claude-sonnet-4-6';

  const result = await fn({
    stage:      'respond-approve',
    transcript: filename,
    page:       targetPath,
    model,
    system,
    user,
    schema:     ApprovalOutputSchema,
    maxTokens:  4096,
  });

  const raw = result.value.proposal;
  let fullProposal: EditProposal | AppendProposal | CreateProposal;

  // Always pin the proposal to targetPath — for a create, that's the reviewer's
  // requested path, not whatever the LLM might echo back.
  if (raw.kind === 'edit') {
    fullProposal = {
      kind: 'edit', path: targetPath,
      oldText: raw.oldText, newText: raw.newText,
      citations: raw.citations as Citation[],
    };
  } else if (raw.kind === 'append') {
    fullProposal = {
      kind: 'append', path: targetPath,
      afterHeading: raw.afterHeading, content: raw.content,
      citations: raw.citations as Citation[],
    };
  } else {
    fullProposal = {
      kind: 'create', path: targetPath,
      content: raw.content,
      citations: raw.citations as Citation[],
    };
  }

  return buildCommitActions([fullProposal], { contentDir: ctx.contentDir });
}

// ---- Diff comment interpretation via LLM ----

async function applyDiffComment(
  disc:  Discussion,
  ctx:   RespondCtx,
  fn:    typeof defaultComplete,
): Promise<CommitAction[]> {
  const firstNote = disc.notes[0]!;
  const filePath  = firstNote.position!.new_path;   // repo-relative, e.g. pkg/content/wiki/Foo.md

  // The wiki lives at ctx.contentDir (../content/wiki), not heartwood's cwd.
  // Strip the repo-relative wiki prefix to read the real file off disk; filePath
  // stays repo-relative for the prompt and the committed CommitAction paths.
  const diskPath = `${ctx.contentDir}/${fromRepoPath(filePath)}`;

  // Find the first stakeholder instruction (first note in the discussion, or look at all notes)
  const instruction = disc.notes.map((n) => n.body).join('\n').trim();

  const fileContent = await (async () => {
    const f = Bun.file(diskPath);
    return (await f.exists()) ? await f.text() : '';
  })();

  const system = [
    'You apply a stakeholder\'s instruction to a wiki file.',
    'Instructions are short free-form requests such as:',
    '  "rename to X.md", "delete this entry", "merge content into [[Other Page]]"',
    'Output a JSON array of CommitActions. Each element is one of:',
    '  { "action": "update", "filePath": "<repo-relative path>", "content": "<full new file content>" }',
    '  { "action": "delete", "filePath": "<repo-relative path>" }',
    '  { "action": "move",   "filePath": "<new repo-relative path>", "previousPath": "<old path>", "content": "<full content>" }',
    'Use the exact file path provided. Do NOT add, remove, or rename other files not mentioned.',
  ].join('\n');

  const user = [
    `File: ${filePath}`,
    '',
    '--- Current file content ---',
    fileContent || '(empty)',
    '',
    '--- Stakeholder instruction ---',
    instruction,
  ].join('\n');

  const cfg = ctx.completeFn ? null : config();
  const model = cfg?.MODEL_PROPOSE ?? 'claude-sonnet-4-6';

  const result = await fn({
    stage:     'respond-diff',
    model,
    system,
    user,
    schema:    DiffCommentOutputSchema,
    maxTokens: 4096,
  });

  return result.value.actions as CommitAction[];
}

// ---- Helpers ----

async function readTranscriptLines(
  transcriptPath: string,
  citations:       Citation[],
): Promise<string> {
  const file = Bun.file(transcriptPath);
  if (!(await file.exists())) return '(transcript not available)';
  const lines = (await file.text()).split('\n');
  const parts: string[] = [];
  for (const [start, end] of citations) {
    const slice = lines.slice(start - 1, end).join('\n');
    parts.push(`[Lines ${start}–${end}]\n${slice}`);
  }
  return parts.join('\n\n');
}
