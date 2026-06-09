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
 * tag distinguishes the four; `level` shows beside the tag, `price` in the body.
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
  // The corner tag defaults to the kind, but `tag=` overrides it with any label
  // (e.g. `:::item{tag="Consumable"}`). `data-kind` still drives the CSS skin.
  const tag = attributes.tag ?? kind;
  // `level` reads beside the tag in the header (e.g. "ITEM 4"); `price` stays in
  // the body, under the header.
  const level = attributes.level;
  const price = attributes.price;

  return (
    <section
      className={`${styles.card} ${styles.statCard}`}
      data-kind={kind}
      style={grimeStyle((label ?? "") + collectText(children))}
    >
      <header className={styles.header}>
        <span className={styles.name}>{name}</span>
        <span className={styles.tagLine}>
          <span className={styles.kindTag}>{tag}</span>
          {level ? <span className={styles.level}>{level}</span> : null}
        </span>
      </header>
      {price ? <div className={styles.price}>{price}</div> : null}
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
