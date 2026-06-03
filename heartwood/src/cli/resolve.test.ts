import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from './resolve';
import { segment } from './segment';
import { extract } from './extract';
import { readLedger, markStage, writeLedger } from '../transcript/ledger';
import type { complete } from '../llm';

// ---- Helpers ----

function makeWikiIndex(): object {
  return {
    generatedAt: '2026-01-01T00:00:00Z',
    pageCount: 1,
    unresolvedLinks: [],
    pages: {
      'Org/Foo/index': {
        path: 'Org/Foo/index',
        title: 'Foo',
        aliases: [],
        tags: [],
        img: null,
        headings: [],
        wikilinks: [],
        contentHash: 'abc',
        byteLength: 50,
        summary: 'A foo org.',
        keyFacts: null,
        entities: null,
      },
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
    text: '', usage: {} as never,
    value: { segments: [{ startLine: start, endLine: end, label: 'ic', confidence: 'high', oneLineSummary: 'play' }] },
  };
}) as never;

const extractFake: typeof complete = (async (args: any) => {
  const m = (args.user as string).match(/lines (\d+)/);
  const startLine = Number(m?.[1] ?? 1);
  return {
    text: '', usage: {} as never,
    value: {
      claims: [{
        claim: `Fact about Foo from line ${startLine}`,
        lineStart: startLine,
        lineEnd: startLine + 1,
        speaker: 'Gamemaster',
        role: 'gm',
        confidence: 'stated',
        entities: ['Foo'],
      }],
    },
  };
}) as never;

// Resolve fake: confirms nothing (no-op resolution).
const resolveFake: typeof complete = (async (args: any) => {
  if (args.stage === 'resolve') {
    return { text: '', usage: {} as never, value: { confirmations: [] } };
  }
  return segmentFake(args);
}) as never;

const allFake: typeof complete = (async (args: any) => {
  if (args.stage === 'segment') return segmentFake(args);
  if (args.stage === 'extract') return extractFake(args);
  if (args.stage === 'filter-worthiness') return { text: '', usage: {} as never, value: { keep: true } };
  return resolveFake(args);
}) as never;

interface Setup {
  root:            string;
  transcriptsDir:  string;
  ledgerPath:      string;
  segmentsDir:     string;
  claimsDir:       string;
  resolutionsDir:  string;
  wikiIndexPath:   string;
}

function setup(transcripts: Record<string, string> = {}): Setup {
  const root            = mkdtempSync(join(tmpdir(), 'resolve-cli-'));
  const transcriptsDir  = join(root, 'transcripts');
  const segmentsDir     = join(root, 'segments');
  const claimsDir       = join(root, 'claims');
  const resolutionsDir  = join(root, 'resolutions');
  const wikiIndexPath   = join(root, 'wiki-index.json');
  mkdirSync(transcriptsDir);
  mkdirSync(segmentsDir);
  mkdirSync(claimsDir);
  mkdirSync(resolutionsDir);

  writeFileSync(wikiIndexPath, JSON.stringify(makeWikiIndex(), null, 2));

  if (Object.keys(transcripts).length === 0) {
    writeFileSync(join(transcriptsDir, '000.alpha.2025-8-28.txt'), makeTranscriptText(60));
    writeFileSync(join(transcriptsDir, '101.beta.2026-1-1.txt'),   makeTranscriptText(50));
  } else {
    for (const [name, text] of Object.entries(transcripts)) {
      writeFileSync(join(transcriptsDir, name), text);
    }
  }
  return { root, transcriptsDir, ledgerPath: join(root, 'processed.json'), segmentsDir, claimsDir, resolutionsDir, wikiIndexPath };
}

function teardown(root: string) {
  rmSync(root, { recursive: true, force: true });
}

async function segmentAndExtract(s: Setup): Promise<void> {
  const base = { transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath, model: 'fake' };
  await segment(undefined, { all: true }, { ...base, segmentsDir: s.segmentsDir, completeFn: segmentFake });
  await extract(undefined, { all: true }, { ...base, segmentsDir: s.segmentsDir, claimsDir: s.claimsDir, completeFn: extractFake });
}

// ---- Tests ----

