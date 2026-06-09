import type { ReactElement } from "react";
import styles from "./blocks.module.css";
import { renderNodes, collectText } from "../mdastToReact.tsx";
import { TraitPill } from "./TraitPill.tsx";
import { grimeStyle } from "./grimeStyle.ts";
import type { DocumentKind, VellumBlock } from "../model.ts";

function splitTraits(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((trait) => trait.trim())
    .filter(Boolean);
}

/**
 * Mechanical "stat" layout shared by statblock / hazard / item / spell. Layout
 * only — every field is the author's text, rendered verbatim (R-9). The kind
 * tag distinguishes the four; `meta` surfaces level/rank/price if present.
 */
export function StatCard({
  block,
  kind,
}: {
  block: VellumBlock;
  kind: DocumentKind;
}): ReactElement {
  const { attributes, label, labelNodes, children } = block;
  const traits = splitTraits(attributes.traits);
  // Render the label's inline nodes (so `[Name :action[free]]` shows the glyph);
  // fall back to the `name=` attribute or the kind when there's no label.
  const name = labelNodes ? renderNodes(labelNodes) : (attributes.name ?? kind);
  const meta = attributes.level ?? attributes.rank ?? attributes.price;

  return (
    <section
      className={`${styles.card} ${styles.statCard}`}
      data-kind={kind}
      style={grimeStyle((label ?? "") + collectText(children))}
    >
      <header className={styles.header}>
        <span className={styles.name}>{name}</span>
        <span className={styles.kindTag}>{kind}</span>
      </header>
      {meta ? <div className={styles.meta}>{meta}</div> : null}
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
