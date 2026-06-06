# 013: End-to-End Orchestrator — Implementation Plan

## Overview

Single command (`bun run process <transcript>` / `bun run process-all`) that runs all six pipeline stages (segment → extract → resolve → match → propose → submit) sequentially per transcript, skipping stages already recorded in the ledger. Supports `--dry-run`, `--force <stage>`, `--stop-before <stage>`, and `--concurrency N`. Writes a markdown run summary after `process-all`.

## Current State Analysis

The pipeline has six CLI commands registered in `src/cli/index.ts`, each following an identical pattern: reconcile ledger → filter targets → loop calling `*One` → write ledger. All handlers are independently invocable but there is no top-level orchestrator.

### Key Discoveries

- **`*One` functions write the ledger themselves** (`src/cli/segment.ts:128`): each `*One` function calls `writeLedger(ctx.ledgerPath, next)` after stamping `markStage`. The CLI handler also calls `writeLedger` on the error path. This means for concurrent execution, two simultaneous `*One` calls writing to `state/processed.json` can silently drop each other's updates (last full-file write wins).
- **`segmentOne` is not exported** (`src/cli/segment.ts:102`): all `*One` functions are module-private. The orchestrator needs to call them directly to avoid the per-handler reconcile overhead and to inject mutex-aware ledger writers.
- **`submitOne` is exported** from `src/gitlab/submit.ts:37` and writes the ledger in both success (line 108) and error (line 114) paths.
- **`cli/submit.ts` redundantly writes on error** (`src/cli/submit.ts:82-83`): it calls `recordError` + `writeLedger` after `submitOne` already did so internally. The double-write is harmless (same result both times) but will be cleaned up by the Phase 1 refactor.
- **`STAGE_ORDER`** in `src/transcript/ledger.ts:5`: `['segmented', 'extracted', 'resolved', 'matched', 'proposed', 'verified', 'prOpened']`. The `submit` CLI stage sets both `verified` and `prOpened` atomically. `--force submit` must reset from `verified` (not `prOpened`) to clear both.
- **`summarize` is async** (`src/log.ts:61`): the cost rollup must be awaited. `currentRunFile()` returns the path but the file may not exist if no LLM calls were made.
- **`writeLedger` uses atomic rename** (`src/transcript/ledger.ts:68-72`): safe for single-writer, but concurrent multi-process writes still lose data.
- **One live MR open** (transcript `000.through-a-song-darkly.2025-8-28.txt`): `prUrl` is set; 36 remaining transcripts have all stages null.

### Stage → Ledger Key Mapping

| CLI stage | First ledger key set | Reset key for `--force` | "Complete" check |
|---|---|---|---|
| `segment` | `segmented` | `segmented` | `stages.segmented !== null` |
| `extract` | `extracted` | `extracted` | `stages.extracted !== null` |
| `resolve` | `resolved` | `resolved` | `stages.resolved !== null` |
| `match` | `matched` | `matched` | `stages.matched !== null` |
| `propose` | `proposed` | `proposed` | `stages.proposed !== null` |
| `submit` | `verified` | `verified` | `stages.prOpened !== null` |

## Desired End State

- `bun run process <name> [--dry-run] [--force <stage>] [--stop-before <stage>]` — runs the full pipeline for one transcript, skipping completed stages
- `bun run process-all [--dry-run] [--stop-before <stage>] [--concurrency N]` — same for all unprocessed transcripts
- Crash recovery: re-running picks up where the ledger says the last completed stage was
- `state/runs/<timestamp>-summary.md` written after `process-all`

### Verification

```sh
# Single-transcript smoke test
bun run process 000 --dry-run

# Ledger checkpoint test: kill mid-run, re-run, observe only incomplete stages execute
bun run process-all --concurrency 1 &
kill %1
bun run process-all  # should resume, not re-run completed stages

# Force re-run from propose onward
bun run process 000 --force propose

# Stop before submit
bun run process-all --stop-before submit --dry-run
```

## What We're NOT Doing

