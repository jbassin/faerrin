/**
 * Build-time site index: the data the static components and list pages need but
 * Astro's content collection doesn't give directly — resolved outgoing links,
 * a reverse backlink index, git "modified" dates, normalized frontmatter, and
 * breadcrumb ancestry.
 *
 * Link resolution reuses the SAME shared resolver (src/lib/slug.ts) and the
 * exact edge-derivation proven byte-faithful to Quartz by migration/parity-graph.ts.
 * Backlinks therefore reproduce Quartz's `file.links`-based backlink set.
 *
 * Pure build-time (Node) — safe to use node:fs / node:child_process here.
 */
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getCollection } from "astro:content"
import { folderIndexName } from "../../../shared-content/scripts/lib/folder-index.ts"
import {
  isFolderPath,
  pathToRoot,
  resolveRelative,
  simplifySlug,
  slugifyFilePath,
  slugTag,
  splitAnchor,
  stripSlashes,
  transformLink,
  type FilePath,
  type FullSlug,
  type RelativeURL,
  type SimpleSlug,
} from "./slug.ts"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "../..")

export interface SiteDoc {
  /** content-relative path with .md, e.g. "Divinity/Inner Gods.md" */
  rel: string
  slug: FullSlug
  simple: SimpleSlug
  title: string
  tags: string[]
  aliases: string[]
  img?: string
  /** resolved outgoing internal edges (deduped, normalized SimpleSlugs) */
  links: SimpleSlug[]
  /** git "modified" date (most recent commit touching the file), if any */
  date?: Date
  /** the Astro collection entry, for render() */
  entry: Awaited<ReturnType<typeof getCollection<"docs">>>[number]
}

const toArray = (v: unknown): string[] =>
  v == null ? [] : Array.isArray(v) ? v.map(String) : [String(v)]

