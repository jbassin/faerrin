import { test, expect } from 'bun:test';
import {
  buildExtractionUnits,
  extractUnit,
  extractTranscript,
  repairAndValidateClaim,
  type ExtractionUnit,
  type RawClaim,
} from './extract';
import type { Segment } from './segment';
import type { complete } from '../llm';

// ---- Helpers ----

function makeLines(n: number, speaker = 'Gamemaster'): string {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(`${String(i).padStart(6, '0')}\t${speaker}: line ${i}`);
  }
  return out.join('\n');
}

function makeMixedLines(n: number): string {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    const speaker = i % 2 === 0 ? 'Argyle' : 'Gamemaster';
    out.push(`${String(i).padStart(6, '0')}\t${speaker}: line ${i}`);
  }
  return out.join('\n');
}

function seg(
  startLine: number,
  endLine: number,
  label: Segment['label'] = 'ic',
): Segment {
  return { startLine, endLine, label, confidence: 'high', oneLineSummary: 'x' };
}

function unit(
  startLine: number,
  endLine: number,
  label: ExtractionUnit['label'] = 'ic',
  isFirst = true,
  overlapLines = 0,
  sourceSegmentStartLine = startLine,
): ExtractionUnit {
  return {
    sourceSegmentStartLine,
    label,
    startLine,
    endLine,
    text: '',
    isFirstWindowOfSegment: isFirst,
    overlapLines,
  };
}

// rawClaim: RawClaim-shaped object for repairAndValidateClaim tests (uses lines tuple).
function rawClaim(
  claim: string,
  lines: [number, number],
  speaker: string,
  role: 'gm' | 'player' = 'gm',
  confidence: RawClaim['confidence'] = 'stated',
): RawClaim {
  return { claim, lines, speaker, role, confidence, entities: [] };
}

// llmClaim: LLM-schema-shaped object for extractUnit/extractTranscript fakes (uses lineStart/lineEnd).
function llmClaim(
  claim: string,
  lineStart: number,
  lineEnd: number,
  speaker: string,
  role: 'gm' | 'player' = 'gm',
  confidence: RawClaim['confidence'] = 'stated',
) {
  return { claim, lineStart, lineEnd, speaker, role, confidence, entities: [] };
}

// ---- buildExtractionUnits ----

test('ooc segment produces no units', () => {
  const lines = makeLines(10).split('\n');
  const units = buildExtractionUnits(lines, [seg(1, 10, 'ooc')]);
  expect(units).toHaveLength(0);
});

test('rules segment produces no units', () => {
  const lines = makeLines(10).split('\n');
  const units = buildExtractionUnits(lines, [seg(1, 10, 'rules')]);
  expect(units).toHaveLength(0);
});

test('ic segment produces one unit for a short segment', () => {
  const lines = makeLines(10).split('\n');
  const units = buildExtractionUnits(lines, [seg(1, 10, 'ic')]);
  expect(units).toHaveLength(1);
  expect(units[0]).toMatchObject({
    startLine: 1,
    endLine: 10,
    label: 'ic',
    isFirstWindowOfSegment: true,
    overlapLines: 0,
    sourceSegmentStartLine: 1,
  });
});

test('recap segment is included', () => {
  const lines = makeLines(10).split('\n');
  const units = buildExtractionUnits(lines, [seg(1, 10, 'recap')]);
  expect(units).toHaveLength(1);
  expect(units[0]!.label).toBe('recap');
});

test('mixed segment is included', () => {
  const lines = makeLines(10).split('\n');
  const units = buildExtractionUnits(lines, [seg(1, 10, 'mixed')]);
  expect(units).toHaveLength(1);
  expect(units[0]!.label).toBe('mixed');
});

test('long ic segment is chunked into multiple units with correct absolute coords', () => {
  // 500-line ic segment starting at absolute line 100, window=400, overlap=40
  const fullLines = makeLines(599).split('\n');
  const units = buildExtractionUnits(fullLines, [seg(100, 599, 'ic')], {
    windowLines: 400,
    overlapLines: 40,
  });
  expect(units.length).toBeGreaterThan(1);
  // First unit starts at absolute 100
  expect(units[0]!.startLine).toBe(100);
  // Last unit ends at absolute 599
  expect(units[units.length - 1]!.endLine).toBe(599);
  // First window: isFirst=true, overlapLines=0
  expect(units[0]!.isFirstWindowOfSegment).toBe(true);
  expect(units[0]!.overlapLines).toBe(0);
  // Second window: isFirst=false, overlapLines=40
  expect(units[1]!.isFirstWindowOfSegment).toBe(false);
  expect(units[1]!.overlapLines).toBe(40);
  // All sourceSegmentStartLine = 100
  for (const u of units) expect(u.sourceSegmentStartLine).toBe(100);
});

