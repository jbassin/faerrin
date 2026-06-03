import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcriptsList, transcriptsStatus, transcriptsReset } from './transcripts';
import { readLedger, writeLedger, markStage } from '../transcript/ledger';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'transcripts-cli-'));
  const transcriptsDir = join(root, 'transcripts');
  const ledgerPath = join(root, 'processed.json');
  mkdirSync(transcriptsDir);
  writeFileSync(join(transcriptsDir, '000.alpha.2025-8-28.txt'), 'A');
  writeFileSync(join(transcriptsDir, '101.beta.2026-1-1.txt'),   'B');
  return { root, transcriptsDir, ledgerPath };
}

function teardown(root: string) {
  rmSync(root, { recursive: true, force: true });
}

test('list creates ledger on first run and persists entries', async () => {
  const { root, transcriptsDir, ledgerPath } = setup();
  try {
    await transcriptsList({ transcriptsDir, ledgerPath });
    const l = await readLedger(ledgerPath);
    expect(l.entries.length).toBe(2);
    expect(l.entries.map((e) => e.filename).sort()).toEqual([
      '000.alpha.2025-8-28.txt',
      '101.beta.2026-1-1.txt',
    ]);
  } finally { teardown(root); }
});

test('list is idempotent — second run does not rewrite when nothing changed', async () => {
  const { root, transcriptsDir, ledgerPath } = setup();
  try {
    await transcriptsList({ transcriptsDir, ledgerPath });
    const mtime1 = statSync(ledgerPath).mtimeMs;
    await new Promise((r) => setTimeout(r, 10));
    await transcriptsList({ transcriptsDir, ledgerPath });
    const mtime2 = statSync(ledgerPath).mtimeMs;
    expect(mtime2).toBe(mtime1);
  } finally { teardown(root); }
});

test('status prints by exact filename and by unique substring', async () => {
  const { root, transcriptsDir, ledgerPath } = setup();
  try {
    await transcriptsList({ transcriptsDir, ledgerPath });
    await transcriptsStatus('000.alpha.2025-8-28.txt', { transcriptsDir, ledgerPath });
    await transcriptsStatus('2025-8-28',               { transcriptsDir, ledgerPath });
  } finally { teardown(root); }
});

test('reset --stage X cascades downstream', async () => {
  const { root, transcriptsDir, ledgerPath } = setup();
  try {
    await transcriptsList({ transcriptsDir, ledgerPath });
    let l = await readLedger(ledgerPath);
    for (const s of ['segmented', 'extracted', 'resolved', 'matched', 'proposed', 'verified', 'prOpened'] as const) {
      l = markStage(l, '000.alpha.2025-8-28.txt', s);
    }
    await writeLedger(ledgerPath, l);

    await transcriptsReset('2025-8-28', { stage: 'matched' }, { transcriptsDir, ledgerPath });
    const after = await readLedger(ledgerPath);
    const e = after.entries.find((x) => x.filename === '000.alpha.2025-8-28.txt')!;
    expect(e.stages.segmented).not.toBeNull();
    expect(e.stages.extracted).not.toBeNull();
    expect(e.stages.resolved).not.toBeNull();  // upstream of matched — preserved
    expect(e.stages.matched).toBeNull();
    expect(e.stages.proposed).toBeNull();
    expect(e.stages.verified).toBeNull();
    expect(e.stages.prOpened).toBeNull();
  } finally { teardown(root); }
});

test('rehashed file (content change) clears stages on next list', async () => {
  const { root, transcriptsDir, ledgerPath } = setup();
  try {
    await transcriptsList({ transcriptsDir, ledgerPath });
    let l = await readLedger(ledgerPath);
    l = markStage(l, '000.alpha.2025-8-28.txt', 'segmented', '2026-01-01T00:00:00Z');
    await writeLedger(ledgerPath, l);

    writeFileSync(join(transcriptsDir, '000.alpha.2025-8-28.txt'), 'A-CHANGED');
    await transcriptsList({ transcriptsDir, ledgerPath });

    const after = await readLedger(ledgerPath);
    const e = after.entries.find((x) => x.filename === '000.alpha.2025-8-28.txt')!;
    expect(e.stages.segmented).toBeNull();
  } finally { teardown(root); }
});
