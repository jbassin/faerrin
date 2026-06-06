// Pure path helpers — node:path + process only (both client-safe under Vite), NO
// node:fs. This module is safe to import from anywhere; the node:fs readers live in
// content.ts (server-only). Splitting them keeps Node I/O out of the client bundle:
// server functions are referenced by client components, so anything they statically
// import lands in the browser build — and node:fs/crypto/child_process get externalized
// and throw on access. Server fns therefore dynamic-import the node:fs modules.
import { join, resolve, sep } from "node:path";

/** Repo-relative content roots; dev server cwd is pkg/heartwood-review. */
export const CONTENT_ROOT = join(process.cwd(), "..", "content");
export const WIKI_DIR = join(CONTENT_ROOT, "wiki");
export const TRANSCRIPTS_DIR = join(CONTENT_ROOT, "transcripts");

/** Core package state dirs (the pipeline persists artifacts there). */
export const CORE_STATE = join(process.cwd(), "..", "heartwood", "state");
export const SESSIONS_DIR = join(CORE_STATE, "sessions");
export const REVIEW_DIR = join(CORE_STATE, "review");
/** Cross-session rejection memory + quality log (AC-16/AC-26). */
export const QUALITY_DIR = join(CORE_STATE, "quality");

/** Durable provenance ledger — OUTSIDE wiki/ so aether's build is untouched (C6/D-1). */
export const PROV_ROOT = join(CONTENT_ROOT, ".heartwood", "provenance");

/** jj runs from the repo root with repo-relative path filesets. */
export const REPO_ROOT = join(process.cwd(), "..", "..");

/**
 * Resolve `rel` under `root` and refuse anything that escapes it (path-traversal guard).
 * Server-fn inputs (page paths, transcript names) are user-controllable, and node:path.join
 * resolves `..`, so every file reader funnels through this.
 */
export function within(root: string, rel: string): string {
  const abs = resolve(root, rel);
  const rootResolved = resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + sep)) {
    throw new Error(`path escapes content root: ${rel}`);
  }
  return abs;
}
