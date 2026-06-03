import { test, expect } from 'bun:test';
import {
  normalizeWindow,
  stitchSegments,
  segmentWindow,
  segmentTranscript,
  type RawSegment,
  type WindowOutput,
} from './segment';
import type { Window } from './chunk';

function w(index: number, startLine: number, endLine: number): Window {
  return { index, startLine, endLine, text: '<unused-in-tests>' };
}

function seg(
  startLine: number,
  endLine: number,
  label: RawSegment['label'] = 'ic',
  confidence: RawSegment['confidence'] = 'high',
  oneLineSummary = 'x',
): RawSegment {
  return { startLine, endLine, label, confidence, oneLineSummary };
}

// Suppress the deliberate warn output in normalizeWindow tests.
function quiet<T>(fn: () => T): T {
  const orig = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = orig; }
}

// ---- normalizeWindow ----

test('normalizeWindow passes through already-contiguous output', () => {
  const out = normalizeWindow(
    [seg(1, 10, 'ooc'), seg(11, 20, 'ic')],
    w(0, 1, 20),
  );
  expect(out).toEqual([
    seg(1, 10, 'ooc'),
    seg(11, 20, 'ic'),
  ]);
});

test('normalizeWindow snap-fills internal gaps by extending the prior segment', () => {
  const out = quiet(() => normalizeWindow(
    [seg(1, 5, 'ooc'), seg(10, 20, 'ic')],
    w(0, 1, 20),
  ));
  expect(out[0]!.endLine).toBe(9);
  expect(out[1]!.startLine).toBe(10);
  expect(out[1]!.endLine).toBe(20);
});

test('normalizeWindow stretches the first segment back to window.startLine', () => {
  const out = quiet(() => normalizeWindow(
    [seg(3, 10, 'ic'), seg(11, 20, 'ic')],
    w(0, 1, 20),
  ));
  expect(out[0]!.startLine).toBe(1);
});

test('normalizeWindow stretches the last segment forward to window.endLine', () => {
  const out = quiet(() => normalizeWindow(
    [seg(1, 10, 'ic'), seg(11, 18, 'ooc')],
    w(0, 1, 20),
  ));
  expect(out[out.length - 1]!.endLine).toBe(20);
});

test('normalizeWindow truncates overlapping starts to make output non-overlapping', () => {
  const out = quiet(() => normalizeWindow(
    [seg(1, 10, 'ic'), seg(5, 20, 'ooc')],
    w(0, 1, 20),
  ));
  expect(out).toHaveLength(2);
  expect(out[0]!.endLine).toBe(10);
  expect(out[1]!.startLine).toBe(11);
  expect(out[1]!.endLine).toBe(20);
});

test('normalizeWindow drops a segment fully subsumed by the previous one', () => {
  const out = quiet(() => normalizeWindow(
    [seg(1, 20, 'ic'), seg(5, 10, 'ooc'), seg(21, 25, 'rules')],
    w(0, 1, 25),
  ));
  expect(out.map((s) => [s.startLine, s.endLine, s.label])).toEqual([
    [1, 20, 'ic'],
    [21, 25, 'rules'],
  ]);
});

test('normalizeWindow clamps segments that overshoot the window bounds', () => {
  const out = quiet(() => normalizeWindow(
    [seg(0, 25, 'ic')],
    w(0, 1, 20),
  ));
  expect(out).toEqual([seg(1, 20, 'ic')]);
});

test('normalizeWindow throws when no usable segments remain after clamping', () => {
  expect(() => normalizeWindow(
    [seg(100, 200, 'ic')],
    w(0, 1, 20),
  )).toThrow(/no usable segments/);
});

// ---- stitchSegments ----

test('stitchSegments passes a single-window run through with merge', () => {
  const windowA = w(0, 1, 10);
  const out: WindowOutput = {
    window: windowA,
    segments: [seg(1, 4, 'ooc'), seg(5, 10, 'ic')],
  };
  expect(stitchSegments([out], 10)).toEqual([
    seg(1, 4, 'ooc'),
    seg(5, 10, 'ic'),
  ]);
});

