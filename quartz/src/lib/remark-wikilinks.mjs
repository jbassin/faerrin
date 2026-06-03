// Resolve Obsidian `[[target|alias]]` wikilinks using the SAME algorithm Quartz
// uses (transformLink, "shortest" strategy) so the rendered link graph is
// byte-identical. Proven against the golden baseline by migration/parity-graph.ts.
//
// Quartz resolves wikilinks in a textTransform over the RAW string, so it catches
// them EVERYWHERE — including inside raw-HTML blocks (Timeline.md's hand-written
// <ul>/<li>, Phenomena/Hearts.md). After remark parses, those wikilinks live in
// `html` mdast nodes, NOT `text` nodes — so we must handle both:
//   - text nodes  → split into proper mdast link nodes (clean AST)
//   - html nodes  → string-replace [[..]] with <a> HTML (raw block stays raw)
// Runs after remark-directive, before transcript expansion, so links inside
// transcript line bodies resolve too.
import path from "node:path"
import { visit } from "unist-util-visit"
import { slugifyFilePath, transformLink } from "../../scripts/lib/slug.ts"
import { allSlugs, contentDir } from "./content-paths.mjs"

// [[fp]], [[fp|alias]], [[fp#anchor]], [[fp#anchor|alias]]  (embeds skipped in Phase 1)
const wikilinkRegex = /(!?)\[\[([^\[\]\|\#]+)?(#+[^\[\]\|\#]+)?(\|[^\[\]\#]+)?\]\]/g

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export default function remarkWikilinks() {
  return (tree, file) => {
    const rel = file.path ? path.relative(contentDir, file.path).split(path.sep).join("/") : ""
    const src = slugifyFilePath(rel)
    const resolve = (target) => transformLink(src, target, { strategy: "shortest", allSlugs })

    // 1) raw HTML blocks/spans: string-replace in place (stays raw HTML).
    visit(tree, "html", (node) => {
      if (!node.value.includes("[[")) return
      node.value = node.value.replace(wikilinkRegex, (whole, bang, fp, anchor, aliasRaw) => {
        if (bang === "!") return whole
        if (!fp && !anchor) return whole
        const target = (fp ?? "") + (anchor ?? "")
        const alias = aliasRaw ? aliasRaw.slice(1) : (fp ?? anchor ?? "")
        const url = resolve(target)
        return `<a href="${escapeHtml(url)}" class="internal">${escapeHtml(alias)}</a>`
      })
    })

    // 2) normal prose text nodes: emit proper mdast link nodes.
    visit(tree, "text", (node, index, parent) => {
      if (!parent || index == null || !node.value.includes("[[")) return
      const value = node.value
      const children = []
      let last = 0
      let m
      wikilinkRegex.lastIndex = 0
      while ((m = wikilinkRegex.exec(value)) !== null) {
        const [whole, bang, fp, anchor, aliasRaw] = m
        if (bang === "!") continue // skip embeds in Phase 1
        if (!fp && !anchor) continue
        if (m.index > last) children.push({ type: "text", value: value.slice(last, m.index) })
        const target = (fp ?? "") + (anchor ?? "")
        const alias = aliasRaw ? aliasRaw.slice(1) : (fp ?? anchor ?? "")
        children.push({
          type: "link",
          url: resolve(target),
          data: { hProperties: { className: ["internal"] } },
          children: [{ type: "text", value: alias }],
        })
        last = m.index + whole.length
      }
      if (children.length === 0) return
      if (last < value.length) children.push({ type: "text", value: value.slice(last) })
      parent.children.splice(index, 1, ...children)
      return index + children.length
    })
  }
}