test('single-transcript run writes resolutions JSON and sets stages.resolved', async () => {
  const s = setup();
  try {
    await segmentAndExtract(s);
    await resolve('alpha', {}, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      claimsDir: s.claimsDir, resolutionsDir: s.resolutionsDir,
      wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: resolveFake,
    });

    const outPath = join(s.resolutionsDir, '000.alpha.2025-8-28.txt.json');
    expect(existsSync(outPath)).toBe(true);
    const payload = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(payload.filename).toBe('000.alpha.2025-8-28.txt');
    expect(Array.isArray(payload.claims)).toBe(true);
    expect(payload.claims.length).toBeGreaterThan(0);
    expect(Array.isArray(payload.aliasSuggestions)).toBe(true);

    const l = await readLedger(s.ledgerPath);
    const e = l.entries.find((x) => x.filename === '000.alpha.2025-8-28.txt')!;
    expect(e.stages.resolved).not.toBeNull();
  } finally { teardown(s.root); }
});

test('output JSON has all expected top-level keys', async () => {
  const s = setup();
  try {
    await segmentAndExtract(s);
    await resolve('alpha', {}, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      claimsDir: s.claimsDir, resolutionsDir: s.resolutionsDir,
      wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: resolveFake,
    });
    const payload = JSON.parse(readFileSync(join(s.resolutionsDir, '000.alpha.2025-8-28.txt.json'), 'utf8'));
    expect(payload).toHaveProperty('filename');
    expect(payload).toHaveProperty('contentHash');
    expect(payload).toHaveProperty('claimsContentHash');
    expect(payload).toHaveProperty('resolvedCount');
    expect(payload).toHaveProperty('suggestionCount');
    expect(payload).toHaveProperty('aliasSuggestions');
    expect(payload).toHaveProperty('claims');
  } finally { teardown(s.root); }
});

test('each claim in output has entityResolutions array', async () => {
  const s = setup();
  try {
    await segmentAndExtract(s);
    await resolve('alpha', {}, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      claimsDir: s.claimsDir, resolutionsDir: s.resolutionsDir,
      wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: resolveFake,
    });
    const payload = JSON.parse(readFileSync(join(s.resolutionsDir, '000.alpha.2025-8-28.txt.json'), 'utf8'));
    for (const claim of payload.claims) {
      expect(Array.isArray(claim.entityResolutions)).toBe(true);
    }
  } finally { teardown(s.root); }
});

test('--all resolves all extracted transcripts that lack stages.resolved', async () => {
  const s = setup();
  try {
    await segmentAndExtract(s);
    await resolve(undefined, { all: true }, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      claimsDir: s.claimsDir, resolutionsDir: s.resolutionsDir,
      wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: resolveFake,
    });

    expect(existsSync(join(s.resolutionsDir, '000.alpha.2025-8-28.txt.json'))).toBe(true);
    expect(existsSync(join(s.resolutionsDir, '101.beta.2026-1-1.txt.json'))).toBe(true);

    const l = await readLedger(s.ledgerPath);
    for (const e of l.entries) {
      if (e.stages.extracted !== null) {
        expect(e.stages.resolved).not.toBeNull();
      }
    }
  } finally { teardown(s.root); }
});

test('--all skips transcripts whose stages.resolved is already set', async () => {
  const s = setup();
  try {
    await segmentAndExtract(s);

    // Pre-mark alpha as resolved.
    let l = await readLedger(s.ledgerPath);
    l = markStage(l, '000.alpha.2025-8-28.txt', 'resolved', '2026-01-01T00:00:00Z');
    await writeLedger(s.ledgerPath, l);

    let callCount = 0;
    const countingFake: typeof complete = (async (args: any) => {
      if (args.stage === 'resolve') callCount++;
      return resolveFake(args);
    }) as never;

    await resolve(undefined, { all: true }, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      claimsDir: s.claimsDir, resolutionsDir: s.resolutionsDir,
      wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: countingFake,
    });

    // Only beta should have been resolved (no LLM calls for alpha).
    expect(existsSync(join(s.resolutionsDir, '101.beta.2026-1-1.txt.json'))).toBe(true);
    expect(existsSync(join(s.resolutionsDir, '000.alpha.2025-8-28.txt.json'))).toBe(false);
  } finally { teardown(s.root); }
});

