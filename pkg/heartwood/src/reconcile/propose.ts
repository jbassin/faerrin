import { z } from 'zod';
import { stringify as yamlStringify } from 'yaml';
import { complete as defaultComplete } from '../llm';
import { parseFrontmatter } from '../wiki/frontmatter';
import type { WikiIndex } from '../wiki/index-schema';
import type { Claim } from '../transcript/extract';
import type { Segment } from '../transcript/segment';
import type { MatchEntry } from './match';
import type { AliasSuggestion } from './resolve';
import {
  buildClusters,
  type Cluster,
  type UpdateCluster,
  type CreateCluster,
  type AliasEditCluster,
  type CommentCluster,
  type Citation,
} from './cluster';
import { validateProposal, type ValidateCtx } from './validate';

// ---- Proposal types ----

export interface EditProposal {
  kind: 'edit';
  path: string;
  oldText: string;
  newText: string;
  citations: Citation[];
}

export interface CreateProposal {
  kind: 'create';
  path: string;
  content: string;
  citations: Citation[];
}

export interface AppendProposal {
  kind: 'append';
  path: string;
  afterHeading: string | null;
  content: string;
  citations: Citation[];
}

export interface CommentProposal {
  kind: 'comment';
  reason: 'contradict' | 'speculative';
  relatedPath: string | null;
  message: string;
  citations: Citation[];
}

export type Proposal =
  | EditProposal
  | CreateProposal
  | AppendProposal
  | CommentProposal;

// ---- Wiki conventions loader ----

export async function loadConventions(claudeMdPath: string): Promise<string> {
  const text = await Bun.file(claudeMdPath).text();
  const startIdx = text.indexOf('## Content Files');
  if (startIdx < 0) return text;
  const sep = '\n---\n\nDefault to using Bun';
  const endIdx = text.indexOf(sep, startIdx);
  if (endIdx < 0) return text.slice(startIdx);
  return text.slice(startIdx, endIdx);
}

// ---- LLM prompts and schemas ----

const PROPOSER_SYSTEM_TEMPLATE = [
  'You generate concrete wiki-page edits for a Pathfinder 2e campaign wiki.',
  'You will be given the current state of one page (or no page, for a new entity) and a list of claims',
  'extracted from session transcripts that should be reflected on that page.',
  '',
  'Output exactly ONE of the following:',
  '  - kind:"edit"   for a literal-substring replacement.',
  '                  oldText MUST be a verbatim substring of the page shown to you, appearing exactly once.',
  '                  newText is the replacement.',
  '  - kind:"append" for adding new content under an existing heading.',
  '                  afterHeading is the heading text (without the # prefix) where the content goes.',
  '                  Use null for end-of-file append.',
  '  - kind:"create" for proposing a new page (only when no page exists for the entity).',
  '',
  'Citations: for every claim you incorporate, include a [lineStart, lineEnd] pair in citations.',
  'Use the line ranges shown in the user message (the bracketed [start–end] before each claim).',
  'If a claim is not supported by any specific text you can quote, do NOT incorporate it.',
  '',
  'Follow the wiki conventions documented below verbatim — frontmatter, wikilinks, callouts, naming.',
  'Do NOT add information not stated in the claims. Do NOT propose edits to pages under content/Rules/.',
  '',
  '--- WIKI CONVENTIONS (from CLAUDE.md) ---',
  '{{CONVENTIONS}}',
].join('\n');

function buildSystemPrompt(conventions: string): string {
  return PROPOSER_SYSTEM_TEMPLATE.replace('{{CONVENTIONS}}', conventions);
}

const EditSchema = z.object({
  kind: z.literal('edit'),
  oldText: z.string().min(1),
  newText: z.string(),
  citations: z.array(z.tuple([z.number().int().positive(), z.number().int().positive()])).min(1),
});

const AppendSchema = z.object({
  kind: z.literal('append'),
  afterHeading: z.string().nullable(),
  content: z.string().min(1),
  citations: z.array(z.tuple([z.number().int().positive(), z.number().int().positive()])).min(1),
});

const CreateSchema = z.object({
  kind: z.literal('create'),
  path: z.string().min(1),
  content: z.string().min(1),
  citations: z.array(z.tuple([z.number().int().positive(), z.number().int().positive()])).min(1),
});

const UpdateOutputSchema = z.object({
  proposal: z.discriminatedUnion('kind', [EditSchema, AppendSchema]),
});
const CreateOutputSchema = z.object({
  proposal: CreateSchema,
});

// ---- Deterministic cluster → proposal converters ----

