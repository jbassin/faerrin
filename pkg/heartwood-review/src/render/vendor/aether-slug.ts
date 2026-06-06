// @ts-nocheck — VENDORED VERBATIM from pkg/aether/src/lib/slug.ts.
// Why vendored (not deep-imported like the .mjs plugins): slug.ts is TypeScript
// source, so importing it pulls aether's file into THIS project's strict program
// (noUncheckedIndexedAccess) and reports errors in a file we must not edit (it is
// the byte-critical, Quartz-ported slug logic). Kept honest by aether-slug.drift.test.ts,
// which fails if this copy diverges from aether's source.
//<<<AETHER-SLUG-VERBATIM>>>
/**
 * Canonical slug logic — the single source of truth for page URLs.
 *
 * Ported VERBATIM from Quartz's `quartz/util/path.ts` so the Astro rebuild
 * produces byte-identical URLs to the current site. DO NOT "improve" these:
 * any change to casing/punctuation handling silently breaks every internal
 * link, alias redirect, sitemap entry, and inbound bookmark.
 *
 * Key fact: Quartz slugs PAGE PATHS with `sluggify` (below), which preserves
 * case, commas, apostrophes, periods, and Unicode. `github-slugger` is used by
 * Quartz ONLY for heading anchors, never for page paths.
 *
 * This module is isomorphic (no node builtins) so both the `scripts/` pipeline
 * and the Astro build can import it.
 *
 * Source: quartz/util/path.ts @ content SHA 511d1d1 (verified against
 * public/static/contentIndex.json — see migration/parity-slugs.ts and
 * migration/parity-graph.ts).
 */
import { slug as slugAnchor } from "github-slugger"

// Branded slug types, mirrored from Quartz for parity with its call sites.
type SlugLike<T> = string & { __brand: T }
/** Cannot be relative and must have a file extension. */
export type FilePath = SlugLike<"filepath">
/** No leading/trailing slashes; may end in `index`. The most general slug. */
export type FullSlug = SlugLike<"full">
/** No `/index` ending and no file extension; may have a trailing slash for folders. */
export type SimpleSlug = SlugLike<"simple">
/** Found on hrefs or constructed for client-side navigation. */
export type RelativeURL = SlugLike<"relative">

export interface TransformOptions {
  strategy: "absolute" | "relative" | "shortest"
  allSlugs: FullSlug[]
}

