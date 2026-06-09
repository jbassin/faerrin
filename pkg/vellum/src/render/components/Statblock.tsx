import type { ReactElement } from "react";
import styles from "./blocks.module.css";
import { renderNodes } from "../mdastToReact.tsx";
import { TraitPill } from "./TraitPill.tsx";
import type { VellumBlock } from "../model.ts";

function splitTraits(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((trait) => trait.trim())
    .filter(Boolean);
}

/** A PF2e-style statblock card (mechanical theme). Layout only; never computes. */
export function Statblock({ block }: { block: VellumBlock }): ReactElement {
  const { attributes, label, children } = block;
  const traits = splitTraits(attributes.traits);
  const name = label ?? attributes.name;

  return (
    <section className={`${styles.card} ${styles.statblock}`}>
      <header className={styles.header}>
        {name ? <span className={styles.name}>{name}</span> : null}
        {attributes.level ? (
          <span className={styles.level}>{attributes.level}</span>
        ) : null}
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
