import type { ReactElement } from "react";
import styles from "./blocks.module.css";

/** A PF2e-style trait pill. Visual only — the name is rendered verbatim. */
export function TraitPill({ name }: { name: string }): ReactElement {
  return <span className={styles.trait}>{name}</span>;
}
