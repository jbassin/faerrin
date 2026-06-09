import { useDeferredValue, useEffect, useRef, useState } from "react";
import { Editor } from "./Editor.tsx";
import { Preview } from "./Preview.tsx";
import { WELCOME_DOC } from "./welcomeDoc.ts";
import { useExport } from "./useExport.ts";
import type { ThemeMode } from "../render/index.ts";
import styles from "./App.module.css";

const STORAGE_KEY = "vellum:active-doc";

function loadInitialSource(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? WELCOME_DOC;
  } catch {
    return WELCOME_DOC;
  }
}

export function App() {
  const [source, setSource] = useState<string>(loadInitialSource);
  const [mode, setMode] = useState<ThemeMode>("mechanical");
  const { status: exportStatus, exportPng } = useExport();
  // Preview lags input but never blocks typing (R-2).
  const deferredSource = useDeferredValue(source);
  // Seed the (uncontrolled) editor exactly once.
  const initialSource = useRef(source);

  // Debounced localStorage autosave (R-19).
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, source);
      } catch {
        /* private mode / quota — non-fatal */
      }
    }, 250);
    return () => clearTimeout(id);
  }, [source]);

  return (
    <div className={styles.app}>
      <header className={styles.toolbar}>
        <span className={styles.brand}>▌ VELLUM</span>
        <span className={styles.tagline}>diegetic document forge</span>
        <div className={styles.spacer} />
        <div className={styles.modeToggle} role="group" aria-label="Theme mode">
          <button
            type="button"
            className={mode === "mechanical" ? styles.modeOn : styles.modeOff}
            onClick={() => setMode("mechanical")}
          >
            mechanical
          </button>
          <button
            type="button"
            className={mode === "diegetic" ? styles.modeOn : styles.modeOff}
            onClick={() => setMode("diegetic")}
          >
            diegetic
          </button>
        </div>
        {exportStatus.state === "error" ? (
          <span className={styles.exportError} role="alert">
            {exportStatus.message}
          </span>
        ) : null}
        <button
          type="button"
          className={styles.exportButton}
          onClick={() => void exportPng(source, mode)}
          disabled={exportStatus.state === "exporting"}
          title="Render a PNG via the render service (downloads + copies to clipboard)"
        >
          {exportStatus.state === "exporting"
            ? "Exporting…"
            : exportStatus.state === "done"
              ? "Exported ✓"
              : "Export PNG"}
        </button>
      </header>
      <main className={styles.panes}>
        <section className={styles.pane}>
          <Editor initialValue={initialSource.current} onChange={setSource} />
        </section>
        <section className={`${styles.pane} ${styles.previewPane}`}>
          <Preview source={deferredSource} mode={mode} />
        </section>
      </main>
    </div>
  );
}
