import { useCallback, useDeferredValue, useEffect, useState } from "react";
import { Editor } from "./Editor.tsx";
import { Preview } from "./Preview.tsx";
import { WELCOME_DOC } from "./welcomeDoc.ts";
import { TEMPLATES } from "./templates.ts";
import { useExport } from "./useExport.ts";
import { docToHash, hashToDoc, isShareable } from "./shareLink.ts";
import type { ThemeMode } from "../render/index.ts";
import styles from "./App.module.css";

const STORAGE_KEY = "vellum:active-doc";

/** Initial source: a shared #doc= link wins, then localStorage, then welcome (R-19b/R-20). */
function loadInitialSource(): string {
  try {
    const fromHash = hashToDoc(window.location.hash);
    if (fromHash) return fromHash;
    return localStorage.getItem(STORAGE_KEY) ?? WELCOME_DOC;
  } catch {
    return WELCOME_DOC;
  }
}

export function App() {
  const [source, setSource] = useState<string>(loadInitialSource);
  // `seedText` is what the (uncontrolled) editor was last seeded with; bumping
  // `loadKey` remounts the editor to load a template/share without fighting the
  // cursor. `source !== seedText` ⇒ the user has unsaved edits (clobber guard).
  const [seedText, setSeedText] = useState<string>(source);
  const [loadKey, setLoadKey] = useState(0);
  const [mode, setMode] = useState<ThemeMode>("mechanical");
  const [note, setNote] = useState<string | null>(null);
  const { status: exportStatus, exportPng } = useExport();
  const deferredSource = useDeferredValue(source);

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

  // R-19a clobber protection: loading a template/share never silently discards
  // unsaved edits.
  const loadDoc = useCallback(
    (text: string, confirmReplace: boolean) => {
      if (
        confirmReplace &&
        source.trim().length > 0 &&
        source !== seedText &&
        !window.confirm("Replace the current document? Unsaved edits are lost.")
      ) {
        return;
      }
      setSource(text);
      setSeedText(text);
      setLoadKey((k) => k + 1);
      setNote(null);
    },
    [source, seedText],
  );

  const share = useCallback(async () => {
    if (!isShareable(source)) {
      setNote("Document too large to share as a link — download the source.");
      return;
    }
    const hash = docToHash(source);
    window.location.hash = hash;
    const url = `${window.location.origin}${window.location.pathname}${hash}`;
    try {
      await navigator.clipboard.writeText(url);
      setNote("Share link copied to clipboard.");
    } catch {
      setNote("Share link is in the address bar.");
    }
  }, [source]);

  return (
    <div className={styles.app}>
      <header className={styles.toolbar}>
        <span className={styles.brand}>▌ VELLUM</span>
        <span className={styles.tagline}>diegetic document forge</span>

        <select
          className={styles.select}
          value=""
          onChange={(e) => {
            const template = TEMPLATES.find((t) => t.id === e.target.value);
            if (template) loadDoc(template.source, true);
            e.currentTarget.value = "";
          }}
          aria-label="Insert a template"
        >
          <option value="" disabled>
            Templates ▾
          </option>
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>

        <div className={styles.spacer} />

        {note ? (
          <span className={styles.note} role="status">
            {note}
          </span>
        ) : null}
        {exportStatus.state === "error" ? (
          <span className={styles.exportError} role="alert">
            {exportStatus.message}
          </span>
        ) : null}

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

        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => void share()}
          title="Copy a shareable link (the document is encoded in the URL)"
        >
          Share
        </button>
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
          <Editor key={loadKey} initialValue={seedText} onChange={setSource} />
        </section>
        <section className={`${styles.pane} ${styles.previewPane}`}>
          <Preview source={deferredSource} mode={mode} />
        </section>
      </main>
    </div>
  );
}
