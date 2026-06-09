/**
 * Vellum Structured Syntax (VSS). A pure, total `source → source` pass that
 * compiles a brace/bracket-delimited *structural* surface into vellum's
 * canonical `:::`-directive markdown, *before* the inline sigil `desugar` and
 * remark run (see `parseMarkdown`). See the spec:
 * `thoughts/vellum/specs/2026-06-09-vellum-structured-syntax.md`.
 *
 * Design axiom: **braces for STRUCTURE, markdown for CONTENT.** VSS is a
 * structural compiler, not a replacement parser — it never reimplements
 * markdown; it emits canonical directive markdown and hands bodies to remark
 * verbatim. The model, renderer, and goldens are untouched.
 *
 *   @item "Boots of Speed"           :::item[Boots of Speed]{level="2"}
 *   | level: 2                  →     A swift stride.
 *   {                                :::
 *     A swift stride.
 *   }
 *
 * Properties:
 *  - **No-op** on construct-free input (canonical docs + golden fixtures are
 *    returned byte-identical, so the goldens never move).
 *  - **Total** — every structural error becomes a `:vsserr[reason]` sentinel
 *    directive (E1–E14); recursion is depth-capped. It cannot throw.
 *  - **Idempotent** — the output is canonical markdown with no VSS constructs,
 *    so `compileVss(compileVss(x)) === compileVss(x)`.
 */

import { DOCUMENT_KINDS } from "./model.ts";

/** Cap on construct nesting (bounds recursion + colon counts). E13. */
const MAX_DEPTH = 16;

const KINDS = new Set<string>(DOCUMENT_KINDS);

// ── internal node model ─────────────────────────────────────────────────────

type VssNode =
  | { type: "markdown"; text: string }
  | {
      type: "block";
      kind: string;
      title: string;
      attrs: [string, string][];
      errors: string[];
      body: VssNode[];
    }
  | { type: "columns"; groups: VssNode[][]; errors: string[] }
  | { type: "error"; reason: string };

/** A construct parsed from position `start`, plus the index just past it. */
interface Parsed {
  node: VssNode;
  end: number;
}

/** Result of scanning a `{ … }` body from its opening brace. */
interface Body {
  /** Text between the braces (escapes kept as `\{`/`\}`, NOT unescaped). */
  text: string;
  /** Index just past the matching `}` (or EOF). */
  end: number;
  /** No matching `}` before EOF (E3). */
  unterminated: boolean;
  /** A bare canonical `:::` fence appeared inside the body (E14, §5 rule 5). */
  nestedColon: boolean;
}

// ── public entry ────────────────────────────────────────────────────────────

/** Compile VSS source to canonical `:::`-directive markdown. Pure & total. */
export function compileVss(source: string): string {
  const nodes = parseContent(source, 0);
  // No-op fast path: construct-free input is returned byte-identical so the
  // canonical docs + golden fixtures never drift through the pipeline.
  if (nodes.every((n) => n.type === "markdown")) return source;
  return joinContent(nodes).trim();
}

// ── scanning helpers ────────────────────────────────────────────────────────

function isLineStart(s: string, i: number): boolean {
  return i === 0 || s[i - 1] === "\n";
}

/** Index of the next `\n` at/after `i`, or `s.length`. */
function lineEndIndex(s: string, i: number): number {
  const nl = s.indexOf("\n", i);
  return nl === -1 ? s.length : nl;
}

/** Index just past the next `\n` at/after `i`, or `s.length`. */
function afterLine(s: string, i: number): number {
  const nl = s.indexOf("\n", i);
  return nl === -1 ? s.length : nl + 1;
}

function isKind(word: string): boolean {
  return KINDS.has(word);
}

// ── recursive-descent over structural tokens ────────────────────────────────

/**
 * Parse `text` into an ordered list of nodes: markdown-runs (verbatim) plus VSS
 * constructs. Constructs are recognized only at line start (modulo
 * indentation); everything else is opaque markdown. Recurses on bodies.
 */
