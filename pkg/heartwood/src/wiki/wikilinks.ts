export interface WikilinkOccurrence {
  raw: string;
  target: string;
  display?: string;
  section?: string;
}

const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g;

export function extractWikilinks(text: string): WikilinkOccurrence[] {
  const out: WikilinkOccurrence[] = [];
  for (const m of text.matchAll(WIKILINK_RE)) {
    const inner = m[1]!;
    const pipeIdx = inner.indexOf('|');
    const before = pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner;
    const display = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : undefined;
    const hashIdx = before.indexOf('#');
    const target = (hashIdx >= 0 ? before.slice(0, hashIdx) : before).trim();
    const section = hashIdx >= 0 ? before.slice(hashIdx + 1).trim() : undefined;
    out.push({
      raw: m[0]!,
      target,
      ...(display !== undefined ? { display } : {}),
      ...(section !== undefined ? { section } : {}),
    });
  }
  return out;
}

export interface Heading {
  level: number;
  text: string;
}

const HEADING_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*$/gm;

export function extractHeadings(body: string): Heading[] {
  const out: Heading[] = [];
  for (const m of body.matchAll(HEADING_RE)) {
    out.push({ level: m[1]!.length, text: m[2]! });
  }
  return out;
}