export function sluggify(s: string): string {
  return s
    .split("/")
    .map((segment) =>
      segment
        .replace(/\s/g, "-")
        .replace(/&/g, "-and-")
        .replace(/%/g, "-percent")
        .replace(/\?/g, "")
        .replace(/#/g, ""),
    )
    .join("/") // always use / as sep
    .replace(/\/$/, "")
}

export function slugifyFilePath(fp: FilePath, excludeExt?: boolean): FullSlug {
  fp = stripSlashes(fp) as FilePath
  let ext = getFileExtension(fp)
  const withoutFileExt = fp.replace(new RegExp(ext + "$"), "")
  if (excludeExt || [".md", ".html", undefined].includes(ext)) {
    ext = ""
  }

  let slug = sluggify(withoutFileExt)

  // treat _index as index
  if (endsWith(slug, "_index")) {
    slug = slug.replace(/_index$/, "index")
  }

  return (slug + ext) as FullSlug
}

export function simplifySlug(fp: FullSlug): SimpleSlug {
  const res = stripSlashes(trimSuffix(fp, "index"), true)
  return (res.length === 0 ? "/" : res) as SimpleSlug
}

export function endsWith(s: string, suffix: string): boolean {
  return s === suffix || s.endsWith("/" + suffix)
}

export function trimSuffix(s: string, suffix: string): string {
  if (endsWith(s, suffix)) {
    s = s.slice(0, -suffix.length)
  }
  return s
}

export function getFileExtension(s: string): string | undefined {
  return s.match(/\.[A-Za-z0-9]+$/)?.[0]
}

export function stripSlashes(s: string, onlyStripPrefix?: boolean): string {
  if (s.startsWith("/")) {
    s = s.substring(1)
  }

  if (!onlyStripPrefix && s.endsWith("/")) {
    s = s.slice(0, -1)
  }

  return s
}

// ---------------------------------------------------------------------------
// Link resolution — ported verbatim from quartz/util/path.ts so the wikilink
// "shortest" strategy and edge normalization match Quartz exactly. This is the
// hardest correctness surface in the migration (see the debate synthesis,
// docs/refactor-plan.md §10). Anchors use github-slugger (as Quartz does), but
// ONLY for the `#fragment` half of a link — never for page paths.
// ---------------------------------------------------------------------------

export function splitAnchor(link: string): [string, string] {
  let [fp, anchor] = link.split("#", 2)
  if (fp.endsWith(".pdf")) {
    return [fp, anchor === undefined ? "" : `#${anchor}`]
  }
  anchor = anchor === undefined ? "" : "#" + slugAnchor(anchor)
  return [fp, anchor]
}

export function slugTag(tag: string): string {
  return tag
    .split("/")
    .map((tagSegment) => sluggify(tagSegment))
    .join("/")
}

export function joinSegments(...args: string[]): string {
  if (args.length === 0) {
    return ""
  }

  let joined = args
    .filter((segment) => segment !== "" && segment !== "/")
    .map((segment) => stripSlashes(segment))
    .join("/")

  // if the first segment starts with a slash, add it back
  if (args[0].startsWith("/")) {
    joined = "/" + joined
  }

  // if the last segment is a folder, add a trailing slash
  if (args[args.length - 1].endsWith("/")) {
    joined = joined + "/"
  }

  return joined
}

// resolve /a/b/c to ../..
export function pathToRoot(slug: FullSlug): RelativeURL {
  let rootPath = slug
    .split("/")
    .filter((x) => x !== "")
    .slice(0, -1)
    .map((_) => "..")
    .join("/")

  if (rootPath.length === 0) {
    rootPath = "."
  }

  return rootPath as RelativeURL
}

export function resolveRelative(current: FullSlug, target: FullSlug | SimpleSlug): RelativeURL {
  const res = joinSegments(pathToRoot(current), simplifySlug(target as FullSlug)) as RelativeURL
  return res
}

export function transformInternalLink(link: string): RelativeURL {
  let [fplike, anchor] = splitAnchor(decodeURI(link))

  const folderPath = isFolderPath(fplike)
  let segments = fplike.split("/").filter((x) => x.length > 0)
  let prefix = segments.filter(isRelativeSegment).join("/")
  let fp = segments.filter((seg) => !isRelativeSegment(seg) && seg !== "").join("/")

  // manually add ext here as we want to not strip 'index' if it has an extension
  const simpleSlug = simplifySlug(slugifyFilePath(fp as FilePath))
  const joined = joinSegments(stripSlashes(prefix), stripSlashes(simpleSlug))
  const trail = folderPath ? "/" : ""
  const res = (_addRelativeToStart(joined) + trail + anchor) as RelativeURL
  return res
}

export function transformLink(src: FullSlug, target: string, opts: TransformOptions): RelativeURL {
  let targetSlug = transformInternalLink(target)

  if (opts.strategy === "relative") {
    return targetSlug as RelativeURL
  } else {
    const folderTail = isFolderPath(targetSlug) ? "/" : ""
    const canonicalSlug = stripSlashes(targetSlug.slice(".".length))
    let [targetCanonical, targetAnchor] = splitAnchor(canonicalSlug)

    if (opts.strategy === "shortest") {
      // if the file name is unique, then it's just the filename
      const matchingFileNames = opts.allSlugs.filter((slug) => {
        const parts = slug.split("/")
        const fileName = parts.at(-1)
        return targetCanonical === fileName
      })

      // only match, just use it
      if (matchingFileNames.length === 1) {
        const targetSlug = matchingFileNames[0]
        return (resolveRelative(src, targetSlug) + targetAnchor) as RelativeURL
      }
    }

    // if it's not unique, then it's the absolute path from the vault root
    return (joinSegments(pathToRoot(src), canonicalSlug) + folderTail) as RelativeURL
  }
}

export function isFolderPath(fplike: string): boolean {
  return (
    fplike.endsWith("/") ||
    endsWith(fplike, "index") ||
    endsWith(fplike, "index.md") ||
    endsWith(fplike, "index.html")
  )
}

function isRelativeSegment(s: string): boolean {
  return /^\.{0,2}$/.test(s)
}

function _addRelativeToStart(s: string): string {
  if (s === "") {
    s = "."
  }

  if (!s.startsWith(".")) {
    s = joinSegments(".", s)
  }

  return s
}
