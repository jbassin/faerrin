import type { ReactElement } from "react";
import styles from "./blocks.module.css";
import type { VellumBlock, VellumDocument } from "../model.ts";
import { Statblock } from "./Statblock.tsx";
import { Handout } from "./Handout.tsx";
import { GenericBlock } from "./GenericBlock.tsx";

function Block({ block }: { block: VellumBlock }): ReactElement {
  switch (block.kind) {
    case "statblock":
      return <Statblock block={block} />;
    case "handout":
      return <Handout block={block} />;
    default:
      return <GenericBlock block={block} />;
  }
}

/**
 * Renders a parsed document. The `[data-vellum-export]` element is the card
 * boundary that the render service screenshots (R-15/R-18) — editor chrome
 * (scanline/vignette overlays) lives outside it.
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