test('stitchSegments resolves overlap by center-of-window proximity', () => {
  // A center=5.5, B center=10.5; overlap is lines 6-10. Line 8 ties → lower index wins.
  const A = w(0,  1, 10);
  const B = w(1,  6, 15);
  const outs: WindowOutput[] = [
    { window: A, segments: [seg(1, 10, 'ic', 'high', 'A')] },
    { window: B, segments: [seg(6, 15, 'ooc', 'high', 'B')] },
  ];
  const stitched = stitchSegments(outs, 15);
  expect(stitched).toEqual([
    seg(1, 8, 'ic', 'high', 'A'),
    seg(9, 15, 'ooc', 'high', 'B'),
  ]);
});

test('stitchSegments picks high-confidence over low regardless of center', () => {
  const A = w(0,  1, 10);        // center 5.5 — would win center tie
  const B = w(1,  6, 15);        // center 10.5
  const outs: WindowOutput[] = [
    { window: A, segments: [seg(1, 10, 'ic',  'low',  'A')] },
    { window: B, segments: [seg(6, 15, 'ooc', 'high', 'B')] },
  ];
  // Lines 6-10 overlap: B (ooc, high) wins. Lines 1-5: only A (ic, low).
  const stitched = stitchSegments(outs, 15);
  expect(stitched).toEqual([
    seg(1, 5,  'ic',  'low',  'A'),
    seg(6, 15, 'ooc', 'high', 'B'),
  ]);
});

test('stitchSegments lower-index window breaks an exact center-distance tie', () => {
  // A center=5.5, B center=10.5. Line 8 has distance 2.5 to both centers.
  const A = w(0, 1, 10);
  const B = w(1, 6, 15);
  const outs: WindowOutput[] = [
    { window: A, segments: [seg(8, 8, 'ic',  'low', 'A')] },
    { window: B, segments: [seg(8, 8, 'ooc', 'low', 'B')] },
  ];
  // Only line 8 is being stitched. Need to extend with adjacent lines for total coverage:
  outs[0]!.segments.unshift(seg(1, 7, 'ic', 'high', 'pre'));
  outs[1]!.segments.push(seg(9, 15, 'ooc', 'high', 'post'));
  const stitched = stitchSegments(outs, 15);
  // Line 8: tie → lower index (A) wins → 'ic', 'low', 'A'.
  // A segment "ic high pre" 1-7, then "ic low A" 8-8 (different summary breaks merge),
  // then "ooc high post" 9-15.
  expect(stitched).toEqual([
    seg(1, 7,  'ic',  'high', 'pre'),
    seg(8, 8,  'ic',  'low',  'A'),
    seg(9, 15, 'ooc', 'high', 'post'),
  ]);
});

test('stitchSegments merges adjacent lines sharing label+confidence+summary', () => {
  const A = w(0, 1, 10);
  // Two segments in the same window with the same triple should merge.
  const outs: WindowOutput[] = [{
    window: A,
    segments: [seg(1, 5, 'ic', 'high', 'fight'), seg(6, 10, 'ic', 'high', 'fight')],
  }];
  expect(stitchSegments(outs, 10)).toEqual([seg(1, 10, 'ic', 'high', 'fight')]);
});

test('stitchSegments does NOT merge same-label segments with different summaries', () => {
  const A = w(0, 1, 10);
  const outs: WindowOutput[] = [{
    window: A,
    segments: [seg(1, 5, 'ic', 'high', 'door'), seg(6, 10, 'ic', 'high', 'room')],
  }];
  expect(stitchSegments(outs, 10)).toEqual([
    seg(1, 5,  'ic', 'high', 'door'),
    seg(6, 10, 'ic', 'high', 'room'),
  ]);
});

test('stitchSegments throws when a line has no segment coverage', () => {
  const A = w(0, 1, 5);
  // Window only covers 1-5; totalLines=10 → lines 6-10 are uncovered.
  const outs: WindowOutput[] = [{
    window: A,
    segments: [seg(1, 5, 'ic')],
  }];
  expect(() => stitchSegments(outs, 10)).toThrow(/no segment coverage/);
});

