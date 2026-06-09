import type { ReactElement } from "react";
import styles from "./blocks.module.css";
import { renderNodes } from "../mdastToReact.tsx";
import type { VellumBlock } from "../model.ts";

/**
 * A handout card. Diegetic styling (parchment, seals, drop-caps) lands in M4;
 * M1 renders the structure in the mechanical skin.
 */
export function Handout({ block }: { block: VellumBlock }): ReactElement {
  const { label, children } = block;
  return (
    <section className={`${styles.card} ${styles.handout}`}>
      {label ? <header className={styles.handoutTitle}>{label}</header> : null}
      <div className={styles.body}>{renderNodes(children)}</div>
    </section>
  );
}