- No GUI or web dashboard
- No retry logic on LLM failures — errors are recorded in the ledger and the transcript is skipped
- No `--force` with `process-all` (single-transcript only, by design to prevent accidental mass resets)
- No per-stage parallelism — stages within a transcript are always sequential
- No changes to individual stage CLI commands (segment, extract, etc.) — they continue to work independently

## Implementation Approach

1. **Phase 1**: Minimal refactor to each `*One` function — export it, add a `writeLedgerFn?` injection point to its Ctx type. The default behavior (existing CLI handlers) is unchanged. This unlocks concurrent-safe orchestration.
2. **Phase 2**: Build `src/cli/process.ts` — `LedgerMutex`, stage runner, `processTranscript`, `processAll`, and run summary generation.
3. **Phase 3**: Register commands in `src/cli/index.ts`.
4. **Phase 4**: Tests.

---

## Phase 1: Export `*One` Functions and Add `writeLedgerFn` Injection

### Overview

Add one optional field to each stage's Ctx type (`writeLedgerFn?`) and use it in place of the hard-coded `writeLedger` import. Export the `*One` function and its Ctx type. Existing CLI handlers pass no `writeLedgerFn` so they continue using the default behavior. No test changes required.

### Changes Required

#### 1. `src/cli/segment.ts`

```typescript
// Add to SegmentCtx:
writeLedgerFn?: (path: string, ledger: Ledger) => Promise<void>;

// Export the type and function:
export type { SegmentCtx };
export { segmentOne };

// In segmentOne (line 128), replace:
await writeLedger(ctx.ledgerPath, next);
// With:
await (ctx.writeLedgerFn ?? writeLedger)(ctx.ledgerPath, next);
```

#### 2. `src/cli/extract.ts`

Same pattern: add `writeLedgerFn?` to `ExtractCtx`, export `ExtractCtx` and `extractOne`, use `ctx.writeLedgerFn ?? writeLedger` in `extractOne`.

#### 3. `src/cli/resolve.ts`

Same pattern for `ResolveCtx` / `resolveOne`.

#### 4. `src/cli/match.ts`

Same pattern for `MatchCtx` / `matchOne`.

#### 5. `src/cli/propose.ts`

Same pattern for `ProposeCtx` / `proposeOne`.

#### 6. `src/gitlab/submit.ts`

```typescript
// Add to SubmitCtx:
writeLedgerFn?: (path: string, ledger: Ledger) => Promise<void>;

// In submitOne success path (line 108), replace:
await writeLedger(ctx.ledgerPath, next);
// With:
await (ctx.writeLedgerFn ?? writeLedger)(ctx.ledgerPath, next);

// In submitOne error path (line 114), replace:
await writeLedger(ctx.ledgerPath, next);
// With:
await (ctx.writeLedgerFn ?? writeLedger)(ctx.ledgerPath, next);
```

Also clean up the redundant `recordError` + `writeLedger` in `src/cli/submit.ts` error catch (lines 82-83): since `submitOne` already handles error recording internally, the CLI handler's catch block should not also call `recordError`/`writeLedger`. Remove lines 82-83 from `cli/submit.ts`'s `--all` loop catch body, keeping only the `console.error` and `failures.push`.

### Success Criteria

#### Automated Verification
- [x] All existing tests pass: `bun test`
- [x] TypeScript compiles: `bun run typecheck` (or equivalent)

---

## Phase 2: Create `src/cli/process.ts`

### Overview

The orchestrator: a `LedgerMutex` for concurrent-safe ledger writes, a `processOneTranscript` internal function that runs stages sequentially with skip-on-completion, and two exported CLI handlers (`processTranscript` and `processAll`).

### Changes Required

#### `src/cli/process.ts` (new file)

##### Types and constants

```typescript
import type { Ledger, LedgerEntry } from '../transcript/ledger';
import type { Stages } from '../transcript/ledger';

export type PipelineStage =
  'segment' | 'extract' | 'resolve' | 'match' | 'propose' | 'submit';

export const PIPELINE_STAGES: PipelineStage[] =
  ['segment', 'extract', 'resolve', 'match', 'propose', 'submit'];

// Maps CLI stage name → first ledger key set by that stage.
// Used for both completion-check and --force reset.
const STAGE_LEDGER_KEY: Record<PipelineStage, keyof Stages> = {
  segment: 'segmented',
  extract: 'extracted',
  resolve: 'resolved',
  match:   'matched',
  propose: 'proposed',
  submit:  'verified',  // submit sets verified then prOpened; reset from verified clears both
};

// submit is complete only when prOpened (the final key it sets) is non-null.
function isStageComplete(entry: LedgerEntry, stage: PipelineStage): boolean {
  if (stage === 'submit') return entry.stages.prOpened !== null;
  return entry.stages[STAGE_LEDGER_KEY[stage]] !== null;
}
```