// ── link extraction (ported verbatim from migration/parity-graph.ts) ──────────
const wikilinkRegex = /!?\[\[([^\[\]\|\#]+)?(#+[^\[\]\|\#]+)?(\\?\|[^\[\]\#]+)?\]\]/g
const mdLinkRegex = /\[(?:[^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

function isAbsoluteUrl(s: string): boolean {
  try {
    new URL(s)
    return true
  } catch {
    return false
  }
}

function resolveEdge(src: FullSlug, rawTarget: string, allSlugs: FullSlug[]): SimpleSlug | null {
  const [fpOnly] = splitAnchor(decodeURI(rawTarget))
  if (fpOnly.split("/").every((s) => s === "" || /^\.{1,2}$/.test(s))) return null
  const dest = transformLink(src, rawTarget, { strategy: "shortest", allSlugs })
  if (isAbsoluteUrl(dest) || dest.startsWith("#")) return null
  const base = "https://base.com/" + stripSlashes(simplifySlug(src), true)
  const url = new URL(dest, base)
  let [destCanonical] = splitAnchor(url.pathname)
  if (destCanonical.endsWith("/")) destCanonical += "index"
  const full = decodeURIComponent(stripSlashes(destCanonical, true)) as FullSlug
  return simplifySlug(full)
}

function extractTargets(md: string): string[] {
  const targets: string[] = []
  for (const m of md.matchAll(wikilinkRegex)) {
    const fp = m[1]?.trim()
    if (fp) targets.push(fp)
  }
  for (const m of md.matchAll(mdLinkRegex)) {
    const url = m[1]
    if (!url || isAbsoluteUrl(url) || url.startsWith("#") || url.startsWith("mailto:")) continue
    targets.push(url)
  }
  return targets
}

// ── git "modified" dates ──────────────────────────────────────────────────────
// Quartz's CreatedModifiedDate uses priority [frontmatter, git, filesystem]; no
// content file sets a date in frontmatter, so the modified date is the author
// date of the most recent commit touching the file. One log pass over content/
// gives the newest date per path (core.quotepath=false keeps Unicode literal).
let gitDateCache: Map<string, Date> | null = null
function gitModifiedDates(): Map<string, Date> {
  if (gitDateCache) return gitDateCache
  const map = new Map<string, Date>()
  try {
    const out = execFileSync(
      "git",
      ["-c", "core.quotepath=false", "log", "--format=@%aI", "--name-only", "--", "content"],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    )
    let current: Date | null = null
    for (const line of out.split("\n")) {
      if (line.startsWith("@")) {
        current = new Date(line.slice(1))
      } else if (line.startsWith("content/") && current) {
        const rel = line.slice("content/".length)
        if (!map.has(rel)) map.set(rel, current) // first = newest
      }
    }
  } catch {
    // no git history available (e.g. shallow CI) — dates simply omitted
  }
  gitDateCache = map
  return map
}

// ── the index ──────────────────────────────────────────────────────────────────
let cache: Promise<SiteData> | null = null

export interface SiteData {
  docs: SiteDoc[]
  bySlug: Map<FullSlug, SiteDoc>
  allSlugs: FullSlug[]
  /** simplified-slug -> docs that link TO it (Quartz backlink semantics) */
  backlinks: Map<SimpleSlug, SiteDoc[]>
}

export function loadSite(): Promise<SiteData> {
  return (cache ??= build())
}

async function build(): Promise<SiteData> {
  const entries = await getCollection("docs")
  const relOf = (e: (typeof entries)[number]) =>
    (e.filePath ?? e.id).split("shared-content/wiki/").at(-1) as string
  const dates = gitModifiedDates()

  // pass 1: slugs (needed as the allSlugs set for "shortest" resolution)
  const allSlugs = entries.map((e) => slugifyFilePath(relOf(e) as FilePath))

  // pass 2: build docs with resolved links
  const docs: SiteDoc[] = entries.map((e, i) => {
    const rel = relOf(e)
    const slug = allSlugs[i]
    const fm = (e.data ?? {}) as Record<string, unknown>
    // Title fallback matches Quartz's FrontMatter transformer: file.stem — the
    // filename without extension, spaces/case PRESERVED (not the dashed slug).
    // Folder index pages fall back to their parent directory name instead of the
    // literal "index" (and pick it up as an implicit alias below), so the name
    // need not be duplicated in every index.md's frontmatter.
    const stem = path.basename(rel, ".md")
    const folderName = folderIndexName(rel)
    const got = new Set<SimpleSlug>()
    for (const t of extractTargets(e.body ?? "")) {
      const edge = resolveEdge(slug, t, allSlugs)
      if (edge) got.add(edge)
    }
    return {
      rel,
      slug,
      simple: simplifySlug(slug),
      title: (fm.title as string) ?? folderName ?? stem,
      tags: toArray(fm.tags),
      aliases: [...new Set([...toArray(fm.aliases), ...(folderName ? [folderName] : [])])],
      img: fm.img as string | undefined,
      links: [...got],
      date: dates.get(rel),
      entry: e,
    }
  })

  const bySlug = new Map(docs.map((d) => [d.slug, d]))

  // reverse backlink index. Quartz's Backlinks does an EXACT
  // `file.links.includes(simplifySlug(fileData.slug))`, so we key by the resolved
  // edge form verbatim (no trailing-slash normalization). This faithfully
  // reproduces Quartz — including its quirk that a depth-1 folder index
  // (simplifySlug "Divinity/") gets no backlinks from `[[Divinity]]`-style links
  // that resolve to "Divinity" (no slash).
  const backlinks = new Map<SimpleSlug, SiteDoc[]>()
  for (const d of docs) {
    for (const target of d.links) {
      const list = backlinks.get(target) ?? []
      list.push(d)
      backlinks.set(target, list)
    }
  }

  return { docs, bySlug, allSlugs, backlinks }
}

export function backlinksFor(site: SiteData, slug: FullSlug): SiteDoc[] {
  // Exact match on simplifySlug(slug), mirroring Quartz's file.links.includes(...).
  return site.backlinks.get(simplifySlug(slug)) ?? []
}

// ── breadcrumbs ─────────────────────────────────────────────────────────────────
export interface Crumb {
  displayName: string
  path: RelativeURL | ""
}

/**
 * Quartz Breadcrumbs: Home ❯ …folders… ❯ current. A folder crumb's display name
 * is the folder index page's title when present (resolveFrontmatterTitle: true),
 * else the dash→space folder segment. Index pages collapse onto their folder
 * (no separate "index" crumb). The current crumb has an empty path. Every name
 * gets `replaceAll("-", " ")` exactly as formatCrumb does.
 */
export function breadcrumbsFor(
  site: SiteData,
  slug: FullSlug,
  currentTitle: string,
  rootName = "Home",
): Crumb[] {
  let parts = slug.split("/")
  if (parts.at(-1) === "index") parts = parts.slice(0, -1) // folder index → folder

  const crumbs: Crumb[] = [
    { displayName: rootName, path: parts.length ? resolveRelative(slug, "/" as SimpleSlug) : "" },
  ]

  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1
    const prefix = parts.slice(0, i + 1).join("/")
    let displayName: string
    if (isLast) {
      displayName = currentTitle
    } else {
      const folderIndex = site.bySlug.get(`${prefix}/index` as FullSlug)
      displayName = folderIndex?.title ?? parts[i]
    }
    const targetSimple = (isLast ? simplifySlug(slug) : `${prefix}/`) as SimpleSlug
    crumbs.push({
      displayName: displayName.replaceAll("-", " "),
      path: isLast ? "" : resolveRelative(slug, targetSimple),
    })
  }
  return crumbs
}

// ── folders & tags (for list pages) ─────────────────────────────────────────────
export interface PageEntry {
  slug: FullSlug
  title: string
  tags: string[]
  date?: Date
  isFolder: boolean
}

function dirnameSlug(slug: string): string {
  const i = slug.lastIndexOf("/")
  return i === -1 ? "." : slug.slice(0, i)
}

/**
 * Every folder that should get a listing page, matching Quartz FolderPage's
 * `_getFolders`: the dirname chain of every page, excluding the root "." and the
 * synthetic "tags" namespace. Returned as SimpleSlugs (no trailing /index).
 */
export function allFolders(site: SiteData): string[] {
  const folders = new Set<string>()
  for (const d of site.docs) {
    let f = dirnameSlug(d.slug)
    while (f !== ".") {
      if (f && f !== "tags") folders.add(f)
      f = dirnameSlug(f)
    }
  }
  return [...folders].sort()
}

/** Folder page title: the index.md title if present, else "Folder: <slug>". */
export function folderTitle(site: SiteData, folderSlug: string): string {
  const idx = site.bySlug.get(`${folderSlug}/index` as FullSlug)
  return idx?.title ?? `Folder: ${folderSlug}`
}

/**
 * Direct children of a folder, matching Quartz FolderContent (trie children):
 * files directly in the folder + immediate subfolders (one entry each). A
 * subfolder with an index.md is listed via that page; otherwise it gets a
 * synthetic entry named from the folder segment with the most-recent descendant
 * date. The folder's own index.md is NOT listed as a child.
 */
export function listFolderChildren(site: SiteData, folderSlug: string): PageEntry[] {
  const out: PageEntry[] = []
  const seenSub = new Set<string>()
  const prefix = folderSlug + "/"

  for (const d of site.docs) {
    const dir = dirnameSlug(d.slug)
    if (dir === folderSlug) {
      if (d.slug === `${folderSlug}/index`) continue // the folder itself
      out.push({ slug: d.slug, title: d.title, tags: d.tags, date: d.date, isFolder: false })
    } else if (d.slug.startsWith(prefix)) {
      const immediate = d.slug.slice(prefix.length).split("/")[0]
      const subSlug = `${folderSlug}/${immediate}`
      if (seenSub.has(subSlug)) continue
      seenSub.add(subSlug)
      const idx = site.bySlug.get(`${subSlug}/index` as FullSlug)
      if (idx) {
        out.push({
          slug: idx.slug,
          title: idx.title,
          tags: idx.tags,
          date: idx.date,
          isFolder: true,
        })
      } else {
        // most-recent date among descendants of this subfolder
        let date: Date | undefined
        for (const e of site.docs) {
          if (e.slug.startsWith(subSlug + "/") && e.date && (!date || e.date > date)) date = e.date
        }
        out.push({
          slug: subSlug as FullSlug,
          title: immediate.replaceAll("-", " "),
          tags: [],
          date,
          isFolder: true,
        })
      }
    }
  }
  return sortEntries(out)
}

/** Ports PageList byDateAndAlphabeticalFolderFirst: folders first, then date desc, then title. */
export function sortEntries(entries: PageEntry[]): PageEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isFolder && !b.isFolder) return -1
    if (!a.isFolder && b.isFolder) return 1
    if (a.date && b.date) return b.date.getTime() - a.date.getTime()
    if (a.date && !b.date) return -1
    if (!a.date && b.date) return 1
    return a.title.toLowerCase().localeCompare(b.title.toLowerCase())
  })
}

/** ["a/b/c"] -> ["a","a/b","a/b/c"] (Quartz getAllSegmentPrefixes). */
export function getAllSegmentPrefixes(tag: string): string[] {
  const segments = tag.split("/")
  return segments.map((_, i) => segments.slice(0, i + 1).join("/"))
}

/** All tags (with hierarchical prefixes), sorted. */
export function allTags(site: SiteData): string[] {
  const tags = new Set<string>()
  for (const d of site.docs)
    for (const t of d.tags) for (const p of getAllSegmentPrefixes(t)) tags.add(p)
  return [...tags].sort((a, b) => a.localeCompare(b))
}

/** Pages carrying a tag (or a parent of it), as sorted PageEntries. */
export function pagesWithTag(site: SiteData, tag: string): PageEntry[] {
  const entries = site.docs
    .filter((d) => d.tags.flatMap(getAllSegmentPrefixes).includes(tag))
    .map((d) => ({ slug: d.slug, title: d.title, tags: d.tags, date: d.date, isFolder: false }))
  return sortEntries(entries)
}

// ── Explorer tree (build-time) ──────────────────────────────────────────────────
export interface TreeNode {
  slug: FullSlug
  displayName: string
  isFolder: boolean
  children: TreeNode[]
}

/**
 * Build the Explorer file tree at build time from the content collection,
 * replacing Quartz's runtime fetchData + FileTrie + serialized-fn machinery. A
 * folder with an index.md takes that page's title as its display name; the
 * "tags" namespace and the home page are excluded (matching Quartz's filterFn /
 * trie root). Sorted folders-first then alphabetical (numeric, case-insensitive),
 * matching Explorer.tsx defaultOptions.sortFn.
 */
export function buildExplorerTree(site: SiteData): TreeNode[] {
  const root: TreeNode = { slug: "" as FullSlug, displayName: "", isFolder: true, children: [] }
  const folders = new Map<string, TreeNode>([["", root]])

  const ensureFolder = (path: string): TreeNode => {
    const existing = folders.get(path)
    if (existing) return existing
    const cut = path.lastIndexOf("/")
    const parent = ensureFolder(cut === -1 ? "" : path.slice(0, cut))
    const seg = cut === -1 ? path : path.slice(cut + 1)
    const node: TreeNode = {
      slug: path as FullSlug,
      displayName: seg.replaceAll("-", " "),
      isFolder: true,
      children: [],
    }
    parent.children.push(node)
    folders.set(path, node)
    return node
  }

  for (const d of site.docs) {
    if (d.slug === "index" || d.slug.startsWith("tags/")) continue
    if (d.slug.endsWith("/index")) {
      ensureFolder(d.slug.slice(0, -"/index".length)).displayName = d.title
    } else {
      const cut = d.slug.lastIndexOf("/")
      const parent = ensureFolder(cut === -1 ? "" : d.slug.slice(0, cut))
      parent.children.push({ slug: d.slug, displayName: d.title, isFolder: false, children: [] })
    }
  }

  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
      return a.displayName.localeCompare(b.displayName, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    })
    for (const n of nodes) if (n.isFolder) sortRec(n.children)
  }
  sortRec(root.children)
  return root.children
}

export { isFolderPath, resolveRelative, simplifySlug, slugTag, pathToRoot }
