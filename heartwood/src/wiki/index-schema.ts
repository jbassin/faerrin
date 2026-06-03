import type { Heading } from './wikilinks';

export interface Entities {
  people: string[];
  places: string[];
  orgs: string[];
}

export interface WikilinkRecord {
  raw: string;
  target: string;
  display: string | null;
  section: string | null;
  resolvedPath: string | null;
}

export interface PageRecord {
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  img: string | null;
  headings: Heading[];
  wikilinks: WikilinkRecord[];
  contentHash: string;
  byteLength: number;
  summary: string | null;
  keyFacts: string[] | null;
  entities: Entities | null;
}

export interface UnresolvedLink {
  sourcePath: string;
  raw: string;
  target: string;
}

export interface WikiIndex {
  generatedAt: string;
  pageCount: number;
  pages: Record<string, PageRecord>;
  unresolvedLinks: UnresolvedLink[];
}