test('two adjacent segments produce independent unit lists', () => {
  const lines = makeLines(20).split('\n');
  const units = buildExtractionUnits(lines, [seg(1, 10, 'ic'), seg(11, 20, 'recap')]);
  expect(units).toHaveLength(2);
  expect(units[0]!.sourceSegmentStartLine).toBe(1);
  expect(units[1]!.sourceSegmentStartLine).toBe(11);
  expect(units[0]!.endLine).toBe(10);
  expect(units[1]!.startLine).toBe(11);
});

test('combat segment produces no extraction units', () => {
  const lines = makeLines(10).split('\n');
  // 'combat' is not in EXTRACT_LABELS so buildExtractionUnits must skip it.
  const units = buildExtractionUnits(lines, [seg(1, 10, 'combat' as Segment['label'])]);
  expect(units).toHaveLength(0);
});

test('unit text starts at the correct absolute line prefix', () => {
  // Segment starts at absolute line 5, with a 10-line ic block.
  const fullLines = makeLines(14).split('\n');
  const units = buildExtractionUnits(fullLines, [seg(5, 14, 'ic')]);
  expect(units).toHaveLength(1);
  const firstTextLine = units[0]!.text.split('\n')[0]!;
  expect(firstTextLine.startsWith('000005')).toBe(true);
});

// ---- repairAndValidateClaim ----

test('repairAndValidateClaim passes through a valid claim', () => {
  const text = '000001\tGamemaster: hello\n000002\tGamemaster: world';
  const { parseSpeakers } = require('./speakers');
  const sl = parseSpeakers(text);
  const u = unit(1, 5);
  const r = rawClaim('Something happened', [1, 2], 'Gamemaster', 'gm');
  const result = repairAndValidateClaim(r, sl, u);
  expect(result.claim).not.toBeNull();
  expect(result.claim!.role).toBe('gm');
});

test('repairAndValidateClaim repairs role when LLM says player but Gamemaster is in range', () => {
  const text = '000001\tGamemaster: hello\n000002\tGamemaster: world';
  const { parseSpeakers } = require('./speakers');
  const sl = parseSpeakers(text);
  const u = unit(1, 5);
  const r = rawClaim('Fact', [1, 2], 'Gamemaster', 'player');
  const result = repairAndValidateClaim(r, sl, u);
  expect(result.claim).not.toBeNull();
  expect(result.claim!.role).toBe('gm');
  expect(result.repaired).toBe(true);
});

test('repairAndValidateClaim sets role=player when Gamemaster absent (recap segment)', () => {
  const text = '000001\tArgyle: hello\n000002\tArgyle: world';
  const { parseSpeakers } = require('./speakers');
  const sl = parseSpeakers(text);
  const u = unit(1, 5, 'recap');  // recap allows player claims
  const r = rawClaim('Fact', [1, 2], 'Argyle', 'gm');
  const result = repairAndValidateClaim(r, sl, u);
  expect(result.claim).not.toBeNull();
  expect(result.claim!.role).toBe('player');
  expect(result.repaired).toBe(true);
});

test('repairAndValidateClaim drops player claim from ic segment', () => {
  const text = '000001\tArgyle: hello\n000002\tArgyle: world';
  const { parseSpeakers } = require('./speakers');
  const sl = parseSpeakers(text);
  const u = unit(1, 5, 'ic');
  const r = rawClaim('Fact', [1, 2], 'Argyle', 'gm');
  const result = repairAndValidateClaim(r, sl, u);
  expect(result.claim).toBeNull();
  expect(result.dropReason).toContain('player claim in non-recap segment');
});

test('repairAndValidateClaim drops claim when named speaker not in cited lines', () => {
  const text = '000001\tGamemaster: hello\n000002\tArgyle: hi';
  const { parseSpeakers } = require('./speakers');
  const sl = parseSpeakers(text);
  const u = unit(1, 5);
  const r = rawClaim('Fact', [1, 2], 'Johnny', 'player');
  const result = repairAndValidateClaim(r, sl, u);
  expect(result.claim).toBeNull();
  expect(result.dropReason).toContain('speaker');
});

test('repairAndValidateClaim drops claim when lines span > 20', () => {
  const speakers = Array.from({ length: 22 }, (_, i) => ({
    line: i + 1, speaker: 'Gamemaster',
  }));
  const u = unit(1, 50);
  const r = rawClaim('Big fact', [1, 22], 'Gamemaster', 'gm');
  const result = repairAndValidateClaim(r, speakers, u);
  expect(result.claim).toBeNull();
  expect(result.dropReason).toContain('> 20');
});

