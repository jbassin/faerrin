import type { ReactElement } from "react";
import styles from "./blocks.module.css";

/**
 * Inline placeholder for an unknown/malformed directive. R-4: the rest of the
 * document still renders; the broken node shows a labeled chip, never a throw.
 */
export function ErrorChip({ message }: { message: string }): ReactElement {
  return (
    <span className={styles.errorChip} role="note" title={message}>
      {message}
    </span>
  );
}
