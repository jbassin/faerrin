import { z } from 'zod';
import { complete as defaultComplete } from '../llm';
import type { WikiIndex } from '../wiki/index-schema';
import type { Claim } from '../transcript/extract';
import type { CandidateResult } from './candidates';

export interface CandidatePageResult {
  path: string | null;
  relation: 'new' | 'consistent' | 'update' | 'contradict';
  rationale: string;
  excerpt: string | null;
}

export interface ClassifyResult {
  claimIndex: number;
  candidatePages: CandidatePageResult[];
}

export type RawClassifyItem = {
  claimIndex: number;
  relation: string;
  rationale: string;
  excerpt: string | null;
};

export interface ClassifyOptions {
  model: string;
  contentDir: string;
  transcript?: string;
  byteCap?: number;  // log warning if cumulative bytes loaded exceeds this; default 500_000
  completeFn?: typeof defaultComplete;
  onPageClassified?: (
    pagePath: string,
    claimIndices: number[],
    rawResults: RawClassifyItem[],
    classifiedResults: CandidatePageResult[],
  ) => void | Promise<void>;
}

const CLASSIFIER_SYSTEM = [
  'You are classifying claims from a Pathfinder 2e campaign transcript against a wiki page.',
  'For each claim (identified by its index), determine how the claim relates to the page:',
  '  consistent  — the claim is already covered by the page; no edit needed',
  '  update      — the claim adds information not yet in the page',
  '  contradict  — the claim conflicts with something the page states',
  '  new         — the claim is about a different entity or topic; it does not belong on this page',
  'For each claim, provide:',
  '  - relation: one of the four values above',
  '  - rationale: one sentence explaining the classification',
  '  - excerpt: a verbatim quote from the page relevant to the claim (null if none applies)',
  'IMPORTANT: Base your classification only on the page text provided. Do not invent facts.',
].join('\n');

const ClassifierOutputSchema = z.object({
  results: z.array(z.object({
    claimIndex: z.number().int().nonnegative(),
    relation: z.enum(['new', 'consistent', 'update', 'contradict']),
    rationale: z.string().min(1),
    excerpt: z.string().nullable(),
  })),
});

export async function classifyCandidates(
  claims: Claim[],
  candidates: CandidateResult[],
  index: WikiIndex,
  opts: ClassifyOptions,
): Promise<ClassifyResult[]> {
  const fn = opts.completeFn ?? defaultComplete;
  const byteCap = opts.byteCap ?? 500_000;

  // Build per-claim result map.
  const resultMap = new Map<number, CandidatePageResult[]>();
  for (let i = 0; i < claims.length; i++) {
    resultMap.set(i, []);
  }

  // Invert: pagePath → claimIndices.
  const pageToClaimIndices = new Map<string, number[]>();
  for (const cand of candidates) {
    for (const path of cand.paths) {
      if (!pageToClaimIndices.has(path)) pageToClaimIndices.set(path, []);
      pageToClaimIndices.get(path)!.push(cand.claimIndex);
    }
  }

  // Standalone-new claims (paths === []).
  for (const cand of candidates) {
    if (cand.paths.length === 0) {
      resultMap.get(cand.claimIndex)!.push({
        path: null,
        relation: 'new',
        rationale: 'No candidate wiki page matched this claim.',
        excerpt: null,
      });
    }
  }

  // Classify per page.
  let bytesLoaded = 0;
  for (const [pagePath, claimIndices] of pageToClaimIndices) {
    const pageFile = Bun.file(`${opts.contentDir}/${pagePath}`);
    const pageText = await pageFile.text();
    bytesLoaded += pageText.length;
    if (bytesLoaded > byteCap) {
      console.warn(
        `match(${opts.transcript}): page-load total ${bytesLoaded} bytes exceeds ${byteCap}-byte cap after loading ${pagePath}`,
      );
    }

    const userLines = claimIndices.map((i) => `[${i}] ${claims[i]!.claim}`);
    const cachedBlock = `${CLASSIFIER_SYSTEM}\n\n--- Wiki Page: ${pagePath} ---\n${pageText}`;

    const result = await fn({
      stage: 'match-classify',
      transcript: opts.transcript,
      model: opts.model,
      cached: cachedBlock,
      user: [
        `Classify each of the following claims against the wiki page shown above:`,
        ...userLines,
      ].join('\n'),
      schema: ClassifierOutputSchema,
      maxTokens: 4096,
    });

    const rawItems: RawClassifyItem[] = result.value.results;
    const classifiedItems: CandidatePageResult[] = [];

    for (const r of rawItems) {
      if (!claimIndices.includes(r.claimIndex)) continue; // LLM hallucinated an index
      const entry: CandidatePageResult = {
        path: pagePath,
        relation: r.relation as CandidatePageResult['relation'],
        rationale: r.rationale,
        excerpt: r.excerpt,
      };
      resultMap.get(r.claimIndex)!.push(entry);
      classifiedItems.push(entry);
    }

    await opts.onPageClassified?.(pagePath, claimIndices, rawItems, classifiedItems);
  }

  // Assemble output, preserving candidate path order per claim.
  const output: ClassifyResult[] = [];
  for (const cand of candidates) {
    const pages = resultMap.get(cand.claimIndex)!;
    const ordered = cand.paths
      .map((path) => pages.find((p) => p.path === path))
      .filter(Boolean) as CandidatePageResult[];
    const standaloneNew = pages.filter((p) => p.path === null);
    output.push({
      claimIndex: cand.claimIndex,
      candidatePages: [...standaloneNew, ...ordered],
    });
  }

  return output;
}
