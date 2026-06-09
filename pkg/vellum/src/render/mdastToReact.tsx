import type { ReactNode } from "react";
import type { Nodes } from "mdast";
import { ActionGlyph, normalizeActionCost } from "./glyphs/actions.tsx";
import { TraitPill } from "./components/TraitPill.tsx";
import { ErrorChip } from "./components/ErrorChip.tsx";
import { Redaction } from "./components/Redaction.tsx";

/** Flatten a node subtree to its text content (verbatim, no evaluation). */
export function collectText(nodes: readonly Nodes[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text" || node.type === "inlineCode") out += node.value;
    else if ("children" in node) out += collectText(node.children);
  }
  return out;
}

/** Render an inline/leaf directive (`:action`, `:trait`, …) to React. */
function renderDirective(
  name: string,
  children: readonly Nodes[],
  attributes: Record<string, string | null | undefined> | null | undefined,
): ReactNode {
  if (name === "action") {
    const token = collectText(children) || attributes?.cost || "";
    const cost = normalizeActionCost(token);
    return cost ? (
      <ActionGlyph cost={cost} />
    ) : (
      <ErrorChip message={`?action[${token}]`} />
    );
  }
  if (name === "trait") {
    const trait = collectText(children).trim();
    return trait ? (
      <TraitPill name={trait} />
    ) : (
      <ErrorChip message="?trait[]" />
    );
  }
  if (name === "redact") {
    return <Redaction>{collectText(children)}</Redaction>;
  }
  return <ErrorChip message={`?${name}`} />;
}

function renderNode(node: Nodes, key: number): ReactNode {
  switch (node.type) {
    case "text":
      return node.value;
    case "paragraph":
      return <p key={key}>{renderNodes(node.children)}</p>;
    case "heading": {
      const depth = Math.min(node.depth, 6);
      const Tag = `h${depth}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag key={key}>{renderNodes(node.children)}</Tag>;
    }
    case "strong":
      return <strong key={key}>{renderNodes(node.children)}</strong>;
    case "emphasis":
      return <em key={key}>{renderNodes(node.children)}</em>;
    case "delete":
      return <del key={key}>{renderNodes(node.children)}</del>;
    case "inlineCode":
      return <code key={key}>{node.value}</code>;
    case "code":
      return (
        <pre key={key}>
          <code>{node.value}</code>
        </pre>
      );
    case "break":
      return <br key={key} />;
    case "thematicBreak":
      return <hr key={key} />;
    case "blockquote":
      return <blockquote key={key}>{renderNodes(node.children)}</blockquote>;
    case "list":
      return node.ordered ? (
        <ol key={key} start={node.start ?? undefined}>
          {renderNodes(node.children)}
        </ol>
      ) : (
        <ul key={key}>{renderNodes(node.children)}</ul>
      );
    case "listItem":
      return <li key={key}>{renderNodes(node.children)}</li>;
    case "link":
      return (
        <a key={key} href={node.url}>
          {renderNodes(node.children)}
        </a>
      );
    case "image":
      // Real image handling (SSRF allowlist) is SEC-3 / later. For now, never
      // emit an external fetch — render the alt text only.
      return <span key={key}>{node.alt ?? ""}</span>;
    case "html":
      // SEC-1: never inject raw HTML. Render escaped as text.
      return <code key={key}>{node.value}</code>;
    case "textDirective":
    case "leafDirective":
      return (
        <span key={key}>
          {renderDirective(node.name, node.children, node.attributes)}
        </span>
      );
    case "containerDirective":
      // `:::columns`/`:::column` only mean something to the document-level
      // parser (parse.ts). If one reaches the renderer it's misplaced — nested
      // inside a `:::kind` block, or an orphan `:::column`. Flag it (R-4) so the
      // author sees it, but still render the content so nothing is lost.
      if (node.name === "columns" || node.name === "column") {
        return (
          <div key={key}>
            <ErrorChip message={`?${node.name} — only at top level`} />
            {renderNodes(node.children)}
          </div>
        );
      }
      // Other unknown containers render their content generically.
      return <div key={key}>{renderNodes(node.children)}</div>;
    default:
      return <ErrorChip key={key} message={`?${node.type}`} />;
  }
}

/** Render a list of mdast nodes to React. Pure, total (never throws). */
export function renderNodes(nodes: readonly Nodes[]): ReactNode {
  return nodes.map((node, i) => renderNode(node, i));
}
