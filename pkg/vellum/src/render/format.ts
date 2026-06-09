/**
 * Canonical → VSS formatter (VSS spec Phase 3). A pure, total
 * `source → source` pass that rewrites canonical `:::`-directive structure
 * into the VSS authoring surface (`@kind "Title" |attrs { body }`,
 * `@columns [ {…} {…} ]`). Together with `compileVss` (re-exported here as
 * `vssToCanonical`) it restores two-way travel between the surfaces, so a
 * VSS-authored doc can be exported portable (AD-6) and a canonical doc can be
 * upgraded to the brace surface.
 *
 * **Conservative by design.** A construct is converted only when the result
 * provably round-trips — `parseDocument(canonicalToVss(x))` must deep-equal
 * `parseDocument(x)`. Anything ambiguous is left canonical, verbatim:
 *
 *  - unknown directive names (they're prose to vellum anyway);
 *  - attributes VSS can't express: empty values, values containing `"`/`}`,
 *    values whose comma spacing isn't already VSS-normal (`a, b` ≠ `a,b`),
 *    `#id`/`.class` shorthands, valueless keys;
 *  - `:::columns` carrying attributes (VSS `@columns` has no attr syntax);
 *  - `---` dividers that could be setext underlines, and `***`/`___` breaks;
 *  - bodies with brace-bearing indented code (the documented VSS limitation);
 *  - any construct whose body still contains canonical `:::` fences after
 *    recursion (they'd be rejected inside a VSS body, E14).
 *
 * Bare `{`/`}` in converted bodies are backslash-escaped (code-span/fence
 * aware) so the VSS brace matcher reads them as literal — CommonMark renders
 * `\{` as `{`, so the parsed model is unchanged.
 */

import { DOCUMENT_KINDS } from "./model.ts";

export { compileVss as vssToCanonical } from "./vss.ts";

const KINDS = new Set<string>(DOCUMENT_KINDS);

/** `:::kind[Label]{attrs}` opener, exactly one line, fence at column 0. */
const OPENER = /^(:{3,})([A-Za-z][\w-]*)(\[.*\])?(\{.*\})?\s*$/;
/** Any fence-looking line (an unconvertible one taints the region: E14). */
const FENCEISH = /^:{3,}/;
/** Code-fence opener: ≥3 backticks or tildes, ≤3 spaces of indent. */
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})/;
const BLANK = /^\s*$/;
/** A `---` thematic break (dash form; the columns divider). */
const DASH_BREAK = /^ {0,3}(?:-[ \t]*){3,}$/;
/** `***` / `___` thematic breaks — also column splits in the model; bail. */
const OTHER_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
/** Indented-code line carrying a brace — escape-unsafe (VSS limitation). */
const INDENT_BRACE = /^(?: {4}|\t)/;

interface Region {
  lines: string[];
  /** Canonical `:::` fences remain — can't be embedded in VSS braces (E14). */
  impure: boolean;
  /** Saw a brace on an indented-code-looking line — escaping is unsafe. */
  unsafe: boolean;
}

/** Convert canonical `:::` structure in `source` to VSS. Pure & total. */
export function canonicalToVss(source: string): string {
  try {
    return convertRegion(source.split("\n"), false).lines.join("\n");
  } catch {
    return source; // R-4 spirit: a formatter bug must never eat a document
  }
}

/**
 * Convert every safely-convertible construct in a run of lines. When `embed`
 * is set the result will live inside VSS braces, so passthrough markdown gets
 * its bare braces escaped and the purity/safety flags matter.
 */
