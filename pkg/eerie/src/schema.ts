// The wire contract from @faerrin/mouth. Two shapes are accepted:
//   v0 (today, no Rust change): { user, value, is_crit, is_fumble }
//   v1 (richer, later):         { v, user, expression, total, dice, modifier,
//                                 is_crit, is_fumble, ts }
// parseRollEvent() normalizes both into a single internal RollEvent (camelCase),
// filling defaults so the overlay renders correctly against either. Crit/fumble
// are mirrored verbatim from mouth's RollGoodness — eerie does no rule logic.

export interface RollEvent {
  /** schema version mouth claimed (0 for legacy payloads). */
  v: number;
  /** player display name. */
  user: string;
  /** rendered dice expression (e.g. "2d6+3"), or null on v0. */
  expression: string | null;
  /** the roll total. */
  total: number;
  /** individual die faces, or null when not provided. */
  dice: number[] | null;
  /** flat modifier, or null when not provided. */
  modifier: number | null;
  /** mirrored from mouth's RollGoodness::Crit. */
  isCrit: boolean;
  /** mirrored from mouth's RollGoodness::Fumble. */
  isFumble: boolean;
  /** ISO-8601 timestamp; stamped on ingest if mouth didn't send one. */
  ts: string;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function asFiniteNumber(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

/**
 * Validate + normalize an untrusted ingest body. Returns null for anything that
 * isn't a usable roll (caller should answer 400). Tolerant by design: a missing
 * timestamp or expression is filled/defaulted, never rejected.
 */
export function parseRollEvent(input: unknown): RollEvent | null {
  if (!isRecord(input)) return null;

  const user = typeof input.user === "string" ? input.user.trim() : "";
  if (!user) return null;

  // v1 sends `total`; v0 sends `value`. Either must be a finite number.
  const total = asFiniteNumber(input.total) ?? asFiniteNumber(input.value);
  if (total === null) return null;

  const expression = typeof input.expression === "string" ? input.expression : null;

  const dice = Array.isArray(input.dice)
    ? input.dice.filter((d): d is number => asFiniteNumber(d) !== null)
    : null;

  const modifier = asFiniteNumber(input.modifier);

  // Accept both snake_case (mouth wire) and camelCase (defensive).
  const isCrit = input.is_crit === true || input.isCrit === true;
  const isFumble = input.is_fumble === true || input.isFumble === true;

  const ts =
    typeof input.ts === "string" && input.ts.length > 0
      ? input.ts
      : new Date().toISOString();

  const v = asFiniteNumber(input.v) ?? (expression !== null ? 1 : 0);

  return { v, user, expression, total, dice, modifier, isCrit, isFumble, ts };
}
