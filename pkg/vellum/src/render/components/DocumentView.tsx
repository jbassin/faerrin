import type { CSSProperties, ReactElement, ReactNode } from "react";
import styles from "./blocks.module.css";
import type {
  VellumBlock,
  VellumDocument,
  VellumNode,
} from "../model.ts";
import { StatCard } from "./StatCard.tsx";
import { ProseCard } from "./ProseCard.tsx";
import { renderNodes } from "../mdastToReact.tsx";

function Block({ block }: { block: VellumBlock }): ReactElement {
  switch (block.kind) {
    case "handout":
    case "edict":
      return <ProseCard block={block} kind={block.kind} />;
    default:
      // statblock / hazard / item / spell
      return <StatCard block={block} kind={block.kind} />;
  }
}

/** Render one top-level node: a kind block, a loose prose run, or columns. */
function Node({ node }: { node: VellumNode }): ReactNode {
  switch (node.type) {
    case "block":
      return <Block block={node} />;
    case "prose":
      // Loose top-level markdown (headings, lists, prose) rendered verbatim.
      // `.prose` carries document typography — including a real heading scale
      // (h1→h6), unlike the flat section labels inside cards (`.body`).
      return <div className={styles.prose}>{renderNodes(node.children)}</div>;
    case "columns":
      return (
        <div
          className={styles.columns}
          style={{ "--vellum-column-count": node.columns.length } as CSSProperties}
        >
          {node.columns.map((column, i) => (
            <div key={i} className={styles.column}>
              {column.map((child, j) => (
                <Node key={j} node={child} />
              ))}
            </div>
          ))}
        </div>
      );
  }
}

/**
 * Renders a parsed document. The `[data-vellum-export]` element is the card
 * boundary the render service screenshots (R-15/R-18); `data-mode` drives the
 * mechanical|diegetic skin entirely in CSS (structure stays theme-agnostic).
 */
export function DocumentView({
  document,
}: {
  document: VellumDocument;
}): ReactElement {
  return (
    <article
      className={styles.document}
      data-vellum-export=""
      data-mode={document.mode}
    >
      {document.nodes.map((node, i) => (
        <Node key={i} node={node} />
      ))}
    </article>
  );
}