function convertRegion(src: string[], embed: boolean): Region {
  const out: string[] = [];
  let impure = false;
  let unsafe = false;
  let fence: { ch: string; len: number } | null = null;
  const span = { open: 0 }; // backtick code-span state, carried across lines

  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;

    if (fence) {
      out.push(line); // verbatim — code is never escaped or scanned
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const cf = CODE_FENCE.exec(line);
    if (cf) {
      fence = { ch: cf[1]![0]!, len: cf[1]!.length };
      out.push(line);
      continue;
    }

    const open = OPENER.exec(line);
    if (open && (KINDS.has(open[2]!) || open[2] === "columns")) {
      const colons = open[1]!.length;
      const close = findCloser(src, i + 1, colons);
      if (close !== -1) {
        const body = src.slice(i + 1, close);
        const converted =
          open[2] === "columns"
            ? convertColumns(open[4], body)
            : convertBlock(open[2]!, open[3], open[4], body);
        if (converted) {
          out.push(...converted);
          span.open = 0; // spans can't legally cross a construct boundary
          i = close;
          continue;
        }
      }
      // Unconvertible: emit the whole construct verbatim (don't convert its
      // children either — partial conversion could break the colon invariant).
      const end = close === -1 ? src.length - 1 : close;
      for (let k = i; k <= end; k++) out.push(src[k]!);
      impure = true;
      i = end;
      continue;
    }

    if (FENCEISH.test(line)) impure = true; // stray closer / unknown directive
    if (embed && INDENT_BRACE.test(line) && /[{}]/.test(line)) unsafe = true;
    out.push(embed ? escapeBraces(line, span) : line);
  }

  return { lines: out, impure, unsafe };
}

/** Does `line` close the open code fence (same char, ≥ length, ws-only rest)? */
function closesFence(line: string, fence: { ch: string; len: number }): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return m !== null && m[1]![0] === fence.ch && m[1]!.length >= fence.len;
}

/** Find the exact-colon-count closing fence, skipping code-fenced lines. */
function findCloser(src: string[], from: number, colons: number): number {
  const exact = new RegExp(`^:{${colons}}\\s*$`);
  let fence: { ch: string; len: number } | null = null;
  for (let j = from; j < src.length; j++) {
    const line = src[j]!;
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const cf = CODE_FENCE.exec(line);
    if (cf) {
      fence = { ch: cf[1]![0]!, len: cf[1]!.length };
      continue;
    }
    if (exact.test(line)) return j;
  }
  return -1;
}

/** Convert one `:::kind` block, or return null to leave it canonical. */
function convertBlock(
  kind: string,
  labelGroup: string | undefined,
  attrGroup: string | undefined,
  body: string[],
): string[] | null {
  const attrs = parseAttrs(attrGroup);
  if (attrs === null) return null;

  const inner = convertRegion(body, true);
  if (inner.impure || inner.unsafe) return null;

  const title = labelGroup
    ? labelGroup.slice(1, -1).replace(/\\([[\]])/g, "$1")
    : "";

  const out: string[] = [`@${kind} "${title.replace(/"/g, '\\"')}"`];
  for (const [key, value] of attrs) out.push(`| ${key}: ${value}`);
  out.push("{", ...trimBlank(inner.lines), "}");
  return out;
}

/** Convert one `:::columns` layout, or return null to leave it canonical. */
function convertColumns(
  attrGroup: string | undefined,
  body: string[],
): string[] | null {
  const attrs = parseAttrs(attrGroup);
  if (attrs === null || attrs.length > 0) return null; // VSS @columns has no attrs

  const groups = splitColumns(body);
  if (groups === null) return null;

  const out: string[] = ["@columns ["];
  for (const group of groups) {
    const inner = convertRegion(group, true);
    if (inner.impure || inner.unsafe) return null;
    out.push("{", ...trimBlank(inner.lines), "}");
  }
  out.push("]");
  return out;
}

/**
 * Split a `:::columns` body into column groups, mirroring `parseColumns`:
 * explicit `:::column` children win (stray content between them is ignored by
 * the parser, so dropping it is model-equal); otherwise split on top-level
 * `---` thematic breaks. Returns null when classification is ambiguous.
 */
