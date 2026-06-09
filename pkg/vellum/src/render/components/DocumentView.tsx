import type { ReactElement } from "react";
import styles from "./blocks.module.css";
import type { VellumBlock, VellumDocument } from "../model.ts";
import { StatCard } from "./StatCard.tsx";
import { ProseCard } from "./ProseCard.tsx";

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
      {document.blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </article>
  );
}