function parseContent(s: string, depth: number): VssNode[] {
  const nodes: VssNode[] = [];
  let md = "";
  let i = 0;
  const flush = () => {
    if (md.length > 0) {
      nodes.push({ type: "markdown", text: md });
      md = "";
    }
  };

  while (i < s.length) {
    if (isLineStart(s, i)) {
      let j = i;
      while (j < s.length && (s[j] === " " || s[j] === "\t")) j++;
      if (s[j] === "@") {
        const parsed = tryConstruct(s, j, depth);
        if (parsed) {
          flush();
          nodes.push(parsed.node);
          i = parsed.end;
          continue;
        }
      }
    }
    // Consume one line (with its newline) as opaque markdown.
    const nl = s.indexOf("\n", i);
    if (nl === -1) {
      md += s.slice(i);
      i = s.length;
    } else {
      md += s.slice(i, nl + 1);
      i = nl + 1;
    }
  }
  flush();
  return nodes;
}

/**
 * Try to parse a construct whose `@` is at `j` (line start, modulo ws). Returns
 * null if it isn't VSS (unknown `@kind` → literal passthrough, E7). The kind is
 * matched as a whole lowercase word, so `@items`/`@item2` aren't `@item`.
 */
function tryConstruct(s: string, j: number, depth: number): Parsed | null {
  const m = /^@([a-z]+)/.exec(s.slice(j, j + 32));
  if (!m) return null;
  const word = m[1]!;
  const after = s[j + 1 + word.length];
  // Whole-word boundary: a trailing word char means this isn't a bare kind.
  if (after !== undefined && /[A-Za-z0-9_]/.test(after)) return null;

  if (word === "columns") return parseColumns(s, j, depth);
  if (isKind(word)) return parseBlock(s, j, word, depth);
  return null; // E7 — unknown kind passes through as literal text
}

/** Parse `@kind "Title" |attrs { body }`. The `@kind` is at `j`. */
function parseBlock(
  s: string,
  j: number,
  kind: string,
  depth: number,
): Parsed {
  let p = j + 1 + kind.length;
  while (p < s.length && (s[p] === " " || s[p] === "\t")) p++;

  if (s[p] !== '"') {
    // E1 — missing quoted title; skip to next line.
    return { node: errNode(`@${kind}: expected "title"`), end: afterLine(s, j) };
  }
  const t = parseTitle(s, p);
  if (!t) {
    return { node: errNode(`@${kind}: expected "title"`), end: afterLine(s, j) };
  }
  return parseBlockTail(s, t.end, kind, t.title, depth);
}

/** Read a `"…"` title from `p` (the opening quote). `\"` escapes a quote. */
function parseTitle(s: string, p: number): { title: string; end: number } | null {
  let k = p + 1;
  let out = "";
  while (k < s.length) {
    const c = s[k];
    if (c === "\\" && s[k + 1] === '"') {
      out += '"';
      k += 2;
      continue;
    }
    if (c === '"') return { title: out, end: k + 1 };
    if (c === "\n") return null; // titles don't cross lines
    out += c;
    k++;
  }
  return null; // EOF before the closing quote
}

