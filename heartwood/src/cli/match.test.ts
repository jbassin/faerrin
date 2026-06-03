import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { match } from './match';
import { segment } from './segment';
import { extract } from './extract';
import { readLedger, markStage, writeLedger } from '../transcript/ledger';
import type { complete } from '../llm';

// Creates a no-op resolutions file from an existing claims file, marks resolved in ledger.
async function createResolutionsFromClaims(
  claimsDir: string,
  resolutionsDir: string,
  ledgerPath: string,
  filename: string,
): Promise<void> {
  const claimsPath = join(claimsDir, `${filename}.json`);
  if (!existsSync(claimsPath)) return;
  const claims = JSON.parse(readFileSync(claimsPath, 'utf8'));
  const resolutions = {
    filename: claims.filename,
    contentHash: claims.contentHash,
    claimsContentHash: claims.contentHash,
    resolvedCount: 0,
    suggestionCount: 0,
    aliasSuggestions: [],
    claims: claims.claims,
  };
  writeFileSync(join(resolutionsDir, `${filename}.json`), JSON.stringify(resolutions, null, 2));
  let l = await readLedger(ledgerPath);
  l = markStage(l, filename, 'resolved', '2026-01-01T00:00:00Z');
  await writeLedger(ledgerPath, l);
}

// ---- Helpers ----

const PAGE_PATH = 'Org/Some Place.md';

function makeWikiIndex(extra: Record<string, any> = {}): object {
  return {
    generatedAt: '2026-01-01T00:00:00Z',
    pageCount: 1,
    unresolvedLinks: [],
    pages: {
      [PAGE_PATH]: {
        path: PAGE_PATH,
        title: 'Some Place',
        aliases: [],
        tags: [],
        img: null,
        headings: [],
        wikilinks: [],
        contentHash: 'abc',
        byteLength: 50,
        summary: 'A location in the world.',
        keyFacts: null,
        entities: null,
      },
      ...extra,
    },
  };
}

function makeTranscriptText(n: number, speaker = 'Gamemaster'): string {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(`${String(i).padStart(6, '0')}\t${speaker}: line ${i}`);
  }
  return out.join('\n');
}

const segmentFake: typeof complete = (async (args: any) => {
  const m = (args.user as string).match(/Window covers lines (\d+)-(\d+)\./);
  const start = Number(m![1]); const end = Number(m![2]);
  return {
    text: '',
    usage: {} as never,
    value: { segments: [{ startLine: start, endLine: end, label: 'ic', confidence: 'high', oneLineSummary: 'play' }] },
  };
}) as never;

const extractFake: typeof complete = (async (args: any) => {
  const m = (args.user as string).match(/lines (\d+)/);
  const startLine = Number(m?.[1] ?? 1);
  return {
    text: '',
    usage: {} as never,
    value: {
      claims: [{
        claim: `Fact about Some Place from line ${startLine}`,
        lineStart: startLine,
        lineEnd: startLine + 1,
        speaker: 'Gamemaster',
        role: 'gm',
        confidence: 'stated',
        entities: ['Some Place'],
      }],
    },
  };
}) as never;

