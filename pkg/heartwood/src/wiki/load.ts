import { rename } from 'node:fs/promises';
import { parseFrontmatter } from './frontmatter';
import { extractWikilinks, extractHeadings } from './wikilinks';
import { sha256Hex } from './hash';
import type { PageRecord, WikiIndex, WikilinkRecord, UnresolvedLink } from './index-schema';

interface RawPage {
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  img: string | null;
  headings: ReturnType<typeof extractHeadings>;
  rawWikilinks: ReturnType<typeof extractWikilinks>;
  contentHash: string;
  byteLength: number;
}

interface LookupMaps {
  titleMap: Map<string, string>;
  aliasMap: Map<string, string>;
  pathSet: Set<string>;
}

export interface LoadOptions {
  contentDir: string;
}

export async function loadWikiIndex({ contentDir }: LoadOptions): Promise<WikiIndex> {
  const raws = await collectPages(contentDir);
  const maps = buildLookupMaps(raws);
  const pages: Record<string, PageRecord> = {};
  const unresolvedLinks: UnresolvedLink[] = [];

  for (const raw of raws) {
    const wikilinks: WikilinkRecord[] = raw.rawWikilinks.map((w) => {
      const resolvedPath = resolveTarget(w.target, maps);
      if (resolvedPath === null) {
        unresolvedLinks.push({ sourcePath: raw.path, raw: w.raw, target: w.target });
      }
      return {
        raw: w.raw,
        target: w.target,
        display: w.display ?? null,
        section: w.section ?? null,
        resolvedPath,
      };
    });
    pages[raw.path] = {
      path: raw.path,
      title: raw.title,
      aliases: raw.aliases,
      tags: raw.tags,
      img: raw.img,
      headings: raw.headings,
      wikilinks,
      contentHash: raw.contentHash,
      byteLength: raw.byteLength,
      summary: null,
      keyFacts: null,
      entities: null,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    pageCount: raws.length,
    pages,
    unresolvedLinks,
  };
}

async function collectPages(contentDir: string): Promise<RawPage[]> {
  const glob = new Bun.Glob('**/*.md');
  const paths: string[] = [];
  for await (const p of glob.scan({ cwd: contentDir, absolute: false })) {
    // Script/ holds quartz-generated transcript pages (content/wiki/Script),
    // not hand-maintained wiki articles — exclude them from the wiki index.
    if (p.startsWith('Script/')) continue;
    paths.push(p);
  }
  paths.sort();
  const out: RawPage[] = [];
  for (const path of paths) {
    out.push(await parseOnePage(contentDir, path));
  }
  return out;
}

async function parseOnePage(contentDir: string, path: string): Promise<RawPage> {
  const file = Bun.file(`${contentDir}/${path}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder('utf-8').decode(bytes);
  const { data, body } = parseFrontmatter(text, path);
  const title = pickTitle(data, path);
  const aliases = pickStringArray(data, 'aliases');
  const tags = pickStringArray(data, 'tags');
  const img = typeof data.img === 'string' ? data.img : null;
  const rawWikilinks = extractWikilinks(text);
  const headings = extractHeadings(body);
  return {
    path,
    title,
    aliases,
    tags,
    img,
    headings,
    rawWikilinks,
    contentHash: sha256Hex(bytes),
    byteLength: bytes.byteLength,
  };
}

function pickTitle(data: Record<string, unknown>, path: string): string {
  if (typeof data.title === 'string' && data.title.trim()) return data.title.trim();
  const parts = path.split('/');
  const base = parts.pop()!.replace(/\.md$/, '');
  if (base === 'index') return parts.pop() ?? 'index';
  return base;
}

function pickStringArray(data: Record<string, unknown>, key: string): string[] {
  const v = data[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function buildLookupMaps(raws: RawPage[]): LookupMaps {
  const titleMap = new Map<string, string>();
  const aliasMap = new Map<string, string>();
  const pathSet = new Set<string>();
  for (const raw of raws) {
    pathSet.add(raw.path);
    if (!titleMap.has(raw.title)) titleMap.set(raw.title, raw.path);
    for (const alias of raw.aliases) {
      if (!aliasMap.has(alias)) aliasMap.set(alias, raw.path);
    }
  }
  return { titleMap, aliasMap, pathSet };
}

function resolveTarget(target: string, { titleMap, aliasMap, pathSet }: LookupMaps): string | null {
  if (target.includes('/')) {
    const withExt = target.endsWith('.md') ? target : `${target}.md`;
    return pathSet.has(withExt) ? withExt : null;
  }
  return titleMap.get(target) ?? aliasMap.get(target) ?? null;
}

export async function writeIndex(index: WikiIndex, indexPath: string): Promise<void> {
  const tmp = `${indexPath}.tmp`;
  await Bun.write(tmp, JSON.stringify(index, null, 2) + '\n');
  await rename(tmp, indexPath);
}

export function mergeIndex(fresh: WikiIndex, ondisk: WikiIndex): WikiIndex {
  const pages: Record<string, PageRecord> = {};
  for (const [path, page] of Object.entries(fresh.pages)) {
    const stored = ondisk.pages[path];
    if (stored && stored.contentHash === page.contentHash && stored.summary !== null) {
      pages[path] = { ...page, summary: stored.summary, keyFacts: stored.keyFacts, entities: stored.entities };
    } else {
      pages[path] = page;
    }
  }
  return { ...fresh, pages };
}

export interface StaleResult {
  stale: boolean;
  added: string[];
  removed: string[];
  changed: string[];
}

export async function diffIndex(fresh: WikiIndex, indexPath: string): Promise<StaleResult> {
  const file = Bun.file(indexPath);
  if (!(await file.exists())) {
    return { stale: true, added: Object.keys(fresh.pages).sort(), removed: [], changed: [] };
  }
  const ondisk = JSON.parse(await file.text()) as WikiIndex;
  const freshPaths = new Set(Object.keys(fresh.pages));
  const ondiskPaths = new Set(Object.keys(ondisk.pages));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const p of freshPaths) if (!ondiskPaths.has(p)) added.push(p);
  for (const p of ondiskPaths) if (!freshPaths.has(p)) removed.push(p);
  for (const p of freshPaths) {
    if (!ondiskPaths.has(p)) continue;
    const a = fresh.pages[p]!;
    const b = ondisk.pages[p]!;
    if (a.contentHash !== b.contentHash) changed.push(p);
  }
  added.sort(); removed.sort(); changed.sort();
  const stale = added.length + removed.length + changed.length > 0;
  return { stale, added, removed, changed };
}