/** Scan the attribute lines + body that follow a block's title. */
function parseBlockTail(
  s: string,
  start: number,
  kind: string,
  title: string,
  depth: number,
): Parsed {
  const attrs = new Map<string, string>(); // duplicate keys: last-wins
  let q = start;

  while (q < s.length) {
    const lineStart = q === 0 || s[q - 1] === "\n";
    let r = q;
    while (r < s.length && (s[r] === " " || s[r] === "\t")) r++;
    if (r >= s.length) break; // EOF → E2
    const ch = s[r];

    if (ch === "\n") {
      q = r + 1;
      continue;
    }

    if (ch === "|") {
      // One attribute per line; split on the FIRST `:`; value = rest of line.
      const le = lineEndIndex(s, r);
      const seg = s.slice(r + 1, le);
      const ci = seg.indexOf(":");
      if (ci !== -1) {
        const key = seg.slice(0, ci).trim();
        const value = seg.slice(ci + 1).trim();
        if (key) attrs.set(key, value);
      }
      q = le < s.length ? le + 1 : le;
      continue;
    }

    if (ch === "{") {
      const body = matchBody(s, r);
      if (body.nestedColon) {
        // E14 — the whole construct becomes an error chip.
        return {
          node: errNode("nested ::: not allowed in a VSS body"),
          end: body.end,
        };
      }
      const errors: string[] = [];
      if (body.unterminated) errors.push(`@${kind} "${title}": unterminated body`);
      const attrPairs = buildAttrs(kind, attrs, errors);
      const inner =
        depth + 1 > MAX_DEPTH
          ? [errNode("too deeply nested")]
          : parseContent(dedent(body.text), depth + 1);
      return {
        node: { type: "block", kind, title, attrs: attrPairs, errors, body: inner },
        end: body.end,
      };
    }

    // Anything else before the body opens.
    if (lineStart) {
      // A new line that isn't a `|` attr or a `{` body means the block opener
      // ended without a body (E2/E9). Leave the line for the outer markdown.
      return {
        node: errNode(`@${kind} "${title}": missing { body }`),
        end: r,
      };
    }
    // E10 — a mid-line unexpected token (e.g. a second quoted string).
    let e = r;
    while (e < s.length && !/\s/.test(s[e]!) && s[e] !== "{") e++;
    return {
      node: errNode(`@${kind}: unexpected ${s.slice(r, e)}`),
      end: afterLine(s, r),
    };
  }
  // E2 — ran out of input without a body.
  return { node: errNode(`@${kind} "${title}": missing { body }`), end: q };
}

/** Validate/normalize attributes; E12 rejects values with `"`/`}` (chip + drop). */
function buildAttrs(
  kind: string,
  attrs: Map<string, string>,
  errors: string[],
): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, raw] of attrs) {
    // `traits: a, b` → `a,b` (trim each, drop empties).
    const value = raw
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
      .join(",");
    if (value === "") continue; // empty values dropped
    if (value.includes('"') || value.includes("}")) {
      errors.push(`@${kind}: attribute '${key}' has an unsupported character`);
      continue;
    }
    out.push([key, value]);
  }
  return out;
}

/** Parse `@columns [ {…} {…} ]`. The `@columns` is at `j`. */
function parseColumns(s: string, j: number, depth: number): Parsed {
  let p = j + "@columns".length;
  while (p < s.length && /\s/.test(s[p]!)) p++;
  if (s[p] !== "[") {
    // E4 — no `[`; skip to next line.
    return { node: errNode("@columns: missing opening bracket"), end: afterLine(s, j) };
  }
  p++; // past `[`

  const groups: VssNode[][] = [];
  const errors: string[] = [];

  for (;;) {
    while (p < s.length && /\s/.test(s[p]!)) p++;
    if (p >= s.length) {
      errors.push("@columns: unterminated column list"); // E5
      break;
    }
    if (s[p] === "]") {
      p++;
      break;
    }
    if (s[p] === "{") {
      const body = matchBody(s, p);
      let col: VssNode[];
      if (body.nestedColon) {
        col = [errNode("nested ::: not allowed in a VSS body")]; // E14
      } else if (depth + 1 > MAX_DEPTH) {
        col = [errNode("too deeply nested")]; // E13
      } else {
        col = parseContent(dedent(body.text), depth + 1);
      }
      groups.push(col);
      p = body.end;
      continue;
    }
    // E6 — non-`{` content inside the list; skip to the next `{`/`]`.
    let e = p;
    while (e < s.length && s[e] !== "{" && s[e] !== "]") e++;
    groups.push([errNode("@columns: expected { column }")]);
    p = e;
  }

  return { node: { type: "columns", groups, errors }, end: p };
}

// ── brace matcher (§5) ──────────────────────────────────────────────────────

