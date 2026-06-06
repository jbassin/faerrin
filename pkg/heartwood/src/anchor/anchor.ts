// Durable sentence anchors for provenance (spec D-1, Phase 0a).
//
// A provenance record must point at *which* wiki sentence a session's facts justify,
// and survive the worldbuilder later editing that page by hand in Obsidian — without
// writing any marker into the prose (the wiki source stays byte-clean for aether).
//
// Strategy: anchor a sentence by (headingPath, ordinal-within-section, normalized-hash).
// On re-read we recompute the page's sentences and re-anchor:
//   1. exact normalized-hash match within the same heading section  -> same sentence;
//   2. else fuzzy match (token Jaccard >= threshold) within the section -> moved/reworded,
//      re-anchor and report the new normalized text;
//   3. else -> stale (the sentence was deleted or changed beyond recognition).
//
// The prose, never this record, is authoritative for reading; anchors are best-effort and
// self-healing.

import { sha256Hex } from '../wiki/hash';

export interface Sentence {
  /** Heading trail to the section this sentence sits in (e.g. ["Devotee Benefits"]); [] = top level. */
  headingPath: string[];
  /** Raw sentence text as it appears in the body. */
  text: string;
  /** Normalized text (whitespace-collapsed, wikilink/emphasis-stripped, lowercased). */
  norm: string;
}

export interface SentenceAnchor {
  headingPath: string[];
  /** 0-based index of this sentence among the sentences in its heading section. */
  ordinal: number;
  /** sha256 of `norm`. */
  normHash: string;
  /** Retained so a moved/reworded sentence can be found by fuzzy match. */
  norm: string;
}

export interface ReanchorResult {
  /** Index into the page's current sentence list, or null when the anchor went stale. */
  index: number | null;
  /** True when the sentence could not be re-found (deleted or changed beyond the threshold). */
  stale: boolean;
  /** When re-anchored to a changed sentence, the updated anchor to persist. */
  updated?: SentenceAnchor;
}

/** Default Jaccard similarity threshold for fuzzy re-anchoring. */
export const DEFAULT_FUZZY_THRESHOLD = 0.6;

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
// Sentence terminator followed by whitespace; keeps the terminator with the sentence.
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z0-9"'\[(])/;

/** Normalize a sentence for stable hashing/comparison. */
export function normalizeSentence(raw: string): string {
  return raw
    // [[target|display]] -> display ; [[target#anchor]] -> target ; [[target]] -> target
    .replace(/\[\[([^\]\n]+?)\]\]/g, (_m, inner: string) => {
      const pipe = inner.indexOf('|');
      if (pipe !== -1) return inner.slice(pipe + 1);
      const hash = inner.indexOf('#');
      const path = hash !== -1 ? inner.slice(0, hash) : inner;
      const slash = path.lastIndexOf('/');
      return slash !== -1 ? path.slice(slash + 1) : path;
    })
    .replace(/[*_`~]/g, '')        // strip md emphasis/code markers
    .replace(/<[^>]+>/g, ' ')      // strip inline html tags (e.g. <br />)
    .replace(/\s+/g, ' ')          // collapse whitespace
    .trim()
    .toLowerCase();
}

function isSkippableBlock(line: string): boolean {
  const t = line.trim();
  return (
    t === '' ||
    t.startsWith('#') ||           // heading (handled separately)
    t.startsWith('>') ||           // callout/quote marker line
    t.startsWith('```') ||         // fence
    t.startsWith('<') ||           // raw html / <pre> / <ul>
    t.startsWith('|') ||           // table row
    t.includes(' :: ')             // deity stat-block line (non-prose, D-? page-type)
  );
}

/**
 * Split a markdown body into prose sentences, tracking the heading section each belongs to.
 * Deterministic and intentionally conservative: non-prose lines (headings, callouts, fences,
 * html, tables, ` :: ` stat lines) are skipped so anchors land only on prose.
 */
export function parsePageSentences(body: string): Sentence[] {
  const out: Sentence[] = [];
  const headingStack: { level: number; title: string }[] = [];
  // Split into blocks on blank lines, but track headings line-by-line.
  const lines = body.split('\n');
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const joined = paragraph.join(' ').replace(/\s+/g, ' ').trim();
    paragraph = [];
    if (!joined) return;
    const headingPath = headingStack.map((h) => h.title);
    for (const piece of joined.split(SENTENCE_SPLIT_RE)) {
      const text = piece.trim();
      if (!text) continue;
      out.push({ headingPath: [...headingPath], text, norm: normalizeSentence(text) });
    }
  };

  for (const line of lines) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1]!.length;
      const title = heading[2]!.trim();
      while (headingStack.length && headingStack[headingStack.length - 1]!.level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title });
      continue;
    }
    if (isSkippableBlock(line)) {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  return out;
}

function pathKey(p: string[]): string {
  return p.join(' › '); // › separator, unlikely in titles
}

/** Build an anchor for the sentence at `index` in `sentences`. */
export function anchorForSentence(sentences: Sentence[], index: number): SentenceAnchor {
  const s = sentences[index];
  if (!s) throw new Error(`anchorForSentence: index ${index} out of range (${sentences.length})`);
  const key = pathKey(s.headingPath);
  let ordinal = 0;
  for (let i = 0; i < index; i++) {
    const si = sentences[i];
    if (si && pathKey(si.headingPath) === key) ordinal++;
  }
  return {
    headingPath: s.headingPath,
    ordinal,
    normHash: sha256Hex(new TextEncoder().encode(s.norm)),
    norm: s.norm,
  };
}

/** Convenience: parse `body` and anchor the sentence at `index`. */
export function anchorForBody(body: string, index: number): SentenceAnchor {
  return anchorForSentence(parsePageSentences(body), index);
}

function jaccard(a: string, b: string): number {
  const sa = new Set(a.split(' ').filter(Boolean));
  const sb = new Set(b.split(' ').filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * Re-resolve an anchor against a (possibly edited) page body.
 * See the module header for the exact-then-fuzzy strategy.
 */
export function reanchor(
  body: string,
  anchor: SentenceAnchor,
  threshold = DEFAULT_FUZZY_THRESHOLD,
): ReanchorResult {
  const sentences = parsePageSentences(body);
  const key = pathKey(anchor.headingPath);
  const inSection: number[] = [];
  for (let i = 0; i < sentences.length; i++) {
    if (pathKey(sentences[i]!.headingPath) === key) inSection.push(i);
  }

  // 1. exact normalized-hash match within the section.
  for (const i of inSection) {
    const s = sentences[i];
    if (s && sha256Hex(new TextEncoder().encode(s.norm)) === anchor.normHash) {
      return { index: i, stale: false };
    }
  }

  // 2. fuzzy match within the section: pick the best above threshold.
  let bestIdx = -1;
  let bestScore = 0;
  for (const i of inSection) {
    const s = sentences[i];
    if (!s) continue;
    const score = jaccard(anchor.norm, s.norm);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx !== -1 && bestScore >= threshold) {
    return { index: bestIdx, stale: false, updated: anchorForSentence(sentences, bestIdx) };
  }

  // 3. stale.
  return { index: null, stale: true };
}
