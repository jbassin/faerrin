import type { HostConfig, Script, ScriptTurn } from "../types.ts";
import { DEFAULT_HOSTS } from "./hosts.ts";

export class ScriptParseError extends Error {
  override name = "ScriptParseError";
}

function isHostConfig(v: unknown): v is HostConfig {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  const ok = (h: unknown) =>
    typeof h === "object" && h !== null &&
    typeof (h as Record<string, unknown>).name === "string" &&
    typeof (h as Record<string, unknown>).persona === "string";
  return ok(c.A) && ok(c.B) && ok(c.C);
}

function parseTurn(value: unknown, i: number): ScriptTurn {
  if (typeof value !== "object" || value === null) {
    throw new ScriptParseError(`turns[${i}] must be an object`);
  }
  const t = value as Record<string, unknown>;
  if (t.speaker !== "A" && t.speaker !== "B" && t.speaker !== "C") {
    throw new ScriptParseError(`turns[${i}].speaker must be "A", "B", or "C"`);
  }
  if (typeof t.text !== "string" || t.text.trim() === "") {
    throw new ScriptParseError(`turns[${i}].text must be a non-empty string`);
  }
  const turn: ScriptTurn = { speaker: t.speaker, text: t.text };
  if (typeof t.emotion === "string" && t.emotion.trim() !== "") {
    turn.emotion = t.emotion;
  }
  return turn;
}

/** Validate the model's tool input into a Script, attaching the sessionId. */
export function parseScript(sessionId: string, raw: unknown): Script {
  if (typeof raw !== "object" || raw === null) {
    throw new ScriptParseError("tool input must be an object");
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.title !== "string" || r.title.trim() === "") {
    throw new ScriptParseError("title must be a non-empty string");
  }
  if (!Array.isArray(r.turns) || r.turns.length === 0) {
    throw new ScriptParseError("turns must be a non-empty array");
  }
  return {
    sessionId,
    title: r.title,
    hosts: isHostConfig(r.hosts) ? r.hosts : DEFAULT_HOSTS,
    turns: r.turns.map((t, i) => parseTurn(t, i)),
  };
}