// Match fake: handles candidate and classify stages.
const matchFake: typeof complete = (async (args: any) => {
  if (args.stage === 'match-candidates') {
    const lines = (args.user as string).split('\n');
    const matches = lines.map((l: string) => {
      const m = l.match(/^\[(\d+)\]/);
      if (!m) return null;
      return { claimIndex: Number(m[1]), paths: [PAGE_PATH] };
    }).filter(Boolean);
    return { text: '', usage: {} as never, value: { matches } };
  }
  // match-classify
  const lines = (args.user as string).split('\n').filter((l: string) => l.match(/^\[/));
  const results = lines.map((l: string) => {
    const m = l.match(/^\[(\d+)\]/);
    return { claimIndex: Number(m![1]), relation: 'consistent', rationale: 'Already covered.', excerpt: null };
  });
  return { text: '', usage: {} as never, value: { results } };
}) as never;

// All-in-one fake: delegates based on stage.
function makeAllFake(matchDelegate: typeof complete = matchFake): typeof complete {
  return (async (args: any) => {
    if (args.stage === 'segment') return segmentFake(args);
    if (args.stage === 'extract') return extractFake(args);
    return matchDelegate(args);
  }) as never;
}

interface Setup {
  root:            string;
  transcriptsDir:  string;
  ledgerPath:      string;
  segmentsDir:     string;
  claimsDir:       string;
  resolutionsDir:  string;
  matchesDir:      string;
  contentDir:      string;
  wikiIndexPath:   string;
}

function setup(transcripts: Record<string, string> = {}): Setup {
  const root            = mkdtempSync(join(tmpdir(), 'match-cli-'));
  const transcriptsDir  = join(root, 'transcripts');
  const segmentsDir     = join(root, 'segments');
  const claimsDir       = join(root, 'claims');
  const resolutionsDir  = join(root, 'resolutions');
  const matchesDir      = join(root, 'matches');
  const contentDir      = join(root, 'content');
  const wikiIndexPath   = join(root, 'wiki-index.json');
  mkdirSync(transcriptsDir);
  mkdirSync(segmentsDir);
  mkdirSync(claimsDir);
  mkdirSync(resolutionsDir);
  mkdirSync(matchesDir);
  mkdirSync(join(contentDir, 'Org'), { recursive: true });

  // Write wiki index.
  writeFileSync(wikiIndexPath, JSON.stringify(makeWikiIndex(), null, 2));
  // Write page content file.
  writeFileSync(join(contentDir, PAGE_PATH), 'Some Place is a notable location in the world.');

  // Default transcripts.
  if (Object.keys(transcripts).length === 0) {
    writeFileSync(join(transcriptsDir, '000.alpha.2025-8-28.txt'), makeTranscriptText(60));
    writeFileSync(join(transcriptsDir, '101.beta.2026-1-1.txt'),   makeTranscriptText(50));
  } else {
    for (const [name, text] of Object.entries(transcripts)) {
      writeFileSync(join(transcriptsDir, name), text);
    }
  }
  return { root, transcriptsDir, ledgerPath: join(root, 'processed.json'), segmentsDir, claimsDir, resolutionsDir, matchesDir, contentDir, wikiIndexPath };
}

function teardown(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

async function segmentAndExtract(s: Setup): Promise<void> {
  const base = { transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath, model: 'fake' };
  await segment(undefined, { all: true }, { ...base, segmentsDir: s.segmentsDir, completeFn: segmentFake });
  await extract(undefined, { all: true }, { ...base, segmentsDir: s.segmentsDir, claimsDir: s.claimsDir, completeFn: extractFake });
  // Create no-op resolutions for all extracted transcripts so match can proceed.
  const l = await readLedger(s.ledgerPath);
  for (const e of l.entries) {
    if (e.stages.extracted !== null) {
      await createResolutionsFromClaims(s.claimsDir, s.resolutionsDir, s.ledgerPath, e.filename);
    }
  }
}

// ---- Tests ----

test('single-transcript run writes matches JSON and sets stages.matched', async () => {
  const s = setup();
  try {
    await segmentAndExtract(s);
    await match('alpha', {}, {
      transcriptsDir:  s.transcriptsDir,
      ledgerPath:      s.ledgerPath,
      resolutionsDir:  s.resolutionsDir,
      matchesDir:      s.matchesDir,
      contentDir:      s.contentDir,
      wikiIndexPath:   s.wikiIndexPath,
      model:           'fake',
      completeFn:      matchFake,
    });

    const outPath = join(s.matchesDir, '000.alpha.2025-8-28.txt.json');
    expect(existsSync(outPath)).toBe(true);
    const payload = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(payload.filename).toBe('000.alpha.2025-8-28.txt');
    expect(Array.isArray(payload.matches)).toBe(true);
    expect(payload.matches.length).toBeGreaterThan(0);
    expect(payload.stats.totalClaims).toBe(payload.matches.length);

    const l = await readLedger(s.ledgerPath);
    const e = l.entries.find((x) => x.filename === '000.alpha.2025-8-28.txt')!;
    expect(e.stages.matched).not.toBeNull();
  } finally { teardown(s.root); }
});

test('output JSON has all expected top-level keys', async () => {
  const s = setup();
  try {
    await segmentAndExtract(s);
    await match('alpha', {}, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir, contentDir: s.contentDir,
      wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: matchFake,
    });
    const payload = JSON.parse(readFileSync(join(s.matchesDir, '000.alpha.2025-8-28.txt.json'), 'utf8'));
    expect(payload).toHaveProperty('filename');
    expect(payload).toHaveProperty('contentHash');
    expect(payload).toHaveProperty('claimsContentHash');
    expect(payload).toHaveProperty('stats');
    expect(payload).toHaveProperty('matches');
    expect(payload.stats).toHaveProperty('totalClaims');
    expect(payload.stats).toHaveProperty('standaloneNew');
    expect(payload.stats).toHaveProperty('pagesLoaded');
  } finally { teardown(s.root); }
});

test('--all skips transcripts whose stages.matched is already set', async () => {
  const s = setup();
  try {
    await segmentAndExtract(s);

    // Pre-mark alpha as matched.
    let l = await readLedger(s.ledgerPath);
    l = markStage(l, '000.alpha.2025-8-28.txt', 'matched', '2026-01-01T00:00:00Z');
    await writeLedger(s.ledgerPath, l);

    let callCount = 0;
    const countingFake: typeof complete = (async (args: any) => {
      if (args.stage.startsWith('match-')) callCount++;
      return matchFake(args);
    }) as never;

    await match(undefined, { all: true }, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir, contentDir: s.contentDir,
      wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: countingFake,
    });

    // Only beta should be matched; alpha was pre-marked.
    expect(existsSync(join(s.matchesDir, '101.beta.2026-1-1.txt.json'))).toBe(true);
    expect(existsSync(join(s.matchesDir, '000.alpha.2025-8-28.txt.json'))).toBe(false);
  } finally { teardown(s.root); }
});