export function aliasEditClusterToProposal(
  cluster: AliasEditCluster,
  pageText: string,
): EditProposal | null {
  const fm = parseFrontmatter(pageText);
  const hasFrontmatter = pageText.startsWith('---\n') || pageText.startsWith('---\r\n');

  if (!hasFrontmatter) {
    if (!pageText) {
      console.warn(`propose: alias-edit target ${cluster.targetPath} is empty — skipping`);
      return null;
    }
    const newFrontmatter = buildAliasFrontmatter(cluster.variantsToAdd);
    return {
      kind: 'edit',
      path: cluster.targetPath,
      oldText: pageText,
      newText: newFrontmatter + pageText,
      citations: cluster.citations,
    };
  }

  // Extract raw YAML text from the frontmatter.
  const afterOpen = pageText.replace(/^---\r?\n/, '');
  const closeIdx = afterOpen.search(/^---\r?\n?/m);
  if (closeIdx < 0) {
    // Malformed frontmatter — no closing fence. Treat as no frontmatter.
    console.warn(`propose: alias-edit target ${cluster.targetPath} has unclosed frontmatter — skipping`);
    return null;
  }
  const yamlText = afterOpen.slice(0, closeIdx);

  const existingAliases = Array.isArray(fm.data.aliases)
    ? (fm.data.aliases as unknown[]).filter((a): a is string => typeof a === 'string')
    : null;

  if (existingAliases !== null) {
    // Has aliases: update the aliases YAML block.
    const oldAliasesYaml = yamlStringify({ aliases: existingAliases });
    const mergedAliases = [
      ...existingAliases,
      ...cluster.variantsToAdd.filter(
        (v) => !existingAliases.some((a) => a.toLowerCase() === v.toLowerCase()),
      ),
    ];
    const newAliasesYaml = yamlStringify({ aliases: mergedAliases });
    return {
      kind: 'edit',
      path: cluster.targetPath,
      oldText: oldAliasesYaml,
      newText: newAliasesYaml,
      citations: cluster.citations,
    };
  } else {
    // Has frontmatter, no aliases: insert aliases into frontmatter.
    const closingFence = '---\n';
    const oldBlock = `---\n${yamlText}${closingFence}`;
    const newYamlText = yamlText + buildAliasFrontmatter(cluster.variantsToAdd).replace(/^---\n/, '').replace(/---\n$/, '');
    const newBlock = `---\n${newYamlText}${closingFence}`;
    return {
      kind: 'edit',
      path: cluster.targetPath,
      oldText: oldBlock,
      newText: newBlock,
      citations: cluster.citations,
    };
  }
}

function buildAliasFrontmatter(variants: string[]): string {
  return `---\naliases:\n${variants.map((v) => `  - ${v}`).join('\n')}\n---\n`;
}

export function commentClusterToProposal(cluster: CommentCluster): CommentProposal {
  const parts = [`Claim: ${cluster.claim.claim}`];
  if (cluster.rationale) parts.push(`Rationale: ${cluster.rationale}`);
  if (cluster.excerpt) parts.push(`Page excerpt: ${cluster.excerpt}`);
  const message = parts.join('\n');
  return {
    kind: 'comment',
    reason: cluster.reason,
    relatedPath: cluster.relatedPath,
    message,
    citations: [cluster.claim.lines],
  };
}

// ---- LLM-driven cluster → proposal ----

export interface ProposerCtx {
  model: string;
  contentDir: string;
  conventions: string;
  transcript: string;
  wikiIndex: WikiIndex;
  completeFn?: typeof defaultComplete;
}

export async function proposeUpdate(
  c: UpdateCluster,
  ctx: ProposerCtx,
): Promise<EditProposal | AppendProposal | null> {
  const fn = ctx.completeFn ?? defaultComplete;
  const pageFile = Bun.file(`${ctx.contentDir}/${c.targetPath}`);
  if (!(await pageFile.exists())) {
    console.warn(`propose: update target missing: ${c.targetPath}`);
    return null;
  }
  const pageText = await pageFile.text();

  const systemBase = buildSystemPrompt(ctx.conventions);
  const cached = `${systemBase}\n\n--- Target Page: ${c.targetPath} ---\n${pageText}`;

  const userLines = c.claims.map(
    ({ claim, rationale }) =>
      `[${claim.lines[0]}-${claim.lines[1]}] ${claim.claim}\n  (rationale: ${rationale})`,
  );
  const user = `Update the page at ${c.targetPath} based on these claims:\n\n${userLines.join('\n\n')}`;

  const result = await fn({
    stage: 'propose',
    transcript: ctx.transcript,
    page: c.targetPath,
    model: ctx.model,
    cached,
    user,
    schema: UpdateOutputSchema,
    maxTokens: 4096,
  });

  const raw = result.value.proposal;
  if (raw.kind === 'edit') {
    return {
      kind: 'edit',
      path: c.targetPath,
      oldText: raw.oldText,
      newText: raw.newText,
      citations: raw.citations as Citation[],
    };
  }
  if (raw.kind === 'append') {
    return {
      kind: 'append',
      path: c.targetPath,
      afterHeading: raw.afterHeading,
      content: raw.content,
      citations: raw.citations as Citation[],
    };
  }
  console.warn(`propose: unexpected kind from update LLM: ${(raw as any).kind}`);
  return null;
}

