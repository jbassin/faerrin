import type { SessionDigest, WikiCorpus, WikiPage } from "../types.ts";
import { basename } from "node:path";

/** A wiki page matched to one or more of a digest's wikiRefs. */
export interface GroundingEntry {
  /** The wiki refs (from beats) that resolved to this page. */
  refs: string[];
  title: string;
  path: string;
  text: string;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Build case-insensitive title and basename lookups over the corpus. */
function buildLookups(wiki: WikiCorpus): {
  byTitle: Map<string, WikiPage>;
  byBasename: Map<string, WikiPage>;
} {
  const byTitle = new Map<string, WikiPage>();
  const byBasename = new Map<string, WikiPage>();
  for (const page of wiki.pages.values()) {
    const t = norm(page.title);
    if (!byTitle.has(t)) byTitle.set(t, page);
    const b = norm(basename(page.path).replace(/\.md$/, ""));
    if (!byBasename.has(b)) byBasename.set(b, page);
  }
  return { byTitle, byBasename };
}

/**
 * Resolve a digest's beat `wikiRefs` to wiki pages, returning one entry per
 * matched page (deduped, refs aggregated). Matching is case-insensitive against
 * page title then filename basename. Unmatched refs (NPCs, ad-hoc nouns the wiki
 * doesn't document) are dropped — they simply don't get grounding text.
 *
 * Entries are ordered by first appearance across beats, so the most
 * story-central pages come first if a caller wants to cap the list.
 */
export function groundDigest(digest: SessionDigest, wiki: WikiCorpus): GroundingEntry[] {
  const { byTitle, byBasename } = buildLookups(wiki);
  const byPath = new Map<string, GroundingEntry>();
  const order: string[] = [];

  const allRefs = digest.beats.flatMap((b) => b.wikiRefs);
  for (const ref of allRefs) {
    const key = norm(ref);
    const page = byTitle.get(key) ?? byBasename.get(key);
    if (!page) continue;

    const existing = byPath.get(page.path);
    if (existing) {
      if (!existing.refs.includes(ref)) existing.refs.push(ref);
    } else {
      byPath.set(page.path, { refs: [ref], title: page.title, path: page.path, text: page.text });
      order.push(page.path);
    }
  }

  return order.map((p) => byPath.get(p)!);
}
