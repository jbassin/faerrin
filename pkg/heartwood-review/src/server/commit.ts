import { createServerFn } from "@tanstack/react-start";
import { assertSessionId } from "./sessions.ts";

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

export function commitMessage(arc: string, date: string, amend: number, create: number): string {
  const n = amend + create;
  return `heartwood: ${arc} ${date} — ${n} page${n === 1 ? "" : "s"} (${amend} amend, ${create} create)`;
}

export function normalizeWikiPath(p: string): string {
  return p.endsWith(".md") ? p : `${p}.md`;
}

export const commitSession = createServerFn({ method: "POST" })
  .inputValidator((data: { arc: string; date: string }) => data)
  .handler(async ({ data }): Promise<CommitResult> => {
    const { performCommit } = await import("./commit-impl.ts");
    return performCommit(assertSessionId(data.arc, data.date));
  });
