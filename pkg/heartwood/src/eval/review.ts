// Interactive review for eval-label candidates (Phase 0b). Pure decision parsing + an
// I/O-injected loop, modeled on content's surface/interactive.ts, so the logic is
// unit-testable without a real terminal. The CLI (scripts/review-labels.ts) wires `key`/`line`
// to readline and `context` to the transcript.

import type { EvalLabel, LabeledFact } from './labels';

export type LabelAction =
  | { kind: 'approve' }
  | { kind: 'edit' }
  | { kind: 'deny' }
  | { kind: 'skip' }
  | { kind: 'quit' };

/**
 * Parse a keystroke into an action.
 * "" / a / y → approve; e / c → edit; d / n → deny; s → skip (leave for later);
 * q → quit. Unknown input → null (re-prompt).
 */
export function parseLabelAction(input: string): LabelAction | null {
  const s = input.trim().toLowerCase();
  if (s === '' || s === 'a' || s === 'y') return { kind: 'approve' };
  if (s === 'e' || s === 'c') return { kind: 'edit' };
  if (s === 'd' || s === 'n') return { kind: 'deny' };
  if (s === 's') return { kind: 'skip' };
  if (s === 'q') return { kind: 'quit' };
  return null;
}

export interface ReviewDeps {
  /** Prompt and return a single keystroke (no Enter needed) — for actions. */
  key(prompt: string): Promise<string>;
  /** Prompt and return a full line (Enter-terminated) — for typed text. */
  line(prompt: string): Promise<string>;
  /** Emit a line of output. */
  out(line: string): void;
  /** Optional: render the transcript lines a fact cites, for verification context. */
  context?(fact: LabeledFact): string[];
}

export interface LabelReviewStats {
  total: number;
  alreadyReviewed: number;
  approved: number;
  edited: number;
  denied: number;
  skipped: number;
  quit: boolean;
}

function emptyStats(total: number, alreadyReviewed: number): LabelReviewStats {
  return { total, alreadyReviewed, approved: 0, edited: 0, denied: 0, skipped: 0, quit: false };
}

const PROMPT =
  '  [a/⏎ approve · e edit · d deny · s skip · q quit] > ';

function formatFact(fact: LabeledFact, n: number, of: number, deps: ReviewDeps): string {
  const cites = (fact.citations ?? []).map((c) => `${c.start}-${c.end}`).join(', ') || '—';
  const lines = [
    '',
    `(${n}/${of})  ${fact.id}  [lines ${cites}]`,
    `  ${fact.statement}`,
    `  entities: ${fact.entities.length ? fact.entities.join(', ') : '(none)'}`,
  ];
  const ctx = deps.context?.(fact) ?? [];
  if (ctx.length) {
    lines.push('  ── transcript ──');
    for (const l of ctx) lines.push(`    ${l}`);
  }
  return lines.join('\n');
}

/**
 * Review the un-reviewed candidate facts in `label`. Approve keeps a fact (marked reviewed),
 * edit lets you rewrite the statement/entities, deny removes it, skip leaves it for next run.
 * Returns a new EvalLabel (denied facts removed) and stats. Quitting preserves all decisions
 * made so far.
 */
export async function reviewLabels(
  label: EvalLabel,
  deps: ReviewDeps,
): Promise<{ label: EvalLabel; stats: LabelReviewStats }> {
  const facts = label.canonFacts;
  const pendingIdx = facts.map((f, i) => (f.reviewed ? -1 : i)).filter((i) => i >= 0);
  const stats = emptyStats(facts.length, facts.length - pendingIdx.length);

  // Decisions keyed by fact index: the replacement fact, or null = deny (drop).
  const decided = new Map<number, LabeledFact | null>();

  for (let p = 0; p < pendingIdx.length; p++) {
    const idx = pendingIdx[p]!;
    const fact = facts[idx]!;
    deps.out(formatFact(fact, p + 1, pendingIdx.length, deps));

    let action: LabelAction | null = null;
    while (action === null) {
      action = parseLabelAction(await deps.key(PROMPT));
      if (action === null) deps.out('  ? unrecognized — a/⏎, e, d, s, or q');
    }

    if (action.kind === 'quit') {
      stats.quit = true;
      break;
    }
    if (action.kind === 'skip') {
      stats.skipped++;
      continue;
    }
    if (action.kind === 'deny') {
      decided.set(idx, null);
      stats.denied++;
      deps.out('  ✗ denied');
      continue;
    }

    let next: LabeledFact = { ...fact, reviewed: true };
    if (action.kind === 'edit') {
      const statement = (await deps.line(`  statement [${fact.statement}] > `)).trim();
      const entitiesRaw = (await deps.line(`  entities [${fact.entities.join(', ')}] > `)).trim();
      if (statement) next = { ...next, statement };
      if (entitiesRaw) next = { ...next, entities: entitiesRaw.split(',').map((e) => e.trim()).filter(Boolean) };
      stats.edited++;
      deps.out(`  ✓ edited: ${next.statement}`);
    } else {
      stats.approved++;
      deps.out('  ✓ approved');
    }
    decided.set(idx, next);
  }

  // Rebuild the fact list: apply decisions, drop denied, keep undecided as-is.
  const nextFacts: LabeledFact[] = [];
  for (let i = 0; i < facts.length; i++) {
    if (decided.has(i)) {
      const d = decided.get(i)!;
      if (d !== null) nextFacts.push(d); // null = denied → omit
    } else {
      nextFacts.push(facts[i]!);
    }
  }

  return { label: { ...label, canonFacts: nextFacts }, stats };
}
