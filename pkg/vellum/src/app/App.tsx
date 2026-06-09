import { useCallback, useDeferredValue, useEffect, useState } from "react";
import { Editor } from "./Editor.tsx";
import { Preview } from "./Preview.tsx";
import { WELCOME_DOC } from "./welcomeDoc.ts";
import { TEMPLATES } from "./templates.ts";
import { useExport } from "./useExport.ts";
import { docToHash, hashToDoc, isShareable } from "./shareLink.ts";
import {
  type DocStore,
  loadStore,
  saveStore,
  addDoc,
  setActive,
  updateActiveSource,
  renameActive,
  deleteDoc,
  activeDoc,
} from "./docStore.ts";
import type { ThemeMode } from "../render/index.ts";
import styles from "./App.module.css";

/** Initial store: migrate/load, then a #doc= share link opens as a new doc. */
function initialStore(): DocStore {
  const base = loadStore(WELCOME_DOC);
  try {
    const shared = hashToDoc(window.location.hash);
    if (shared) return addDoc(base, shared);
  } catch {
    /* ignore */
  }
  return base;
}

export function App() {
  const [store, setStore] = useState<DocStore>(initialStore);
  const active = activeDoc(store);
  const [source, setSource] = useState<string>(active.source);
  const [seedText, setSeedText] = useState<string>(active.source);
  const [loadKey, setLoadKey] = useState(0);
  const [mode, setMode] = useState<ThemeMode>("mechanical");
  const [note, setNote] = useState<string | null>(null);
  const { status: exportStatus, exportPng } = useExport();
  const deferredSource = useDeferredValue(source);

  // Once: a share link is now its own doc — strip it so reload doesn't re-add.
  useEffect(() => {
    if (window.location.hash.startsWith("#doc=")) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, []);

  // Debounced persist of the active doc's source (R-19 autosave).
  useEffect(() => {
    const id = setTimeout(() => {
      setStore((prev) => {
        const next = updateActiveSource(prev, source);
        saveStore(next);
        return next;
      });
    }, 300);
    return () => clearTimeout(id);
  }, [source]);

  /** Switch which doc is active, seeding the editor with its text. */
  const openDoc = useCallback(
    (next: DocStore) => {
      saveStore(next);
      setStore(next);
      const text = activeDoc(next).source;
      setSource(text);
      setSeedText(text);
      setLoadKey((k) => k + 1);
      setNote(null);
    },
    [],
  );

  const flushed = useCallback(
    () => updateActiveSource(store, source),
    [store, source],
  );

  const newDoc = () => openDoc(addDoc(flushed(), ""));
  const openTemplate = (src: string) => openDoc(addDoc(flushed(), src));
  const switchTo = (id: string) => openDoc(setActive(flushed(), id));

  const rename = () => {
    const title = window.prompt("Document title", active.title);
    if (title == null) return;
    const next = renameActive(flushed(), title);
    saveStore(next);
    setStore(next);
  };

  const removeActive = () => {
    if (!window.confirm(`Delete "${active.title}"?`)) return;
    openDoc(deleteDoc(store, active.id));
  };

  const share = useCallback(async () => {
    if (!isShareable(source)) {
      setNote("Document too large to share as a link — download the source.");
      return;
    }
    const hash = docToHash(source);
    const url = `${window.location.origin}${window.location.pathname}${hash}`;
    try {
      await navigator.clipboard.writeText(url);
      setNote("Share link copied to clipboard.");
    } catch {
      setNote("Could not access the clipboard — copy the address bar.");
      window.location.hash = hash;
    }
  }, [source]);

  return (
    <div className={styles.app}>
      <header className={styles.toolbar}>
        <span className={styles.brand}>▌ VELLUM</span>

        <div className={styles.docbar}>
          <select
            className={styles.select}
            value={active.id}
            onChange={(e) => switchTo(e.target.value)}
            aria-label="Active document"
          >
            {store.docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.iconButton}
            onClick={newDoc}
            title="New document"
          >
            ＋
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={rename}
            title="Rename document"
          >
            ✎
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={removeActive}
            title="Delete document"
          >
            🗑
          </button>
        </div>

        <select
          className={styles.select}
          value=""
          onChange={(e) => {
            const template = TEMPLATES.find((t) => t.id === e.target.value);
            if (template) openTemplate(template.source);
            e.currentTarget.value = "";
          }}
          aria-label="Open a template"
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
