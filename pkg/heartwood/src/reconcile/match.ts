import { complete as defaultComplete } from '../llm';
import type { WikiIndex } from '../wiki/index-schema';
import type { Claim } from '../transcript/extract';
import { findCandidates } from './candidates';
import { classifyCandidates } from './classify';
import type { CandidatePageResult, ClassifyOptions, RawClassifyItem } from './classify';

export interface MatchEntry {
  claim: Claim;
  candidatePages: CandidatePageResult[];
}

export interface MatchStats {
  totalClaims: number;
  standaloneNew: number;
  pagesLoaded: number;
  bytesLoaded: number;
  candidateBatches: number;  // LLM fallback calls for candidate retrieval
  classifierBatches: number; // LLM calls for classification (one per unique page)
}

export interface MatchTranscriptResult {
  matches: MatchEntry[];
  stats: MatchStats;
}

export interface MatchTranscriptOptions {
  model: string;
  contentDir: string;
  transcript?: string;
  batchSize?: number;
  byteCap?: number;
  completeFn?: typeof defaultComplete;
  onPageClassified?: ClassifyOptions['onPageClassified'];
}

export async function matchTranscript(
  claims: Claim[],
  index: WikiIndex,
  opts: MatchTranscriptOptions,
): Promise<MatchTranscriptResult> {
  let candidateBatches = 0;
  let classifierBatches = 0;

  const wrappedCompleteFn: typeof defaultComplete | undefined = opts.completeFn
    ? (async (args) => {
        if (args.stage === 'match-candidates') candidateBatches++;
        if (args.stage === 'match-classify') classifierBatches++;
        return opts.completeFn!(args);
      }) as typeof defaultComplete
    : undefined;

  const candidates = await findCandidates(claims, index, {
    model: opts.model,
    transcript: opts.transcript,
    batchSize: opts.batchSize,
    completeFn: wrappedCompleteFn,
  });

  const uniquePages = new Set(candidates.flatMap((c) => c.paths));

  const classified = await classifyCandidates(claims, candidates, index, {
    model: opts.model,
    contentDir: opts.contentDir,
    transcript: opts.transcript,
    byteCap: opts.byteCap,
    completeFn: wrappedCompleteFn,
    onPageClassified: opts.onPageClassified,
  });

  // Approximate bytes loaded from index metadata.
  let bytesLoaded = 0;
  for (const path of uniquePages) {
    bytesLoaded += index.pages[path]?.byteLength ?? 0;
  }

  const standaloneNew = classified.filter(
    (r) => r.candidatePages.length === 1 && r.candidatePages[0]!.path === null,
  ).length;

  const matches: MatchEntry[] = classified.map((r) => ({
    claim: claims[r.claimIndex]!,
    candidatePages: r.candidatePages,
  }));

  return {
    matches,
    stats: {
      totalClaims: claims.length,
      standaloneNew,
      pagesLoaded: uniquePages.size,
      bytesLoaded,
      candidateBatches,
      classifierBatches,
    },
  };
}