// ---- segmentWindow ----

test('segmentWindow truncates oversized oneLineSummary instead of failing schema parse', async () => {
  const long = 'x'.repeat(500);
  const fake = async (args: any) => {
    // Run the schema (the real complete() does this); emulate that here so we
    // exercise the cap() transform rather than bypassing it.
    const value = args.schema.parse({
      segments: [{ startLine: 1, endLine: 10, label: 'ic', confidence: 'high', oneLineSummary: long }],
    });
    return { text: '', usage: {} as never, value };
  };
  const origWarn = console.warn;
  console.warn = () => {};
  let out;
  try {
    out = await segmentWindow(w(0, 1, 10), {
      model: 'fake', transcript: 't.txt', completeFn: fake as never,
    });
  } finally {
    console.warn = origWarn;
  }
  expect(out[0]!.oneLineSummary.length).toBe(200);
  expect(out[0]!.oneLineSummary.endsWith('…')).toBe(true);
});

test('segmentWindow passes stage, transcript filename, and cached prompt to complete', async () => {
  let captured: any = null;
  const fake = async (args: any) => {
    captured = args;
    return {
      text: '',
      usage: {} as never,
      value: { segments: [seg(1, 10, 'ic', 'high', 'fight')] },
    };
  };
  const win = w(0, 1, 10);
  await segmentWindow(win, {
    model: 'claude-haiku-4-5-20251001',
    transcript: 'foo.txt',
    completeFn: fake as never,
  });
  expect(captured.stage).toBe('segment');
  expect(captured.transcript).toBe('foo.txt');
  expect(captured.model).toBe('claude-haiku-4-5-20251001');
  expect(typeof captured.cached).toBe('string');
  expect(captured.cached).toContain('segmenting');  // sanity check rubric is there
  expect(captured.schema).toBeDefined();
});

// ---- segmentTranscript end-to-end with fakes ----

function makeTranscriptLines(n: number): string {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) out.push(`${String(i).padStart(6, '0')}\tS: line ${i}`);
  return out.join('\n');
}

test('segmentTranscript stitches multiple windows into full coverage', async () => {
  // 60 lines, windowLines=40, overlapLines=10 → windows [1-40], [31-60].
  const text = makeTranscriptLines(60);
  const fake = async (args: any) => {
    const user: string = args.user;
    // Identify which window by the "Window covers lines X-Y." header.
    const m = user.match(/Window covers lines (\d+)-(\d+)\./);
    if (!m) throw new Error('fake: no window header');
    const start = Number(m[1]);
    const end   = Number(m[2]);
    // Each window emits a single segment covering its entire range, with the
    // same triple so stitching merges everything into one final segment.
    return {
      text: '',
      usage: {} as never,
      value: { segments: [seg(start, end, 'ic', 'high', 'play')] },
    };
  };
  const result = await segmentTranscript(text, {
    model: 'm', transcript: 't.txt',
    windowLines: 40, overlapLines: 10,
    completeFn: fake as never,
  });
  expect(result.totalLines).toBe(60);
  expect(result.windowCount).toBe(2);
  expect(result.segments).toEqual([seg(1, 60, 'ic', 'high', 'play')]);
});

