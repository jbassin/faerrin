// Obsidian callouts (`> [!type] Title`) → Quartz-compatible callout markup,
// ported from quartz/plugins/transformers/ofm.ts. Produces the exact DOM the
// ported callouts.scss targets:
//   <blockquote class="callout <type>" data-callout="<type>" …>
//     <div class="callout-title"><div class="callout-icon"></div>
//       <div class="callout-title-inner">Title</div></div>
//     <div class="callout-content"><div class="callout-content-inner">…</div></div>
//   </blockquote>
//
// Quartz forces a newline after the title at the SOURCE level so the title and
// body never share a paragraph. We can't transform source in a remark plugin, so
// we split the first paragraph at its first newline at the mdast level — keeping
// body inline nodes (emphasis, links) OUT of the title. Runs after remark-directive,
// before remark-wikilinks so [[links]] in bodies/titles still resolve.
import { visit } from "unist-util-visit"
import { toString } from "mdast-util-to-string"

const calloutRegex = /^\[\!(\w+)\|?(.+?)?\]([+-]?)/
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export default function remarkCallouts() {
  return (tree) => {
    visit(tree, "blockquote", (node) => {
      if (node.children.length === 0) return
      const [firstChild, ...calloutContent] = node.children
      if (firstChild.type !== "paragraph" || firstChild.children[0]?.type !== "text") return

      const match = firstChild.children[0].value.match(calloutRegex)
      if (!match) return
      const [calloutDirective, typeString, calloutMetaData, collapseChar] = match
      const calloutType = typeString.toLowerCase()
      const collapse = collapseChar === "+" || collapseChar === "-"
      const defaultState = collapseChar === "-" ? "collapsed" : "expanded"

      // Partition the first paragraph's inline children at the first newline:
      // before → title (the directive line), after → body. Inline nodes that
      // follow the newline (e.g. the body's emphasis/links) go to the body.
      const titleChildren = []
      const bodyInline = []
      let inBody = false
      for (const child of firstChild.children) {
        if (inBody) {
          bodyInline.push(child)
          continue
        }
        if (child.type === "text" && child.value.includes("\n")) {
          const i = child.value.indexOf("\n")
          const before = child.value.slice(0, i)
          const after = child.value.slice(i + 1)
          if (before) titleChildren.push({ type: "text", value: before })
          if (after) bodyInline.push({ type: "text", value: after })
          inBody = true
        } else {
          titleChildren.push(child)
        }
      }
      // Strip the directive (`[!type]`) from the first title text node.
      titleChildren[0] = {
        type: "text",
        value: titleChildren[0].value.slice(calloutDirective.length).trim(),
      }

      const titleText = toString({ type: "root", children: titleChildren }).trim()
      const titleHtmlText =
        titleText === "" ? capitalize(typeString).replace(/-/g, " ") : esc(titleText)

      const toggleIcon = `<div class="fold-callout-icon"></div>`
      const titleHtml = {
        type: "html",
        value: `<div class="callout-title"><div class="callout-icon"></div><div class="callout-title-inner">${titleHtmlText}</div>${collapse ? toggleIcon : ""}</div>`,
      }

      // Body = leftover inline from the first paragraph (as its own paragraph)
      // followed by the rest of the blockquote, wrapped in the collapse-anim divs.
      const contentChildren = [
        ...(bodyInline.length > 0 ? [{ type: "paragraph", children: bodyInline }] : []),
        ...calloutContent,
      ]

      const newChildren = [titleHtml]
      if (contentChildren.length > 0) {
        newChildren.push({
          data: { hProperties: { className: ["callout-content"] }, hName: "div" },
          type: "blockquote",
          children: [
            {
              data: { hProperties: { className: ["callout-content-inner"] }, hName: "div" },
              type: "blockquote",
              children: contentChildren,
            },
          ],
        })
      }
      node.children = newChildren

      const classNames = ["callout", calloutType]
      if (collapse) classNames.push("is-collapsible")
      if (defaultState === "collapsed") classNames.push("is-collapsed")
      node.data = {
        hProperties: {
          ...(node.data?.hProperties ?? {}),
          className: classNames.join(" "),
          "data-callout": calloutType,
          "data-callout-fold": collapse,
          "data-callout-metadata": calloutMetaData,
        },
      }
    })
  }
}
