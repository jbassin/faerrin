import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { propose } from './propose';
import { readLedger, writeLedger, markStage } from '../transcript/ledger';
import type { complete } from '../llm';

// ---- Helpers ----

const PAGE_PATH = 'Org/Some Place.md';
const PAGE_CONTENT = 'Some Place is a notable location in the world.\nMore details here.\n';

function makeWikiIndex(extraPages: Record<string, {}> = {}): object {
  const pages: Record<string, object> = {
    [PAGE_PATH]: {
      path: PAGE_PATH, title: 'Some Place',
      aliases: [], tags: [], img: null, headings: [], wikilinks: [],
      contentHash: 'abc', byteLength: 50, summary: null, keyFacts: null, entities: null,
    },
  };
  for (const [p, v] of Object.entries(extraPages)) pages[p] = v;
  return { generatedAt: '2026-01-01T00:00:00Z', pageCount: Object.keys(pages).length, pages, unresolvedLinks: [] };
}

function makeTranscriptText(n: number): string {
  return Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(6, '0')}\tGamemaster: line ${i + 1}`).join('\n');
}

interface Setup {
  root:           string;
  transcriptsDir: string;
  ledgerPath:     string;
  segmentsDir:    string;
  resolutionsDir: string;
  matchesDir:     string;
  proposalsDir:   string;
  contentDir:     string;
  wikiIndexPath:  string;
}

function setup(transcriptNames: string[] = ['000.alpha.2025-8-28.txt']): Setup {
  const root           = mkdtempSync(join(tmpdir(), 'propose-cli-'));
  const transcriptsDir = join(root, 'transcripts');
  const segmentsDir    = join(root, 'segments');
  const resolutionsDir = join(root, 'resolutions');
  const matchesDir     = join(root, 'matches');
  const proposalsDir   = join(root, 'proposals');
  const contentDir     = join(root, 'content');
  const wikiIndexPath  = join(root, 'wiki-index.json');

  mkdirSync(transcriptsDir);
  mkdirSync(segmentsDir);
  mkdirSync(resolutionsDir);
  mkdirSync(matchesDir);
  mkdirSync(join(contentDir, 'Org'), { recursive: true });

  writeFileSync(wikiIndexPath, JSON.stringify(makeWikiIndex(), null, 2));
  writeFileSync(join(contentDir, PAGE_PATH), PAGE_CONTENT);

  for (const name of transcriptNames) {
    writeFileSync(join(transcriptsDir, name), makeTranscriptText(60));
  }

  return { root, transcriptsDir, ledgerPath: join(root, 'processed.json'), segmentsDir, resolutionsDir, matchesDir, proposalsDir, contentDir, wikiIndexPath };
}

function teardown(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

// Pre-populate state so the propose stage can run.
async function populateState(
  s: Setup,
  filename: string,
  opts: { matchRelation?: string } = {},
): Promise<void> {
  // Use the real file hash (same as ledger computes).
  const transcriptBytes = await Bun.file(join(s.transcriptsDir, filename)).bytes();
  const contentHash = new Bun.CryptoHasher('sha256').update(transcriptBytes).digest('hex');

  // Write segments.
  const segments = [{ startLine: 1, endLine: 60, label: 'ic', confidence: 'high', oneLineSummary: 'play' }];
  writeFileSync(join(s.segmentsDir, `${filename}.json`), JSON.stringify({
    filename, contentHash, segments, totalLines: 60, windowCount: 1, refinedCount: 0,
  }, null, 2));

  // Write claims/resolutions.
  const claims = [{
    claim: 'Some Place is a notable location.',
    lines: [10, 11],
    speaker: 'Gamemaster',
    role: 'gm',
    confidence: 'stated',
    entities: ['Some Place'],
    sourceSegmentStartLine: 1,
    entityResolutions: [],
  }];
  writeFileSync(join(s.resolutionsDir, `${filename}.json`), JSON.stringify({
    filename, contentHash, claimsContentHash: contentHash,
    resolvedCount: 0, suggestionCount: 0, aliasSuggestions: [], claims,
  }, null, 2));

  // Write matches.
  const relation = opts.matchRelation ?? 'update';
  const matches = [{
    claim: claims[0],
    candidatePages: [{
      path: relation === 'update' ? PAGE_PATH : null,
      relation,
      rationale: 'Adds useful context.',
      excerpt: 'Some Place is a notable',
    }],
  }];
  writeFileSync(join(s.matchesDir, `${filename}.json`), JSON.stringify({
    filename, contentHash, claimsContentHash: contentHash,
    stats: { totalClaims: 1, standaloneNew: 0, pagesLoaded: 1, bytesLoaded: 50, candidateBatches: 0, classifierBatches: 1 },
    matches,
  }, null, 2));

  // Set ledger stages.
  let l = await readLedger(s.ledgerPath);
  // Find the entry (it should already exist from discoverTranscripts, but manually set it up).
  const existing = l.entries.find((e) => e.filename === filename);
  if (!existing) {
    // Create it manually.
    l = {
      ...l,
      entries: [
        ...l.entries,
        {
          filename,
          contentHash,
          stages: {
            segmented: '2026-01-01T00:00:00Z',
            extracted: '2026-01-01T00:00:00Z',
            resolved:  '2026-01-01T00:00:00Z',
            matched:   '2026-01-01T00:00:00Z',
            proposed:  null,
            verified:  null,
            prOpened:  null,
          },
          errors: [],
        },
      ],
    };
  } else {
    l = markStage(l, filename, 'segmented', '2026-01-01T00:00:00Z');
    l = markStage(l, filename, 'extracted', '2026-01-01T00:00:00Z');
    l = markStage(l, filename, 'resolved',  '2026-01-01T00:00:00Z');
    l = markStage(l, filename, 'matched',   '2026-01-01T00:00:00Z');
  }
  await writeLedger(s.ledgerPath, l);
}

// Fake complete that returns an edit proposal for update clusters.
function makeProposeFake(
  oldText = 'Some Place is a notable location in the world.',
  newText = 'Some Place is a legendary location in the world.',
): typeof complete {
  return (async (args: any) => {
    if (args.stage === 'propose') {
      return {
        text: '',
        usage: { input: 10, cacheRead: 0, cacheWrite: 0, output: 50, ms: 50 },
        value: { proposal: { kind: 'edit', oldText, newText, citations: [[10, 11]] } },
      };
    }
    throw new Error(`Unexpected stage: ${args.stage}`);
  }) as never;
}

// ---- Tests ----

test('single-transcript run writes proposals JSON and sets stages.proposed', async () => {
  const s = setup();
  try {
    const filename = '000.alpha.2025-8-28.txt';
    // Run propose --all once so the ledger entry is created, then populate state.
    await propose(undefined, { all: true }, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir,
      segmentsDir: s.segmentsDir, proposalsDir: s.proposalsDir,
      contentDir: s.contentDir, wikiIndexPath: s.wikiIndexPath, claudeMdPath: 'CLAUDE.md',
      model: 'fake', completeFn: makeProposeFake(),
    });
    // Nothing to propose yet (stages not set). Now set up proper state.
    await populateState(s, filename);

    await propose(filename.slice(0, 5), {}, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir,
      segmentsDir: s.segmentsDir, proposalsDir: s.proposalsDir,
      contentDir: s.contentDir, wikiIndexPath: s.wikiIndexPath, claudeMdPath: 'CLAUDE.md',
      model: 'fake', completeFn: makeProposeFake(),
    });

    const outPath = join(s.proposalsDir, `${filename}.json`);
    expect(existsSync(outPath)).toBe(true);
    const payload = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(payload.filename).toBe(filename);
    expect(Array.isArray(payload.proposals)).toBe(true);
    expect(payload.stats).toHaveProperty('totalClusters');
    expect(payload.stats).toHaveProperty('proposalsByKind');
    expect(payload.stats).toHaveProperty('llmCalls');

    const l = await readLedger(s.ledgerPath);
    const e = l.entries.find((x) => x.filename === filename)!;
    expect(e.stages.proposed).not.toBeNull();
  } finally { teardown(s.root); }
});

test('--all skips transcripts whose stages.proposed is already set', async () => {
  const s = setup(['000.alpha.2025-8-28.txt', '101.beta.2026-1-1.txt']);
  try {
    const alpha = '000.alpha.2025-8-28.txt';
    const beta  = '101.beta.2026-1-1.txt';

    await populateState(s, alpha);
    await populateState(s, beta);

    // Pre-mark alpha as proposed.
    let l = await readLedger(s.ledgerPath);
    l = markStage(l, alpha, 'proposed', '2026-01-01T00:00:00Z');
    await writeLedger(s.ledgerPath, l);

    let callCount = 0;
    const countingFake: typeof complete = (async (args: any) => {
      if (args.stage === 'propose') callCount++;
      return makeProposeFake()(args as any);
    }) as never;

    await propose(undefined, { all: true }, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir,
      segmentsDir: s.segmentsDir, proposalsDir: s.proposalsDir,
      contentDir: s.contentDir, wikiIndexPath: s.wikiIndexPath, claudeMdPath: 'CLAUDE.md',
      model: 'fake', completeFn: countingFake,
    });

    // Only beta should be proposed.
    expect(existsSync(join(s.proposalsDir, `${beta}.json`))).toBe(true);
    expect(existsSync(join(s.proposalsDir, `${alpha}.json`))).toBe(false);
  } finally { teardown(s.root); }
});

test('--all skips transcripts whose stages.matched is null', async () => {
  const s = setup(['000.alpha.2025-8-28.txt']);
  try {
    // Run propose --all without setting up state → nothing to process
    await propose(undefined, { all: true }, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir,
      segmentsDir: s.segmentsDir, proposalsDir: s.proposalsDir,
      contentDir: s.contentDir, wikiIndexPath: s.wikiIndexPath, claudeMdPath: 'CLAUDE.md',
      model: 'fake', completeFn: makeProposeFake(),
    });
    // proposalsDir should be empty (or not exist yet)
    expect(existsSync(join(s.proposalsDir, '000.alpha.2025-8-28.txt.json'))).toBe(false);
  } finally { teardown(s.root); }
});

test('--all continues past a single failure, records error, exits non-zero', async () => {
  const s = setup(['000.alpha.2025-8-28.txt', '101.beta.2026-1-1.txt']);
  try {
    const alpha = '000.alpha.2025-8-28.txt';
    const beta  = '101.beta.2026-1-1.txt';

    await populateState(s, alpha);
    await populateState(s, beta);

    // Alpha will succeed; beta's matches file has wrong contentHash.
    rmSync(join(s.matchesDir, `${beta}.json`));
    writeFileSync(join(s.matchesDir, `${beta}.json`), JSON.stringify({
      filename: beta, contentHash: 'WRONG',
      claimsContentHash: 'WRONG', stats: {}, matches: [],
    }, null, 2));

    let threw = false;
    try {
      await propose(undefined, { all: true }, {
        transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
        resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir,
        segmentsDir: s.segmentsDir, proposalsDir: s.proposalsDir,
        contentDir: s.contentDir, wikiIndexPath: s.wikiIndexPath, claudeMdPath: 'CLAUDE.md',
        model: 'fake', completeFn: makeProposeFake(),
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    // Alpha should still succeed.
    expect(existsSync(join(s.proposalsDir, `${alpha}.json`))).toBe(true);

    // Beta's error should be recorded.
    const l = await readLedger(s.ledgerPath);
    const betaEntry = l.entries.find((e) => e.filename === beta)!;
    expect(betaEntry.errors.length).toBeGreaterThan(0);
  } finally { teardown(s.root); }
});

test('stale matches: contentHash mismatch → throws with helpful message', async () => {
  const s = setup();
  try {
    const filename = '000.alpha.2025-8-28.txt';
    await populateState(s, filename);

    // Overwrite matches with wrong contentHash.
    const matchesPath = join(s.matchesDir, `${filename}.json`);
    const data = JSON.parse(readFileSync(matchesPath, 'utf8'));
    data.contentHash = 'DIFFERENT';
    writeFileSync(matchesPath, JSON.stringify(data, null, 2));

    let error: Error | null = null;
    try {
      await propose(filename.slice(0, 5), {}, {
        transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
        resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir,
        segmentsDir: s.segmentsDir, proposalsDir: s.proposalsDir,
        contentDir: s.contentDir, wikiIndexPath: s.wikiIndexPath, claudeMdPath: 'CLAUDE.md',
        model: 'fake', completeFn: makeProposeFake(),
      });
    } catch (err) {
      error = err as Error;
    }

    expect(error).not.toBeNull();
    expect(error!.message).toContain('transcript changed since match');
  } finally { teardown(s.root); }
});

test('stale resolutions: contentHash mismatch → throws with helpful message', async () => {
  const s = setup();
  try {
    const filename = '000.alpha.2025-8-28.txt';
    await populateState(s, filename);

    // Overwrite resolutions with wrong contentHash.
    const resPath = join(s.resolutionsDir, `${filename}.json`);
    const data = JSON.parse(readFileSync(resPath, 'utf8'));
    data.contentHash = 'STALE';
    writeFileSync(resPath, JSON.stringify(data, null, 2));

    let error: Error | null = null;
    try {
      await propose(filename.slice(0, 5), {}, {
        transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
        resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir,
        segmentsDir: s.segmentsDir, proposalsDir: s.proposalsDir,
        contentDir: s.contentDir, wikiIndexPath: s.wikiIndexPath, claudeMdPath: 'CLAUDE.md',
        model: 'fake', completeFn: makeProposeFake(),
      });
    } catch (err) {
      error = err as Error;
    }

    expect(error).not.toBeNull();
    expect(error!.message).toContain('transcript changed since resolution');
  } finally { teardown(s.root); }
});

test('missing matches file → throws with helpful message', async () => {
  const s = setup();
  try {
    const filename = '000.alpha.2025-8-28.txt';
    await populateState(s, filename);
    rmSync(join(s.matchesDir, `${filename}.json`));

    let error: Error | null = null;
    try {
      await propose(filename.slice(0, 5), {}, {
        transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
        resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir,
        segmentsDir: s.segmentsDir, proposalsDir: s.proposalsDir,
        contentDir: s.contentDir, wikiIndexPath: s.wikiIndexPath, claudeMdPath: 'CLAUDE.md',
        model: 'fake', completeFn: makeProposeFake(),
      });
    } catch (err) {
      error = err as Error;
    }

    expect(error).not.toBeNull();
    expect(error!.message).toContain('matches file missing');
  } finally { teardown(s.root); }
});

test('running twice with deterministic fake LLM produces byte-identical output', async () => {
  const s = setup();
  try {
    const filename = '000.alpha.2025-8-28.txt';
    await populateState(s, filename);

    const opts = {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir,
      segmentsDir: s.segmentsDir, proposalsDir: s.proposalsDir,
      contentDir: s.contentDir, wikiIndexPath: s.wikiIndexPath, claudeMdPath: 'CLAUDE.md',
      model: 'fake', completeFn: makeProposeFake(),
    };

    await propose(filename.slice(0, 5), {}, opts);

    const outPath = join(s.proposalsDir, `${filename}.json`);
    const first = readFileSync(outPath, 'utf8');

    // Reset proposed stage so we can run again.
    let l = await readLedger(s.ledgerPath);
    const entry = l.entries.find((e) => e.filename === filename)!;
    l = {
      ...l,
      entries: l.entries.map((e) =>
        e.filename === filename
          ? { ...e, stages: { ...e.stages, proposed: null } }
          : e,
      ),
    };
    await writeLedger(s.ledgerPath, l);

    await propose(filename.slice(0, 5), {}, opts);
    const second = readFileSync(outPath, 'utf8');

    // The proposals themselves should match (ignoring any timestamp in stats).
    const p1 = JSON.parse(first);
    const p2 = JSON.parse(second);
    expect(JSON.stringify(p1.proposals)).toBe(JSON.stringify(p2.proposals));
  } finally { teardown(s.root); }
});

test('debug files written per LLM update cluster invocation', async () => {
  const s = setup();
  try {
    const filename = '000.alpha.2025-8-28.txt';
    // Use 'update' relation so we get LLM calls.
    await populateState(s, filename, { matchRelation: 'update' });

    await propose(filename.slice(0, 5), {}, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir,
      segmentsDir: s.segmentsDir, proposalsDir: s.proposalsDir,
      contentDir: s.contentDir, wikiIndexPath: s.wikiIndexPath, claudeMdPath: 'CLAUDE.md',
      model: 'fake', completeFn: makeProposeFake(),
    });

    const debugDir = join(s.proposalsDir, '_debug', filename);
    expect(existsSync(debugDir)).toBe(true);
    const debugFiles = readdirSync(debugDir).filter((f) => f.endsWith('.json'));
    expect(debugFiles.length).toBeGreaterThan(0);
  } finally { teardown(s.root); }
});

test('no args prints usage and exits non-zero', async () => {
  const s = setup();
  try {
    let exited = false;
    const origExit = process.exit;
    (process as any).exit = (code: number) => { exited = true; throw new Error(`exit(${code})`); };
    try {
      await propose(undefined, {}, {
        transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
        resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir,
        segmentsDir: s.segmentsDir, proposalsDir: s.proposalsDir,
        contentDir: s.contentDir, wikiIndexPath: s.wikiIndexPath, claudeMdPath: 'CLAUDE.md',
        model: 'fake',
      });
    } catch {
      // expected
    }
    expect(exited).toBe(true);
  } finally {
    teardown(s.root);
  }
});