/**
 * Find the `}` matching the `{` at `open`, tracking markdown lexical state so
 * structural braces are counted but braces inside code spans / fenced code /
 * escapes are not. A bare `:::` directive in the body is flagged (E14).
 */
function matchBody(s: string, open: number): Body {
  const len = s.length;
  let k = open + 1;
  let depth = 1;
  let fence: { char: string; len: number } | null = null;
  let codeSpan = 0;
  let nestedColon = false;

  while (k < len) {
    const lineStart = k === 0 || s[k - 1] === "\n";

    // Inside a fenced code block: only a matching close fence matters.
    if (fence) {
      if (lineStart) {
        let p = k;
        let sp = 0;
        while (p < len && s[p] === " " && sp < 3) {
          p++;
          sp++;
        }
        let run = 0;
        while (p < len && s[p] === fence.char) {
          p++;
          run++;
        }
        let q = p;
        while (q < len && (s[q] === " " || s[q] === "\t")) q++;
        const restWs = q >= len || s[q] === "\n";
        if (run >= fence.len && restWs) {
          fence = null;
          k = q >= len ? len : q;
          continue;
        }
      }
      const nl = s.indexOf("\n", k);
      k = nl === -1 ? len : nl + 1;
      continue;
    }

    // Inside an inline code span: braces ignored until the matching backtick run.
    if (codeSpan > 0) {
      if (s[k] === "`") {
        let p = k;
        let run = 0;
        while (p < len && s[p] === "`") {
          p++;
          run++;
        }
        if (run === codeSpan) codeSpan = 0; // exact-length run closes it
        k = p;
        continue;
      }
      k++;
      continue;
    }

    // Escapes: `\{` / `\}` are literal (and kept escaped in the body text).
    if (s[k] === "\\" && (s[k + 1] === "{" || s[k + 1] === "}")) {
      k += 2;
      continue;
    }

    // Line-start lexical openers: fenced code, and a forbidden bare `:::`.
    if (lineStart) {
      let p = k;
      let sp = 0;
      while (p < len && s[p] === " " && sp < 3) {
        p++;
        sp++;
      }
      const fc = s[p];
      if (fc === "`" || fc === "~") {
        let pp = p;
        let run = 0;
        while (pp < len && s[pp] === fc) {
          pp++;
          run++;
        }
        if (run >= 3) {
          fence = { char: fc, len: run };
          const nl = s.indexOf("\n", pp);
          k = nl === -1 ? len : nl + 1;
          continue;
        }
      }
      if (fc === ":") {
        let pp = p;
        let run = 0;
        while (pp < len && s[pp] === ":") {
          pp++;
          run++;
        }
        const next = s[pp];
        if (run >= 3 && next !== undefined && (/[a-zA-Z]/.test(next) || next === "[")) {
          nestedColon = true; // E14 — keep scanning to find the matching brace
          const nl = s.indexOf("\n", pp);
          k = nl === -1 ? len : nl + 1;
          continue;
        }
      }
    }

    const c = s[k];
    if (c === "`") {
      let p = k;
      let run = 0;
      while (p < len && s[p] === "`") {
        p++;
        run++;
      }
      codeSpan = run;
      k = p;
      continue;
    }
    if (c === "{") {
      depth++;
      k++;
      continue;
    }
    if (c === "}") {
      depth--;
      k++;
      if (depth === 0) {
        return { text: s.slice(open + 1, k - 1), end: k, unterminated: false, nestedColon };
      }
      continue;
    }
    k++;
  }
  // EOF before close (E3).
  return { text: s.slice(open + 1), end: len, unterminated: true, nestedColon };
}

// ── serialize to canonical markdown ─────────────────────────────────────────

/** Bottom-up colon count for a directive node: `1 + max(2, deepest child)`. */
function colonsOf(node: VssNode): number {
  if (node.type === "error") return 3; // a leaf `:vsserr[…]` directive
  if (node.type === "block") return 1 + Math.max(2, maxChildColons(node.body));
  if (node.type === "columns") {
    const cols = node.groups.map(columnColons);
    return 1 + Math.max(2, ...cols, 0);
  }
  return 0; // markdown emits no directive
}