test('--all skips transcripts whose stages.resolved is null', async () => {
  const s = setup();
  try {
    // Segment both, but only extract+resolve beta.
    await segment(undefined, { all: true }, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      segmentsDir: s.segmentsDir, model: 'fake', completeFn: segmentFake,
    });
    await extract('beta', {}, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      segmentsDir: s.segmentsDir, claimsDir: s.claimsDir, model: 'fake', completeFn: extractFake,
    });
    // Create resolutions only for beta.
    await createResolutionsFromClaims(s.claimsDir, s.resolutionsDir, s.ledgerPath, '101.beta.2026-1-1.txt');

    let callCount = 0;
    const countingFake: typeof complete = (async (args: any) => {
      if (args.stage.startsWith('match-')) callCount++;
      return matchFake(args);
    }) as never;

    await match(undefined, { all: true }, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir, contentDir: s.contentDir,
      wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: countingFake,
    });

    // Only beta was resolved, so only beta should be matched.
    expect(existsSync(join(s.matchesDir, '101.beta.2026-1-1.txt.json'))).toBe(true);
    expect(existsSync(join(s.matchesDir, '000.alpha.2025-8-28.txt.json'))).toBe(false);
  } finally { teardown(s.root); }
});

test('--all continues past a single-transcript failure, records error, exits non-zero', async () => {
  const s = setup();
  try {
    await segmentAndExtract(s);

    let n = 0;
    const failFirstFake: typeof complete = (async (args: any) => {
      if (args.stage.startsWith('match-')) {
        n++;
        if (n === 1) throw new Error('synthetic match failure');
      }
      return matchFake(args);
    }) as never;

    let threw = false;
    try {
      await match(undefined, { all: true }, {
        transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
        resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir, contentDir: s.contentDir,
        wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: failFirstFake,
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const l = await readLedger(s.ledgerPath);
    const alpha = l.entries.find((e) => e.filename === '000.alpha.2025-8-28.txt')!;
    const beta  = l.entries.find((e) => e.filename === '101.beta.2026-1-1.txt')!;
    const oneMatched = (alpha.stages.matched !== null) !== (beta.stages.matched !== null);
    expect(oneMatched).toBe(true);
    const oneErrored =
      alpha.errors.some((e) => e.stage === 'matched') ||
      beta.errors.some((e) => e.stage === 'matched');
    expect(oneErrored).toBe(true);
  } finally { teardown(s.root); }
});

test('stale resolution detection: resolutions contentHash mismatch → error', async () => {
  const s = setup();
  try {
    await segmentAndExtract(s);

    // Tamper with resolutions file to have a different contentHash.
    const resPath = join(s.resolutionsDir, '000.alpha.2025-8-28.txt.json');
    const res = JSON.parse(readFileSync(resPath, 'utf8'));
    res.contentHash = 'tampered-hash';
    writeFileSync(resPath, JSON.stringify(res, null, 2));

    let threw = false;
    try {
      await match('alpha', {}, {
        transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
        resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir, contentDir: s.contentDir,
        wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: matchFake,
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('transcript changed since resolution');
    }
    expect(threw).toBe(true);
  } finally { teardown(s.root); }
});

test('missing resolutions file → throws with helpful message', async () => {
  const s = setup();
  try {
    // Manually mark resolved without creating the file on disk.
    await segment(undefined, { all: true }, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      segmentsDir: s.segmentsDir, model: 'fake', completeFn: segmentFake,
    });
    let l = await readLedger(s.ledgerPath);
    l = markStage(l, '000.alpha.2025-8-28.txt', 'resolved', '2026-01-01T00:00:00Z');
    await writeLedger(s.ledgerPath, l);

    let threw = false;
    try {
      await match('alpha', {}, {
        transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
        resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir, contentDir: s.contentDir,
        wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: matchFake,
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('resolutions file missing');
    }
    expect(threw).toBe(true);
  } finally { teardown(s.root); }
});

test('output JSON has one entry per claim with correct structure', async () => {
  const s = setup({ '000.alpha.2025-8-28.txt': makeTranscriptText(60) });
  try {
    await segmentAndExtract(s);
    await match('alpha', {}, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir, contentDir: s.contentDir,
      wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: matchFake,
    });

    const payload = JSON.parse(readFileSync(join(s.matchesDir, '000.alpha.2025-8-28.txt.json'), 'utf8'));
    const claimsData = JSON.parse(readFileSync(join(s.claimsDir, '000.alpha.2025-8-28.txt.json'), 'utf8'));
    expect(payload.matches.length).toBe(claimsData.claims.length);

    for (const m of payload.matches) {
      expect(m).toHaveProperty('claim');
      expect(m).toHaveProperty('candidatePages');
      expect(Array.isArray(m.candidatePages)).toBe(true);
      expect(m.candidatePages.length).toBeGreaterThan(0);
    }
  } finally { teardown(s.root); }
});

test('running twice with deterministic fake produces byte-identical output', async () => {
  const s = setup({ '000.alpha.2025-8-28.txt': makeTranscriptText(60) });
  try {
    await segmentAndExtract(s);
    const matchOpts = {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir, contentDir: s.contentDir,
      wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: matchFake,
    };

    await match('alpha', {}, matchOpts);
    const outPath = join(s.matchesDir, '000.alpha.2025-8-28.txt.json');
    const first = readFileSync(outPath, 'utf8');

    // Reset stages.matched so a second run is allowed.
    let l = await readLedger(s.ledgerPath);
    l = { entries: l.entries.map((e) => ({ ...e, stages: { ...e.stages, matched: null } })) };
    await writeLedger(s.ledgerPath, l);

    await match('alpha', {}, matchOpts);
    const second = readFileSync(outPath, 'utf8');
    expect(second).toBe(first);
  } finally { teardown(s.root); }
});

test('debug files are written per page in _debug/<filename>/<slug>.json', async () => {
  const s = setup({ '000.alpha.2025-8-28.txt': makeTranscriptText(60) });
  try {
    await segmentAndExtract(s);
    await match('alpha', {}, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      resolutionsDir: s.resolutionsDir, matchesDir: s.matchesDir, contentDir: s.contentDir,
      wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: matchFake,
    });

    const debugDir = join(s.matchesDir, '_debug', '000.alpha.2025-8-28.txt');
    expect(existsSync(debugDir)).toBe(true);
    const debugFiles = readdirSync(debugDir);
    expect(debugFiles.length).toBeGreaterThan(0);
    for (const f of debugFiles) {
      const d = JSON.parse(readFileSync(join(debugDir, f), 'utf8'));
      expect(d).toHaveProperty('pagePath');
      expect(d).toHaveProperty('claimIndices');
      expect(d).toHaveProperty('rawResults');
      expect(d).toHaveProperty('classifiedResults');
    }
  } finally { teardown(s.root); }
});
