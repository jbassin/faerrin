import { useMemo } from "react";
import { parseDocument, DocumentView, type ThemeMode } from "../render/index.ts";
import styles from "./App.module.css";

/**
 * Live preview. Renders the same renderer library the export service will use,
 * inside the [data-vellum-export] boundary (DocumentView) — so "what you see"
 * is "what the PNG will be" (R-15).
 */
export function Preview({ source, mode }: { source: string; mode: ThemeMode }) {
  const document = useMemo(
    () => parseDocument(source, { mode }),
    [source, mode],
  );
  return (
    <div className={styles.previewSurface} data-mode={mode}>
      {document.nodes.length === 0 ? (
        <p className={styles.previewEmpty}>
          Nothing to render yet. Write some markdown, or open a{" "}
          <code>:::statblock</code> / <code>:::handout</code> block.
        </p>
      ) : (
        <DocumentView document={document} />
      )}
    </div>
  );
}