function splitColumns(body: string[]): string[][] | null {
  // Pass 1: explicit `:::column` containers.
  const explicit: string[][] = [];
  let sawStray = false;
  let fence: { ch: string; len: number } | null = null;
  for (let i = 0; i < body.length; i++) {
    const line = body[i]!;
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      sawStray = true;
      continue;
    }
    const cf = CODE_FENCE.exec(line);
    if (cf) {
      fence = { ch: cf[1]![0]!, len: cf[1]!.length };
      sawStray = true;
      continue;
    }
    const open = OPENER.exec(line);
    if (open && open[2] === "column") {
      const close = findCloser(body, i + 1, open[1]!.length);
      if (close === -1) return null;
      explicit.push(body.slice(i + 1, close));
      i = close;
      continue;
    }
    if (!BLANK.test(line)) sawStray = true;
  }
  if (explicit.length > 0) return explicit;
  void sawStray; // no explicit columns — fall through to the `---` style

  // Pass 2: `---` dividers at the top nesting level.
  const groups: string[][] = [];
  let group: string[] = [];
  let depth = 0;
  fence = null;
  for (let i = 0; i < body.length; i++) {
    const line = body[i]!;
    if (fence) {
      group.push(line);
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const cf = CODE_FENCE.exec(line);
    if (cf) {
      fence = { ch: cf[1]![0]!, len: cf[1]!.length };
      group.push(line);
      continue;
    }
    if (OPENER.test(line)) depth++;
    else if (depth > 0 && /^:{3,}\s*$/.test(line)) depth--;
    else if (depth === 0) {
      if (OTHER_BREAK.test(line)) return null; // ***/___ also split; ambiguous
      if (DASH_BREAK.test(line)) {
        // `---` directly under a text line is a setext underline, not a break
        // — except the spaced `- - -` form, which can only be a break.
        const prev = i > 0 ? body[i - 1]! : "";
        const spaced = /[ \t]/.test(line.trim());
        if (!spaced && !BLANK.test(prev) && !FENCEISH.test(prev)) return null;
        groups.push(group);
        group = [];
        continue;
      }
    }
    group.push(line);
  }
  groups.push(group);
  return groups;
}

/**
 * Parse a canonical `{attrs}` group into VSS-expressible pairs, or null when
 * any attribute can't survive the VSS pipeline unchanged (see module doc).
 */
function parseAttrs(group: string | undefined): [string, string][] | null {
  if (!group) return [];
  const s = group.slice(1, -1);
  const out = new Map<string, string>();
  const re = /\s*([A-Za-z_][\w:-]*)=(?:"([^"]*)"|([^\s"}]+))/y;
  let pos = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m) {
      if (BLANK.test(s.slice(pos))) break;
      return null; // #id/.class shorthand, valueless key, or malformed
    }
    const value = m[2] ?? m[3] ?? "";
    if (value === "" || value.includes('"') || value.includes("}")) return null;
    // VSS normalizes comma lists (`a, b` → `a,b`); only convert when the
    // value is already in normal form so the model attribute is unchanged.
    const normal = value
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
      .join(",");
    if (normal !== value) return null;
    out.set(m[1]!, value);
    pos = re.lastIndex;
  }
  return [...out];
}

/**
 * Escape bare `{`/`}` on a passthrough markdown line so the VSS brace matcher
 * treats them as literal. Skips inline code spans (`span` carries an open
 * backtick run across lines — CommonMark spans may span newlines) and leaves
 * existing backslash escapes alone.
 */
function escapeBraces(line: string, span: { open: number }): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const c = line[i]!;
    if (c === "`") {
      let run = 0;
      while (line[i + run] === "`") run++;
      if (span.open > 0) {
        if (run === span.open) span.open = 0;
      } else {
        span.open = run;
      }
      out += line.slice(i, i + run);
      i += run;
      continue;
    }
    if (span.open > 0) {
      out += c;
      i++;
      continue;
    }
    if (c === "\\") {
      out += line.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === "{" || c === "}") {
      out += "\\" + c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Strip leading/trailing blank lines from a body (the braces add framing). */
function trimBlank(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && BLANK.test(lines[a]!)) a++;
  while (b > a && BLANK.test(lines[b - 1]!)) b--;
  return lines.slice(a, b);
}
