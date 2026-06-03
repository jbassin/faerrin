import type { ScriptTurn } from "../types.ts";

/**
 * ElevenLabs Text-to-Dialogue accepts up to ~2,000 characters per request, so a
 * full episode is split into chunks. We budget below that for the request JSON
 * and any leading emotion tags we promote into the text.
 */
export const DEFAULT_DIALOGUE_BUDGET = 1800;

/**
 * Group consecutive turns into dialogue chunks whose combined text stays under
 * `budget` characters, preserving order. A single turn longer than the budget
 * becomes its own chunk (turns are never split mid-line). `lengthOf` measures a
 * turn the way it will be sent (so the caller can account for promoted tags).
 */
export function chunkTurns(
  turns: ScriptTurn[],
  budget: number = DEFAULT_DIALOGUE_BUDGET,
  lengthOf: (turn: ScriptTurn) => number = (t) => t.text.length,
): ScriptTurn[][] {
  const chunks: ScriptTurn[][] = [];
  let current: ScriptTurn[] = [];
  let used = 0;
  for (const turn of turns) {
    const len = lengthOf(turn);
    if (current.length > 0 && used + len > budget) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(turn);
    used += len;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
