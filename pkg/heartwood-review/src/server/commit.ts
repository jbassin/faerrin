import { createServerFn } from "@tanstack/react-start";
import { assertSessionId } from "./sessions.ts";
import type {
  WeaveMode,
  WeaveTarget,
} from "@faerrin/heartwood/src/state/review.ts";

// CLIENT-SAFE shell: pure helpers + types + the server-fn declaration only. The actual
// commit implementation (Node fs + jj + core ledger) lives in commit-impl.ts and is
// ONLY dynamic-imported inside the handler, so none of it reaches the client bundle.

export interface CommitResult {
  committed: boolean;
  revision?: string;
  message?: string;
  written: string[];
  skipped: { proposal: string; reason: string }[];
  amend: number;
  create: number;
  /** Amends that REPLACED an existing statement (a Supersede correction, AC-21). */
  corrected: number;
}

// ---- Pure helpers (unit-tested; used by commit-impl) -----------------------

/** Append authored prose as a new paragraph at the end of the page body (the chosen v1 amend strategy). */
export function appendAuthoredParagraph(body: string, text: string): string {
  const trimmed = body.replace(/\s+$/, "");
  const para = text.trim();
  return trimmed.length ? `${trimmed}\n\n${para}\n` : `${para}\n`;
}

/** New-page content: plain prose body, no frontmatter (matches many existing wiki pages). */
export function newPageContent(text: string): string {
  return `${text.trim()}\n`;
}

/**
 * Weave approved amend prose into the page at the reviewer's chosen location (AC-12):
 * - `end` (or no target): a new paragraph at the end (the old default).
 * - `into`: appended to the target paragraph so it reads as one continuous paragraph.
 * - `after`: a new paragraph immediately after the target.
 * The target paragraph is located by its current text (`anchorText`); if it can't be found
 * the prose is appended at the end (never lost). Returns the effective mode used.
 */
export function applyWeave(
  body: string,
  text: string,
  weave?: WeaveTarget,
): { body: string; mode: WeaveMode } {
  const prose = text.trim();
  if (!weave || weave.mode === "end" || !weave.anchorText) {
    return { body: appendAuthoredParagraph(body, prose), mode: "end" };
  }
  const blocks = body.replace(/\n+$/, "").split(/\n{2,}/);
  const anchor = weave.anchorText.trim();
  const idx = blocks.findIndex((b) => b.trim() === anchor);
  if (idx === -1)
    return { body: appendAuthoredParagraph(body, prose), mode: "end" };
  if (weave.mode === "into") {
    blocks[idx] = `${blocks[idx]!.trim()} ${prose}`;
  } else {
    blocks.splice(idx + 1, 0, prose);
  }
  return { body: `${blocks.join("\n\n")}\n`, mode: weave.mode };
}

export function commitMessage(
  arc: string,
  date: string,
  amend: number,
  create: number,
  corrected = 0,
): string {
  const n = amend + create + corrected;
  const parts = [`${amend} amend`, `${create} create`];
  if (corrected > 0) parts.push(`${corrected} correct`);
  return `heartwood: ${arc} ${date} — ${n} page${n === 1 ? "" : "s"} (${parts.join(", ")})`;
}

export function normalizeWikiPath(p: string): string {
  return p.endsWith(".md") ? p : `${p}.md`;
}

/**
 * Supersede (AC-21): replace the existing statement in `body` with the authored prose.
 * Conflict.existingStatement is the LLM's verbatim slice of the page, so a substring match
 * locates it; if it can't be found, fall back to appending so the prose is never lost.
 */
export function applySupersede(
  body: string,
  existingStatement: string,
  replacement: string,
): { body: string; located: boolean } {
  const target = existingStatement.trim();
  const idx = target ? body.indexOf(target) : -1;
  if (idx === -1) {
    return { body: appendAuthoredParagraph(body, replacement), located: false };
  }
  return {
    body:
      body.slice(0, idx) + replacement.trim() + body.slice(idx + target.length),
    located: true,
  };
}

export const commitSession = createServerFn({ method: "POST" })
  .inputValidator((data: { arc: string; date: string }) => data)
  .handler(async ({ data }): Promise<CommitResult> => {
    const { performCommit } = await import("./commit-impl.ts");
    return performCommit(assertSessionId(data.arc, data.date));
  });