##### `LedgerMutex` class

```typescript
type WriteLedgerFn = (path: string, ledger: Ledger) => Promise<void>;

class LedgerMutex {
  private queue: Promise<void> = Promise.resolve();

  // Returns a WriteLedgerFn that, under a serial queue:
  //   1. Re-reads the current on-disk ledger (freshest state)
  //   2. Replaces only the entry for `filename` with the one from `incoming`
  //   3. Writes the merged result atomically
  // All other entries come from the freshly-read ledger, so concurrent
  // updates to different entries never clobber each other.
  makeWriter(ledgerPath: string, filename: string): WriteLedgerFn {
    return (path: string, incoming: Ledger): Promise<void> => {
      const step = this.queue.then(async () => {
        const current = await readLedger(path);
        const updated = incoming.entries.find((e) => e.filename === filename);
        const merged: Ledger = {
          entries: current.entries.map((e) =>
            e.filename === filename && updated ? updated : e,
          ),
        };
        await writeLedger(path, merged);
      });
      this.queue = step.catch(() => {});
      return step;
    };
  }
}
```

##### Argument parsing

```typescript
interface ProcessArgs {
  name?:       string;           // single-transcript name
  dryRun:      boolean;
  force?:      PipelineStage;    // only valid for single-transcript
  stopBefore?: PipelineStage;
  concurrency: number;           // 1 = sequential (default)
}

function parseProcessArgs(argv: string[]): ProcessArgs { ... }
// Validates stage names; exits with error on unknown stage or --force with --all.
```

##### Process options (injectable for tests)

```typescript
export interface ProcessCliOptions {
  transcriptsDir?: string;
  ledgerPath?:     string;
  segmentsDir?:    string;
  claimsDir?:      string;
  resolutionsDir?: string;
  matchesDir?:     string;
  proposalsDir?:   string;
  contentDir?:     string;
  dryRunsDir?:     string;
  wikiIndexPath?:  string;
  claudeMdPath?:   string;
  models?: {
    segment?: string;
    extract?: string;
    resolve?: string;
    match?:   string;
    propose?: string;
  };
  completeFn?: typeof defaultComplete;
  clientFn?:   (baseUrl: string, token: string, projectId: string) => GitLabClient;
}
```

##### `processOneTranscript` (internal)

```typescript
async function processOneTranscript(
  filename:      string,
  args:          Pick<ProcessArgs, 'dryRun' | 'stopBefore'>,
  ctx:           ResolvedCtx,          // all paths + models, built from options
  writeLedgerFn: WriteLedgerFn,
): Promise<void> {
  for (const stage of PIPELINE_STAGES) {
    if (args.stopBefore === stage) return;

    // Re-read ledger before each stage to get the freshest completion state.
    const ledger = await readLedger(ctx.ledgerPath);
    const r = findEntry(ledger, filename);
    if (!r.ok) throw new Error(`transcript not found in ledger: ${filename}`);
    if (isStageComplete(r.entry, stage)) continue;

    switch (stage) {
      case 'segment': await segmentOne(r.entry, ledger, { ...ctx.segCtx, writeLedgerFn }); break;
      case 'extract': await extractOne(r.entry, ledger, { ...ctx.extCtx, writeLedgerFn }); break;
      case 'resolve': await resolveOne(r.entry, ledger, { ...ctx.resCtx, writeLedgerFn }); break;
      case 'match':   await matchOne(r.entry, ledger, { ...ctx.matchCtx, writeLedgerFn }); break;
      case 'propose': await proposeOne(r.entry, ledger, { ...ctx.propCtx, writeLedgerFn }); break;
      case 'submit':  await submitOne(r.entry, ledger, { ...ctx.submitCtx, dryRun: args.dryRun, writeLedgerFn }); break;
    }
  }
}
```

