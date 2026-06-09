import type { ReactElement } from "react";
import styles from "./blocks.module.css";
import { renderNodes } from "../mdastToReact.tsx";
import type { DocumentKind, VellumBlock } from "../model.ts";

/**
 * Diegetic prose layout for handout / edict — an in-world document. In diegetic
 * mode the skin (parchment, drop-cap, suppressed trait glyphs) is applied via
 * [data-mode] CSS; the component stays theme-agnostic (AD-4).
 */
export function ProseCard({
  block,
  kind,
}: {
  block: VellumBlock;
  kind: DocumentKind;
}): ReactElement {
  const { label, children } = block;
  return (
    <section className={`${styles.card} ${styles.proseCard}`} data-kind={kind}>
      {label ? <header className={styles.proseTitle}>{label}</header> : null}
      <div className={styles.proseBody}>{renderNodes(children)}</div>
    </section>
  );
}