test('--all skips transcripts whose stages.extracted is null', async () => {
  const s = setup();
  try {
    // Only segment alpha (not extract).
    await segment(undefined, { all: true }, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      segmentsDir: s.segmentsDir, model: 'fake', completeFn: segmentFake,
    });
    // Only extract beta.
    await extract('beta', {}, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      segmentsDir: s.segmentsDir, claimsDir: s.claimsDir, model: 'fake', completeFn: extractFake,
    });

    await resolve(undefined, { all: true }, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      claimsDir: s.claimsDir, resolutionsDir: s.resolutionsDir,
      wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: resolveFake,
    });

    expect(existsSync(join(s.resolutionsDir, '101.beta.2026-1-1.txt.json'))).toBe(true);
    expect(existsSync(join(s.resolutionsDir, '000.alpha.2025-8-28.txt.json'))).toBe(false);
  } finally { teardown(s.root); }
});

test('not-extracted transcript → error with helpful message', async () => {
  const s = setup();
  try {
    // Segment but manually mark as extracted without creating claims file.
    await segment(undefined, { all: true }, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      segmentsDir: s.segmentsDir, model: 'fake', completeFn: segmentFake,
    });
    let l = await readLedger(s.ledgerPath);
    l = markStage(l, '000.alpha.2025-8-28.txt', 'extracted', '2026-01-01T00:00:00Z');
    await writeLedger(s.ledgerPath, l);

    let threw = false;
    try {
      await resolve('alpha', {}, {
        transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
        claimsDir: s.claimsDir, resolutionsDir: s.resolutionsDir,
        wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: resolveFake,
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('claims file missing');
    }
    expect(threw).toBe(true);
  } finally { teardown(s.root); }
});

test('stale claims detection: contentHash mismatch → error', async () => {
  const s = setup();
  try {
    await segmentAndExtract(s);

    // Tamper with claims file contentHash.
    const claimsPath = join(s.claimsDir, '000.alpha.2025-8-28.txt.json');
    const claims = JSON.parse(readFileSync(claimsPath, 'utf8'));
    claims.contentHash = 'tampered';
    writeFileSync(claimsPath, JSON.stringify(claims, null, 2));

    let threw = false;
    try {
      await resolve('alpha', {}, {
        transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
        claimsDir: s.claimsDir, resolutionsDir: s.resolutionsDir,
        wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: resolveFake,
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('transcript changed since extraction');
    }
    expect(threw).toBe(true);
  } finally { teardown(s.root); }
});

test('--all continues past single failure and exits with error', async () => {
  const s = setup();
  try {
    await segmentAndExtract(s);

    // Tamper alpha's claims contentHash to trigger a failure without needing an LLM call.
    const claimsPath = join(s.claimsDir, '000.alpha.2025-8-28.txt.json');
    const claims = JSON.parse(readFileSync(claimsPath, 'utf8'));
    claims.contentHash = 'tampered-to-cause-failure';
    writeFileSync(claimsPath, JSON.stringify(claims, null, 2));

    let threw = false;
    try {
      await resolve(undefined, { all: true }, {
        transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
        claimsDir: s.claimsDir, resolutionsDir: s.resolutionsDir,
        wikiIndexPath: s.wikiIndexPath, model: 'fake', completeFn: resolveFake,
      });
    } catch { threw = true; }
    expect(threw).toBe(true);

    const l = await readLedger(s.ledgerPath);
    const alpha = l.entries.find((e) => e.filename === '000.alpha.2025-8-28.txt')!;
    const beta  = l.entries.find((e) => e.filename === '101.beta.2026-1-1.txt')!;
    // One resolved, one errored.
    const oneResolved = (alpha.stages.resolved !== null) !== (beta.stages.resolved !== null);
    expect(oneResolved).toBe(true);
    const oneErrored =
      alpha.errors.some((e) => e.stage === 'resolved') ||
      beta.errors.some((e) => e.stage === 'resolved');
    expect(oneErrored).toBe(true);
  } finally { teardown(s.root); }
});