export async function proposeCreate(
  c: CreateCluster,
  ctx: ProposerCtx,
): Promise<CreateProposal | null> {
  const fn = ctx.completeFn ?? defaultComplete;

  // Enumerate valid parent directories from the wiki index (excluding Rules/).
  const dirs = new Set<string>();
  for (const path of Object.keys(ctx.wikiIndex.pages)) {
    if (path.startsWith('Rules/')) continue;
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  }
  const sortedDirs = [...dirs].sort();
  const hint =
    `Valid parent directories (the new page's path must start with one of these and end in .md):\n` +
    sortedDirs.map((d) => `  - ${d}/`).join('\n');

  const systemBase = buildSystemPrompt(ctx.conventions);
  const cached = `${systemBase}\n\n--- New Page for entity: ${c.primaryEntity} ---\n${hint}`;

  const userLines = c.claims.map(
    ({ claim, rationale }) =>
      `[${claim.lines[0]}-${claim.lines[1]}] ${claim.claim}\n  (rationale: ${rationale})`,
  );
  const user = `Create a new wiki page for "${c.primaryEntity}" based on these claims:\n\n${userLines.join('\n\n')}`;

  const result = await fn({
    stage: 'propose',
    transcript: ctx.transcript,
    model: ctx.model,
    cached,
    user,
    schema: CreateOutputSchema,
    maxTokens: 4096,
  });

  const raw = result.value.proposal;
  if (raw.kind !== 'create') {
    console.warn(`propose: expected create from LLM but got: ${(raw as any).kind}`);
    return null;
  }
  return {
    kind: 'create',
    path: raw.path,
    content: raw.content,
    citations: raw.citations as Citation[],
  };
}

export async function proposeCluster(
  cluster: Cluster,
  ctx: ProposerCtx,
  pageTextLoader: (path: string) => Promise<string>,
): Promise<Proposal | null> {
  switch (cluster.kind) {
    case 'update':     return proposeUpdate(cluster, ctx);
    case 'create':     return proposeCreate(cluster, ctx);
    case 'alias-edit': return aliasEditClusterToProposal(cluster, await pageTextLoader(cluster.targetPath));
    case 'comment':    return commentClusterToProposal(cluster);
  }
}

// ---- Orchestrator ----

export interface ProposeTranscriptOptions {
  model: string;
  contentDir: string;
  conventionsPath: string;
  transcript: string;
  completeFn?: typeof defaultComplete;
  onClusterProposed?: (cluster: Cluster, proposal: Proposal | null) => void | Promise<void>;
}

export interface ProposeTranscriptResult {
  proposals: Proposal[];
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
}

export async function proposeTranscript(
  matches: MatchEntry[],
  resolutions: { claims: Claim[]; aliasSuggestions: AliasSuggestion[] },
  segments: Segment[],
  wikiIndex: WikiIndex,
  opts: ProposeTranscriptOptions,
): Promise<ProposeTranscriptResult> {
  const conventions = await loadConventions(opts.conventionsPath);

  let llmCalls = 0;
  const wrappedComplete: typeof defaultComplete = async (args) => {
    llmCalls++;
    return (opts.completeFn ?? defaultComplete)(args);
  };

  const ctx: ProposerCtx = {
    model: opts.model,
    contentDir: opts.contentDir,
    conventions,
    transcript: opts.transcript,
    wikiIndex,
    completeFn: wrappedComplete,
  };

  const pageTextLoader = async (path: string): Promise<string> => {
    return Bun.file(`${opts.contentDir}/${path}`).text();
  };

  const { clusters, stats: clusterStats } = buildClusters({
    matches,
    claims: resolutions.claims,
    aliasSuggestions: resolutions.aliasSuggestions,
  });

  const validateCtx: ValidateCtx = {
    contentDir: opts.contentDir,
    segments,
    wikiIndex,
  };

  const proposals: Proposal[] = [];
  const droppedByReason: Record<string, number> = {};
  const proposalsByKind = { edit: 0, append: 0, create: 0, comment: 0 };

  for (const cluster of clusters) {
    const proposal = await proposeCluster(cluster, ctx, pageTextLoader);
    await opts.onClusterProposed?.(cluster, proposal);

    if (proposal === null) continue;

    const vr = await validateProposal(proposal, validateCtx);
    if (!vr.ok) {
      droppedByReason[vr.reason] = (droppedByReason[vr.reason] ?? 0) + 1;
      continue;
    }

    proposals.push(vr.proposal);
    proposalsByKind[vr.proposal.kind]++;
  }

  return {
    proposals,
    stats: {
      totalClusters:    clusters.length,
      updateClusters:   clusterStats.updateClusters,
      createClusters:   clusterStats.createClusters,
      aliasEditClusters: clusterStats.aliasEditClusters,
      commentClusters:  clusterStats.commentClusters,
      proposalsByKind,
      droppedByReason,
      llmCalls,
    },
  };
}
