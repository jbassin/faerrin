import type { ReactElement } from "react";
import styles from "./blocks.module.css";
import { renderNodes } from "../mdastToReact.tsx";
import { TraitPill } from "./TraitPill.tsx";
import type { VellumBlock } from "../model.ts";

/**
 * Fallback card for zoo kinds without a dedicated component yet (hazard, item,
 * spell, edict). M4 replaces these with bespoke layouts. The parser already
 * recognizes all six kinds, so adding a component later needs no parser change.
 */
export function GenericBlock({ block }: { block: VellumBlock }): ReactElement {
  const { kind, attributes, label, children } = block;
  const traits = (attributes.traits ?? "")
    .split(",")
    .map((trait) => trait.trim())
    .filter(Boolean);
  const name = label ?? attributes.name;

  return (
    <section className={`${styles.card} ${styles.generic}`} data-kind={kind}>
      <header className={styles.header}>
        <span className={styles.kindTag}>{kind}</span>
        {name ? <span className={styles.name}>{name}</span> : null}
      </header>
      {traits.length ? (
        <div className={styles.traits}>
          {traits.map((trait, i) => (
            <TraitPill key={i} name={trait} />
          ))}
        </div>
      ) : null}
      <div className={styles.body}>{renderNodes(children)}</div>
    </section>
  );
}