test('repairAndValidateClaim drops claim whose lines are outside the unit', () => {
  const sl = [{ line: 300, speaker: 'Gamemaster' }];
  const u = unit(1, 50);
  const r = rawClaim('Fact', [200, 210], 'Gamemaster', 'gm');
  const result = repairAndValidateClaim(r, sl, u);
  expect(result.claim).toBeNull();
  expect(result.dropReason).toContain('outside unit');
});

test('repairAndValidateClaim clamps and repairs lines that partially overshoot unit (recap)', () => {
  const sl = [{ line: 48, speaker: 'Argyle' }];
  const u = unit(1, 50, 'recap');  // recap allows player claims
  const r = rawClaim('Fact', [48, 55], 'Argyle', 'player');
  const result = repairAndValidateClaim(r, sl, u);
  expect(result.claim).not.toBeNull();
  expect(result.claim!.lines[1]).toBe(50);
  expect(result.repaired).toBe(true);
});

test('repairAndValidateClaim carries sourceSegmentStartLine from unit', () => {
  const sl = [{ line: 10, speaker: 'Gamemaster' }];
  const u = unit(10, 20, 'ic', true, 0, 10);
  const r = rawClaim('Fact', [10, 11], 'Gamemaster', 'gm');
  const result = repairAndValidateClaim(r, sl, u);
  expect(result.claim!.sourceSegmentStartLine).toBe(10);
});

// ---- extractUnit ----

test('extractUnit passes stage, transcript, cached prompt, and schema to completeFn', async () => {
  let captured: any = null;
  const fake: typeof complete = (async (args: any) => {
    captured = args;
    return { text: '', usage: {} as never, value: { claims: [] } };
  }) as never;

  await extractUnit(unit(1, 10), {
    model: 'test-model',
    transcript: 'foo.txt',
    completeFn: fake,
  });

  expect(captured.stage).toBe('extract');
  expect(captured.transcript).toBe('foo.txt');
  expect(captured.model).toBe('test-model');
  expect(typeof captured.cached).toBe('string');
  expect(captured.cached).toContain('wiki-worthy factual claims');
  expect(captured.schema).toBeDefined();
});

test('extractUnit user message includes the correct line range', async () => {
  let capturedUser = '';
  const fake: typeof complete = (async (args: any) => {
    capturedUser = args.user;
    return { text: '', usage: {} as never, value: { claims: [] } };
  }) as never;

  await extractUnit(unit(100, 200, 'recap'), {
    model: 'm', transcript: 't.txt', completeFn: fake,
  });

  expect(capturedUser).toContain('100');
  expect(capturedUser).toContain('200');
  expect(capturedUser).toContain('RECAP');
});

test('extractUnit includes MIXED notice in user message for mixed segments', async () => {
  let capturedUser = '';
  const fake: typeof complete = (async (args: any) => {
    capturedUser = args.user;
    return { text: '', usage: {} as never, value: { claims: [] } };
  }) as never;

  await extractUnit(unit(1, 10, 'mixed'), {
    model: 'm', transcript: 't.txt', completeFn: fake,
  });

  expect(capturedUser).toContain('MIXED');
});

// ---- extractTranscript ----

function makeFakeComplete(claimsByUnit: Map<string, ReturnType<typeof llmClaim>[]>): typeof complete {
  return (async (args: any) => {
    // Key by the startLine in the user message
    const m = args.user.match(/lines (\d+)/);
    const key = m ? m[1] : 'unknown';
    const claims = claimsByUnit.get(key) ?? [];
    return { text: '', usage: {} as never, value: { claims } };
  }) as never;
}

test('extractTranscript skips ooc and rules segments', async () => {
  const text = makeLines(30);
  const segments: Segment[] = [
    seg(1, 10, 'ooc'),
    seg(11, 20, 'ic'),
    seg(21, 30, 'rules'),
  ];
  const claimsMap = new Map([
    ['11', [llmClaim('Fact from ic', 11, 12, 'Gamemaster', 'gm')]],
  ]);
  const result = await extractTranscript(text, segments, {
    model: 'm',
    transcript: 't.txt',
    completeFn: makeFakeComplete(claimsMap),
  });
  expect(result.unitCount).toBe(1);
  expect(result.claims).toHaveLength(1);
  expect(result.claims[0]!.claim).toBe('Fact from ic');
});