test('segmentTranscript produces gap-free, non-overlapping coverage when windows disagree', async () => {
  // 60 lines, windowLines=40, overlapLines=10 → windows [1-40], [31-60].
  const text = makeTranscriptLines(60);
  const fake = async (args: any) => {
    const user: string = args.user;
    const m = user.match(/Window covers lines (\d+)-(\d+)\./);
    const start = Number(m![1]);
    const end   = Number(m![2]);
    // Window A (1-40): ic high "play"
    // Window B (31-60): ooc high "chatter"
    const label = start === 1 ? 'ic' : 'ooc';
    const summary = start === 1 ? 'play' : 'chatter';
    return {
      text: '',
      usage: {} as never,
      value: { segments: [seg(start, end, label, 'high', summary)] },
    };
  };
  const result = await segmentTranscript(text, {
    model: 'm', transcript: 't.txt',
    windowLines: 40, overlapLines: 10,
    completeFn: fake as never,
  });
  // Sanity: coverage is gap-free and non-overlapping.
  expect(result.segments[0]!.startLine).toBe(1);
  expect(result.segments[result.segments.length - 1]!.endLine).toBe(60);
  for (let i = 1; i < result.segments.length; i++) {
    expect(result.segments[i]!.startLine).toBe(result.segments[i - 1]!.endLine + 1);
  }
});

test('segmentTranscript eliminates mixed segments via refinement pass', async () => {
  // 20 lines; first segmentWindow call returns a mixed segment covering the full range.
  // Refinement call returns ic — no mixed should survive.
  const text = makeTranscriptLines(20);
  let callCount = 0;
  const fake = async (args: any) => {
    callCount++;
    const m = args.user.match(/Window covers lines (\d+)-(\d+)\./);
    const start = Number(m![1]);
    const end   = Number(m![2]);
    if (callCount === 1) {
      // Initial pass: return mixed
      return { text: '', usage: {} as never, value: { segments: [seg(start, end, 'mixed', 'low', 'ambiguous')] } };
    }
    // Refinement pass: commit to ic
    return { text: '', usage: {} as never, value: { segments: [seg(start, end, 'ic', 'high', 'ic block')] } };
  };
  const result = await segmentTranscript(text, {
    model: 'm', transcript: 't.txt',
    windowLines: 40, overlapLines: 10,
    completeFn: fake as never,
  });
  expect(result.segments.every((s) => s.label !== 'mixed')).toBe(true);
  expect(result.refinedCount).toBe(1);
});

test('segmentTranscript returns zero refinedCount when no mixed segments', async () => {
  const text = makeTranscriptLines(20);
  const fake = async (args: any) => {
    const m = args.user.match(/Window covers lines (\d+)-(\d+)\./);
    const start = Number(m![1]); const end = Number(m![2]);
    return { text: '', usage: {} as never, value: { segments: [seg(start, end, 'ic', 'high', 'play')] } };
  };
  const result = await segmentTranscript(text, {
    model: 'm', transcript: 't.txt',
    windowLines: 40, overlapLines: 10,
    completeFn: fake as never,
  });
  expect(result.refinedCount).toBe(0);
});

test('segmentTranscript passes combat label through without refinement', async () => {
  const text = makeTranscriptLines(20);
  const fake = async (args: any) => {
    const m = args.user.match(/Window covers lines (\d+)-(\d+)\./);
    const start = Number(m![1]); const end = Number(m![2]);
    return { text: '', usage: {} as never, value: { segments: [seg(start, end, 'combat', 'high', 'initiative round')] } };
  };
  const result = await segmentTranscript(text, {
    model: 'm', transcript: 't.txt',
    windowLines: 40, overlapLines: 10,
    completeFn: fake as never,
  });
  expect(result.segments.some((s) => s.label === 'combat')).toBe(true);
  expect(result.segments.every((s) => s.label !== 'mixed')).toBe(true);
  expect(result.refinedCount).toBe(0);
});

test('segmentTranscript is deterministic — same fake yields identical output across runs', async () => {
  const text = makeTranscriptLines(60);
  const fake = async (args: any) => {
    const m = args.user.match(/Window covers lines (\d+)-(\d+)\./);
    const start = Number(m![1]); const end = Number(m![2]);
    const label = start === 1 ? 'ic' : 'ooc';
    return {
      text: '',
      usage: {} as never,
      value: { segments: [seg(start, end, label, 'high', label)] },
    };
  };
  const opts = {
    model: 'm', transcript: 't.txt',
    windowLines: 40, overlapLines: 10,
    completeFn: fake as never,
  };
  const a = await segmentTranscript(text, opts);
  const b = await segmentTranscript(text, opts);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});
