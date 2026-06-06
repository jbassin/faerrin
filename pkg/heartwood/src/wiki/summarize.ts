import { z } from 'zod';
import { complete as defaultComplete } from '../llm';
import { config } from '../config';
import { parseFrontmatter } from './frontmatter';
import type { PageRecord, Entities } from './index-schema';

const cap = (max: number) =>
  z.string().transform((s) => (s.length > max ? s.slice(0, max - 1) + '…' : s));

const SummarySchema = z.object({
  summary:  cap(200),
  // The model occasionally returns a single fact as a bare string instead of a
  // one-element array. Coerce it so one malformed page doesn't fail the whole
  // index run — deterministic at temperature:0, so it would never self-heal.
  keyFacts: z.preprocess((v) => (typeof v === 'string' ? [v] : v), z.array(cap(120)).max(8)).default([]),
  entities: z.object({
    people: z.array(z.string()).default([]),
    places: z.array(z.string()).default([]),
    orgs:   z.array(z.string()).default([]),
  }).default({ people: [], places: [], orgs: [] }),
});

const WIKI_SYSTEM_PROMPT = [
  'You are summarizing articles from a living wiki for a Pathfinder 2e tabletop campaign set in a custom world.',
  'The wiki covers: deities (with stat blocks), geographic regions and cities, organizations and their members, world phenomena, and rules articles.',
  '',
  'For each page you will emit:',
  '- summary: one to two sentences that accurately describe the page subject. Must be factual.',
  '  IMPORTANT: keep the summary under 200 characters total. Count carefully — this is strict.',
  '- keyFacts: up to 8 bullet points, each a concrete fact present in the page text.',
  '  IMPORTANT: each individual keyFact must be under 120 characters. Be concise.',
  '- entities: lists of named people, places, and organizations mentioned in the page.',
  '',
  'NEVER invent information. Only include facts that appear in the provided page text.',
].join('\n');

export interface SummarizeResult {
  summary: string;
  keyFacts: string[];
  entities: Entities;
}

const PLACEHOLDER: SummarizeResult = {
  summary: '(stub page — no content yet)',
  keyFacts: [],
  entities: { people: [], places: [], orgs: [] },
};

export interface SummarizePageOptions {
  model: string;
  completeFn?: typeof defaultComplete;
}

export async function summarizePage(
  page: PageRecord,
  contentDir: string,
  opts: SummarizePageOptions,
): Promise<SummarizeResult> {
  const raw = await Bun.file(`${contentDir}/${page.path}`).text();
  const { body } = parseFrontmatter(raw, page.path);

  if (body.trim() === '') return PLACEHOLDER;

  const fn = opts.completeFn ?? defaultComplete;
  const result = await fn({
    stage: 'summarize',
    page: page.path,
    model: opts.model,
    cached: WIKI_SYSTEM_PROMPT,
    user: `Title: ${page.title}\nPath: ${page.path}\n\n${body}`,
    schema: SummarySchema,
    maxTokens: 1024,
  });

  return result.value;
}

export interface SummarizeWikiOptions {
  contentDir: string;
  force?: boolean;
  noLlm?: boolean;
  completeFn?: typeof defaultComplete;
}

export interface SummarizeWikiResult {
  enriched: Record<string, Pick<PageRecord, 'summary' | 'keyFacts' | 'entities'>>;
  failures: string[];
}

export async function summarizeWikiPages(
  pages: Record<string, PageRecord>,
  opts: SummarizeWikiOptions,
): Promise<SummarizeWikiResult> {
  const model = config().MODEL_EXTRACT;
  const failures: string[] = [];
  const enriched: SummarizeWikiResult['enriched'] = {};

  for (const [path, page] of Object.entries(pages)) {
    const needsSummary = opts.force || page.summary === null;
    if (!needsSummary || opts.noLlm) continue;

    try {
      const result = await summarizePage(page, opts.contentDir, { model, completeFn: opts.completeFn });
      enriched[path] = result;
    } catch (err) {
      console.error(`summarize failed for ${path}: ${(err as Error).message}`);
      failures.push(path);
    }
  }

  return { enriched, failures };
}