test('extractTranscript includes mixed segment and labels notice in user msg', async () => {
  const text = makeMixedLines(10);
  const segments: Segment[] = [seg(1, 10, 'mixed')];
  let capturedUser = '';
  const fake: typeof complete = (async (args: any) => {
    capturedUser = args.user;
    return { text: '', usage: {} as never, value: { claims: [] } };
  }) as never;

  await extractTranscript(text, segments, { model: 'm', transcript: 't.txt', completeFn: fake });
  expect(capturedUser).toContain('MIXED');
});

test('extractTranscript repairs role from line prefixes', async () => {
  // Transcript: all Gamemaster lines
  const text = makeLines(10, 'Gamemaster');
  const segments: Segment[] = [seg(1, 10, 'ic')];
  const claimsMap = new Map([
    ['1', [llmClaim('GM fact', 1, 2, 'Gamemaster', 'player')]],  // wrong role
  ]);
  const result = await extractTranscript(text, segments, {
    model: 'm',
    transcript: 't.txt',
    completeFn: makeFakeComplete(claimsMap),
  });
  expect(result.claims[0]!.role).toBe('gm');
  expect(result.repairedCount).toBe(1);
});

test('extractTranscript drops claims whose speaker is absent from cited lines', async () => {
  const text = makeLines(10, 'Gamemaster');
  const segments: Segment[] = [seg(1, 10, 'ic')];
  const claimsMap = new Map([
    ['1', [llmClaim('Mystery speaker', 1, 2, 'Zara', 'player')]],
  ]);
  const result = await extractTranscript(text, segments, {
    model: 'm',
    transcript: 't.txt',
    completeFn: makeFakeComplete(claimsMap),
  });
  expect(result.claims).toHaveLength(0);
  expect(result.droppedCount).toBe(1);
});

test('extractTranscript deduplicates overlap zone claims (keeps primary half only)', async () => {
  // 900-line IC segment (lines 1-900). windowLines=400, overlap=40.
  // Window 1: lines 1-400 (primary zone all of 1-400)
  // Window 2: lines 361-760 (overlap zone: 361-400, primary zone: 401-760)
  // A claim with lines[0]=370 from window 2 is in the overlap zone → dropped.
  const text = makeLines(900, 'Gamemaster');
  const segments: Segment[] = [seg(1, 900, 'ic')];

  // Claim at line 370: appears from window 2 (in overlap zone → drop)
  // Claim at line 1: from window 1 (primary → keep)
  // Claim at line 450: from window 2 (primary zone → keep)
  let callCount = 0;
  const fake: typeof complete = (async (args: any) => {
    callCount++;
    const m = args.user.match(/lines (\d+)/);
    const startLine = Number(m?.[1] ?? 0);
    if (startLine === 1) {
      // Window 1: primary zone claim at line 1
      return { text: '', usage: {} as never, value: { claims: [
        llmClaim('Fact at start', 1, 2, 'Gamemaster', 'gm'),
      ] } };
    } else if (startLine === 361) {
      // Window 2: overlap-zone claim at 370, primary-zone claim at 450
      return { text: '', usage: {} as never, value: { claims: [
        llmClaim('Overlap claim', 370, 371, 'Gamemaster', 'gm'),
        llmClaim('Primary claim', 450, 451, 'Gamemaster', 'gm'),
      ] } };
    }
    // Window 3+: no claims
    return { text: '', usage: {} as never, value: { claims: [] } };
  }) as never;

  const result = await extractTranscript(text, segments, {
    model: 'm', transcript: 't.txt',
    windowLines: 400, overlapLines: 40,
    completeFn: fake,
  });

  const claimTexts = result.claims.map((c) => c.claim);
  expect(claimTexts).toContain('Fact at start');
  expect(claimTexts).toContain('Primary claim');
  expect(claimTexts).not.toContain('Overlap claim');
});

test('extractTranscript drops claims with lines > 20', async () => {
  const text = makeLines(50, 'Gamemaster');
  const segments: Segment[] = [seg(1, 50, 'ic')];
  const claimsMap = new Map([
    ['1', [llmClaim('Long claim', 1, 25, 'Gamemaster', 'gm')]],
  ]);
  const result = await extractTranscript(text, segments, {
    model: 'm', transcript: 't.txt',
    completeFn: makeFakeComplete(claimsMap),
  });
  expect(result.claims).toHaveLength(0);
  expect(result.droppedCount).toBe(1);
});

test('extractTranscript returns empty claims for transcripts with no eligible segments', async () => {
  const text = makeLines(10, 'Gamemaster');
  const segments: Segment[] = [seg(1, 10, 'ooc')];
  const fake: typeof complete = (async () => {
    throw new Error('should not be called');
  }) as never;

  const result = await extractTranscript(text, segments, {
    model: 'm', transcript: 't.txt', completeFn: fake,
  });
  expect(result.claims).toHaveLength(0);
  expect(result.unitCount).toBe(0);
});

