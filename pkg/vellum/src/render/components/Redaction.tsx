import type { ReactElement } from "react";
import styles from "./blocks.module.css";

/**
 * Diegetic redaction bar — `:redact[the secret]` renders as a [DATA EXPUNGED]
 * blackout. The underlying text is still in the DOM (title) but visually
 * covered; this is a prop effect, not real security.
 */
export function Redaction({ children }: { children: string }): ReactElement {
  return (
    <span className={styles.redaction} title="[DATA EXPUNGED]">
      {children}
    </span>
  );
}