/** Colon count of the implicit `:::column` container wrapping a column. */
function columnColons(group: VssNode[]): number {
  return 1 + Math.max(2, maxChildColons(group));
}

function maxChildColons(nodes: VssNode[]): number {
  let m = 0;
  for (const n of nodes) if (n.type !== "markdown") m = Math.max(m, colonsOf(n));
  return m;
}

/** Strip leading/trailing whitespace-only lines, keeping internal indentation. */
function trimOuterNewlines(t: string): string {
  return t.replace(/^(?:[ \t]*\n)+/, "").replace(/(?:\n[ \t]*)+$/, "");
}

/**
 * Join an ordered node list. A blank line separates a markdown-run from an
 * adjacent directive (required so remark parses the fence); back-to-back
 * sibling directives need only a single newline.
 */
function joinContent(nodes: VssNode[]): string {
  const parts: { dir: boolean; text: string }[] = [];
  for (const n of nodes) {
    if (n.type === "markdown") {
      const t = trimOuterNewlines(n.text);
      if (t.trim() === "") continue;
      parts.push({ dir: false, text: t });
    } else {
      parts.push({ dir: true, text: serializeNode(n) });
    }
  }
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      const prev = parts[i - 1]!;
      const cur = parts[i]!;
      out += cur.dir && prev.dir ? "\n" : "\n\n";
    }
    out += parts[i]!.text;
  }
  return out;
}

function serializeNode(node: VssNode): string {
  if (node.type === "markdown") return trimOuterNewlines(node.text);
  if (node.type === "error") return `:vsserr[${sanitize(node.reason)}]`;

  if (node.type === "block") {
    const fence = ":".repeat(colonsOf(node));
    const pre = node.errors.map((e) => `:vsserr[${sanitize(e)}]\n\n`).join("");
    // An empty title emits no [label] at all — `:::item[]` and `:::item` are
    // model-equal, and the bare form is the cleaner canonical output.
    const label = node.title === "" ? "" : "[" + escapeLabel(node.title) + "]";
    const header = fence + node.kind + label + attrBlock(node.attrs);
    return pre + header + "\n" + joinContent(node.body) + "\n" + fence;
  }

  // columns
  const fence = ":".repeat(colonsOf(node));
  const pre = node.errors.map((e) => `:vsserr[${sanitize(e)}]\n\n`).join("");
  const cols = node.groups.map((g) => {
    const cf = ":".repeat(columnColons(g));
    return cf + "column\n" + joinContent(g) + "\n" + cf;
  });
  return pre + fence + "columns\n" + cols.join("\n") + "\n" + fence;
}

/** `{key="value" …}` for non-empty attrs, else "". */
function attrBlock(attrs: [string, string][]): string {
  if (attrs.length === 0) return "";
  return "{" + attrs.map(([k, v]) => `${k}="${v}"`).join(" ") + "}";
}

/** Backslash-escape `[`/`]` so a title with brackets can't close `[label]`. */
function escapeLabel(title: string): string {
  return title.replace(/([[\]])/g, "\\$1");
}

/**
 * Sanitize an error reason placed inside `:vsserr[reason]` (R-4 must not
 * self-break). Backslash-escapes `[`/`]` so a reason echoing author input (e.g.
 * a title containing `]`) can't close the label early; collapses newlines and
 * truncates to ~80 chars.
 */
function sanitize(reason: string): string {
  return reason
    .replace(/([[\]])/g, "\\$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function errNode(reason: string): VssNode {
  return { type: "error", reason };
}

/** Remove the common leading indentation from a multi-line body. */
function dedent(text: string): string {
  const lines = text.split("\n");
  let min = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const indent = /^[ \t]*/.exec(line)![0].length;
    if (indent < min) min = indent;
  }
  if (min === Infinity || min === 0) return text;
  return lines
    .map((line) => (line.trim() === "" ? line : line.slice(min)))
    .join("\n");
}