test('extractTranscript fires onChunkComplete callback for each unit', async () => {
  const text = makeLines(20, 'Gamemaster');
  const segments: Segment[] = [seg(1, 10, 'ic'), seg(11, 20, 'recap')];
  const callbacks: Array<{ unit: ExtractionUnit; rawCount: number; keptCount: number }> = [];

  const claimsMap = new Map([
    ['1', [llmClaim('Fact 1', 1, 2, 'Gamemaster', 'gm')]],
    ['11', [llmClaim('Fact 2', 11, 12, 'Gamemaster', 'gm')]],
  ]);
  await extractTranscript(text, segments, {
    model: 'm', transcript: 't.txt',
    completeFn: makeFakeComplete(claimsMap),
    onChunkComplete: (u, raw, kept) => {
      callbacks.push({ unit: u, rawCount: raw.length, keptCount: kept.length });
    },
  });

  expect(callbacks).toHaveLength(2);
  expect(callbacks[0]!.rawCount).toBe(1);
  expect(callbacks[0]!.keptCount).toBe(1);
});

test('extractTranscript sorts output by lines[0] ascending', async () => {
  const text = makeLines(30, 'Gamemaster');
  const segments: Segment[] = [seg(1, 15, 'ic'), seg(16, 30, 'recap')];
  const claimsMap = new Map([
    ['1', [
      llmClaim('Third', 10, 11, 'Gamemaster', 'gm'),
      llmClaim('First', 1, 2, 'Gamemaster', 'gm'),
    ]],
    ['16', [llmClaim('Second', 16, 17, 'Gamemaster', 'gm')]],
  ]);
  const result = await extractTranscript(text, segments, {
    model: 'm', transcript: 't.txt',
    completeFn: makeFakeComplete(claimsMap),
  });

  const starts = result.claims.map((c) => c.lines[0]);
  expect(starts).toEqual([1, 10, 16]);
});

test('extractTranscript drops player claims from ic segments (GM-only filter)', async () => {
  // makeMixedLines: even lines are Argyle, odd lines are Gamemaster.
  // Cite line 2 only (Argyle) so GM is absent → repairedRole=player → dropped from IC.
  // Cite line 1 only (Gamemaster) for the GM fact → kept.
  const text = makeMixedLines(10);
  const segments: Segment[] = [seg(1, 10, 'ic')];
  const claimsMap = new Map([
    ['1', [
      llmClaim('GM world fact', 1, 1, 'Gamemaster', 'gm'),
      llmClaim('Player speculation', 2, 2, 'Argyle', 'player'),
    ]],
  ]);
  const result = await extractTranscript(text, segments, {
    model: 'm', transcript: 't.txt',
    completeFn: makeFakeComplete(claimsMap),
  });
  expect(result.claims.map((c) => c.claim)).toContain('GM world fact');
  expect(result.claims.map((c) => c.claim)).not.toContain('Player speculation');
});

test('extractTranscript keeps player claims from recap segments', async () => {
  // In a RECAP segment, player lines recounting prior-session canon are allowed.
  // Use line 2 (Argyle only — no GM present) so repairedRole stays player.
  const text = makeMixedLines(10);
  const segments: Segment[] = [seg(1, 10, 'recap')];
  const claimsMap = new Map([
    ['1', [
      llmClaim('Player recap fact', 2, 2, 'Argyle', 'player'),
    ]],
  ]);
  const result = await extractTranscript(text, segments, {
    model: 'm', transcript: 't.txt',
    completeFn: makeFakeComplete(claimsMap),
  });
  expect(result.claims).toHaveLength(1);
  expect(result.claims[0]!.claim).toBe('Player recap fact');
  expect(result.claims[0]!.role).toBe('player');
});

test('extractTranscript is deterministic with the same fake', async () => {
  const text = makeLines(20, 'Gamemaster');
  const segments: Segment[] = [seg(1, 20, 'ic')];
  const claimsMap = new Map([
    ['1', [
      llmClaim('Fact A', 1, 2, 'Gamemaster', 'gm'),
      llmClaim('Fact B', 10, 11, 'Gamemaster', 'gm'),
    ]],
  ]);
  const opts = {
    model: 'm', transcript: 't.txt',
    completeFn: makeFakeComplete(claimsMap),
  };
  const a = await extractTranscript(text, segments, opts);
  const b = await extractTranscript(text, segments, opts);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});