##### `processTranscript` CLI handler

```typescript
export async function processTranscript(argv: string[], opts: ProcessCliOptions = {}): Promise<void> {
  const args = parseProcessArgs(argv);
  if (!args.name) { /* print usage, exit 1 */ }
  if (args.concurrency !== 1) {
    console.error('--concurrency is only valid with process-all');
    process.exit(1);
  }

  // Reconcile
  const ctx = buildCtx(opts);
  const prior = await readLedger(ctx.ledgerPath);
  const { files, skipped } = await discoverTranscripts(ctx.transcriptsDir);
  for (const s of skipped) console.error(`warning: skipping ${s.filename} — ${s.reason}`);
  const { ledger: reconciled, changes } = reconcile(prior, files);
  let ledger = reconciled;
  if (changes.added.length + changes.rehashed.length > 0) await writeLedger(ctx.ledgerPath, ledger);

  // Resolve transcript
  const r = findEntry(ledger, args.name);
  if (!r.ok) { /* handle not_found / ambiguous, exit 1 */ }
  const presentFilenames = new Set(files.map((f) => f.filename));
  if (!presentFilenames.has(r.entry.filename)) { /* error, exit 1 */ }

  // Apply --force
  if (args.force) {
    ledger = resetEntryStage(ledger, r.entry.filename, STAGE_LEDGER_KEY[args.force]);
    await writeLedger(ctx.ledgerPath, ledger);
    console.log(`forced: reset '${r.entry.filename}' from stage '${args.force}'`);
  }

  // No concurrency for single transcript — use a pass-through write function
  const mutex = new LedgerMutex();
  const writeLedgerFn = mutex.makeWriter(ctx.ledgerPath, r.entry.filename);
  await processOneTranscript(r.entry.filename, args, ctx, writeLedgerFn);
}
```

##### `processAll` CLI handler

```typescript
export async function processAll(argv: string[], opts: ProcessCliOptions = {}): Promise<void> {
  const args = parseProcessArgs(argv);
  if (args.force) {
    console.error('--force cannot be used with process-all');
    process.exit(1);
  }
  if (args.name) {
    console.error('process-all does not accept a transcript name');
    process.exit(1);
  }

  const ctx = buildCtx(opts);
  const prior = await readLedger(ctx.ledgerPath);
  const { files, skipped } = await discoverTranscripts(ctx.transcriptsDir);
  for (const s of skipped) console.error(`warning: skipping ${s.filename} — ${s.reason}`);
  const { ledger: reconciled, changes } = reconcile(prior, files);
  let ledger = reconciled;
  if (changes.added.length + changes.rehashed.length > 0) await writeLedger(ctx.ledgerPath, ledger);

  const presentFilenames = new Set(files.map((f) => f.filename));
  const targets = getTargets(ledger.entries, presentFilenames, args.stopBefore);

  if (targets.length === 0) {
    console.log('nothing to process — all transcripts are up to date');
    return;
  }
  console.log(`processing ${targets.length} transcript(s) with concurrency ${args.concurrency}`);

  const mutex = new LedgerMutex();
  const failures: Array<{ filename: string; error: string }> = [];

  await runWithConcurrency(targets, args.concurrency, async (entry) => {
    const writeLedgerFn = mutex.makeWriter(ctx.ledgerPath, entry.filename);
    try {
      await processOneTranscript(entry.filename, args, ctx, writeLedgerFn);
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`! ${entry.filename}: ${msg}`);
      failures.push({ filename: entry.filename, error: msg });
    }
  });

  const summary = await buildSummary(targets, failures, ctx.ledgerPath);
  const summaryPath = currentRunFile().replace('.jsonl', '-summary.md');
  await Bun.write(summaryPath, summary);
  console.log(`\nsummary: ${summaryPath}`);
  console.log(summary);

  if (failures.length > 0) {
    throw new Error(`${failures.length} transcript(s) failed`);
  }
}
```

##### `getTargets` helper

