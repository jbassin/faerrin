import type { RollEvent } from "./schema";

/** A roll in the ticker — the wire event plus a stable React key. */
export interface TickerRoll extends RollEvent {
  id: string;
}

/**
 * Prepend the newest roll and cap the list at `max` (drops the oldest). Pure:
 * returns a new array, never mutates the input — so it's a drop-in React updater.
 */
export function pushRoll(list: TickerRoll[], roll: TickerRoll, max: number): TickerRoll[] {
  return [roll, ...list].slice(0, Math.max(0, max));
}