```typescript
// Returns entries with at least one stage (in the stages-to-run set) still null.
function getTargets(
  entries:         LedgerEntry[],
  presentFilenames: Set<string>,
  stopBefore?:     PipelineStage,
): LedgerEntry[] {
  const limit = stopBefore ? PIPELINE_STAGES.indexOf(stopBefore) : PIPELINE_STAGES.length;
  const stagesToRun = PIPELINE_STAGES.slice(0, limit);
  if (stagesToRun.length === 0) return [];
  return entries.filter(
    (e) =>
      presentFilenames.has(e.filename) &&
      stagesToRun.some((s) => !isStageComplete(e, s)),
  );
}
```

##### `runWithConcurrency` helper

```typescript
async function runWithConcurrency<T>(
  items:       T[],
  concurrency: number,
  fn:          (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (queue.length > 0) {
        const item = queue.shift()!;
        await fn(item);
      }
    },
  );
  await Promise.all(workers);
}
```

##### `buildSummary` helper

```typescript
async function buildSummary(
  targets:     LedgerEntry[],
  failures:    Array<{ filename: string; error: string }>,
  ledgerPath:  string,
): Promise<string> {
  const ledger = await readLedger(ledgerPath);
  const ts = new Date().toISOString();

  // Cost (may not exist if no LLM calls were made)
  const runFile = currentRunFile();
  const rollup = (await Bun.file(runFile).exists()) ? await summarize(runFile) : null;

  const failureSet = new Set(failures.map((f) => f.filename));
  const lines: string[] = [`# Process-All Run — ${ts}\n`];

  // Transcripts table
  lines.push('## Transcripts\n');
  lines.push('| Transcript | Result | MR |');
  lines.push('|---|---|---|');
  for (const t of targets) {
    const entry = ledger.entries.find((e) => e.filename === t.filename);
    const failed = failureSet.has(t.filename);
    const result = failed ? '✗ failed' : '✓';
    const mr = entry?.prUrl ? `[MR](${entry.prUrl})` : '—';
    lines.push(`| ${t.filename} | ${result} | ${mr} |`);
  }

  // Cost table
  if (rollup) {
    lines.push('\n## Cost\n');
    lines.push('| Stage | Model | Calls | Cost |');
    lines.push('|---|---|---|---|');
    for (const [key, b] of Object.entries(rollup.byStage).sort()) {
      const [stage, model] = key.split('::');
      lines.push(`| ${stage} | ${model} | ${b.calls} | $${b.costUSD.toFixed(4)} |`);
    }
    lines.push(`| **TOTAL** | | ${rollup.totals.calls} | **$${rollup.totals.costUSD.toFixed(4)}** |`);
  }

  // Errors section
  if (failures.length > 0) {
    lines.push('\n## Errors\n');
    for (const f of failures) lines.push(`- \`${f.filename}\`: ${f.error}`);
  }

  // Footer
  const succeeded = targets.length - failures.length;
  const mrCount = targets.filter((t) => {
    const e = ledger.entries.find((e) => e.filename === t.filename);
    return e?.prUrl;
  }).length;
  lines.push(`\n---\n`);
  lines.push(`${targets.length} targeted · ${succeeded} succeeded · ${failures.length} failed · ${mrCount} MRs opened`);
  if (rollup) lines.push(`Total cost: $${rollup.totals.costUSD.toFixed(4)}`);

  return lines.join('\n') + '\n';
}
```

### Success Criteria

#### Automated Verification
- [x] `bun test src/cli/process.test.ts` — all new tests pass
- [x] `bun test` — no regressions in existing tests
- [x] TypeScript compiles without errors

---

## Phase 3: Register Commands

### Changes Required

#### `src/cli/index.ts`

```typescript
import { processTranscript, processAll } from './process';
// ...
'process':     processTranscript,
'process-all': processAll,
```

### Success Criteria

#### Automated Verification
- [x] `bun run process` (no args) prints usage and exits 1
- [x] `bun run process-all` (no transcripts needing work) prints "nothing to process"

---

## Phase 4: Tests

### Changes Required

#### `src/cli/process.test.ts` (new file)

**`LedgerMutex` tests (~10 tests)**
- Concurrent writes to different entries do not lose data
- Writes are serialized (second write sees first write's changes)
- Rejected writes do not poison the queue (next write still executes)

**`processOneTranscript` tests (~20 tests)**
- Skips stages with non-null ledger keys
- Runs stages in order: segment → extract → resolve → match → propose → submit
- `stopBefore: 'match'` halts before match; segment/extract/resolve were run
- `stopBefore: 'segment'` is a no-op (nothing runs)
- `dryRun: true` is passed through to submitOne, not to other stages
- On stage error, the error propagates (no swallowing)
- Re-reads ledger before each stage (picks up updates from concurrent writers)
- Calls `writeLedgerFn` from each stage (verifies injection)

**`parseProcessArgs` tests (~10 tests)**
- `['foo']` → `{ name: 'foo', dryRun: false, concurrency: 1 }`
- `['--dry-run', 'foo']` → `{ dryRun: true }`
- `['--force', 'propose', 'foo']` → `{ force: 'propose' }`
- `['--stop-before', 'submit', 'foo']` → `{ stopBefore: 'submit' }`
- `['--concurrency', '4']` → `{ concurrency: 4 }`
- Unknown stage name → exits 1
- `--force` without a stage name → exits 1

**`processTranscript` handler tests (~10 tests)**
- Reconciles ledger before processing
- `--force propose` calls `resetEntryStage` from `proposed` then re-runs
- Transcript not found → exits 1
- Transcript on disk, stage stubs run in order
- `--concurrency` with single transcript → exits 1 with error

**`processAll` handler tests (~15 tests)**
- `--force` → exits 1 with error
- Processes only transcripts with at least one incomplete stage
- With `--stop-before submit`: transcripts with only submit remaining are excluded
- Collects failures without aborting; throws at end with count
- Writes summary to `state/runs/<timestamp>-summary.md`
- `--concurrency 2` processes 2 transcripts concurrently (verify with ordering)

**`buildSummary` tests (~8 tests)**
- Correct markdown structure with all sections
- Handles missing cost JSONL (no Cost section rendered)
- MR links use `prUrl` from ledger
- Failed transcripts show `✗ failed` with no MR link

**`getTargets` tests (~5 tests)**
- Returns entries with any null stage
- Respects `stopBefore` boundary
- Excludes entries not present on disk

### Success Criteria

#### Automated Verification
- [x] `bun test src/cli/process.test.ts` — all tests pass
- [x] `bun test` — no regressions

#### Manual Verification
- [ ] `bun run process 000 --dry-run` — dry-run output printed, no MR opened, ledger unchanged for transcript 000
- [ ] `bun run process-all --stop-before submit --concurrency 2` — runs all 36 unprocessed transcripts through propose stage, summary file written
- [ ] `bun run process-all --dry-run` — submit stage runs in dry-run mode for all proposed transcripts, no MRs opened
- [ ] Kill `process-all` mid-run, re-run — picks up from last completed stage without re-running completed ones (verify via file timestamps in `state/` and ledger)
- [ ] `bun run process 000 --force propose` — resets proposed/verified/prOpened for transcript 000, re-runs from propose

---

## Testing Strategy

### Unit Tests
- Stage stubs: each test injects no-op `*One` implementations via `ProcessCliOptions.completeFn` and `clientFn`
- Ledger assertions: after each handler call, read `state/processed.json` and assert stage timestamps

### Integration (manual)
- Single-transcript dry-run against the test GitLab project
- Full backfill of 36 transcripts — budget check before starting

## Performance Considerations

With `--concurrency N`, each transcript's stages run sequentially, so the bottleneck is LLM latency per stage. With N=4 and ~5 LLM stages per transcript, throughput scales roughly linearly up to API rate limits. The `LedgerMutex` queue serializes only the ledger read-modify-write (milliseconds), not the LLM calls themselves.

## References

- Original ticket: `tickets/013-end-to-end-orchestrator.md`
- Ledger schema and mutations: `src/transcript/ledger.ts`
- Stage module pattern (canonical): `src/cli/segment.ts`
- Submit internals: `src/gitlab/submit.ts`
- Cost tracking: `src/log.ts`
