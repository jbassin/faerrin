import { useEffect, useRef } from "react";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { slashComplete } from "./slashComplete.ts";
import styles from "./App.module.css";

/**
 * Tab inserts 2 spaces (and indents/dedents a multi-line selection) instead of
 * moving focus. `Prec.low` keeps this below the autocomplete keymap, so Tab
 * still accepts an open `/` completion before falling back to indentation.
 */
const tabIndents = [
  indentUnit.of("  "),
  Prec.low(keymap.of([indentWithTab])),
];

/** CM6 theme wired to @faerrin/gothic tokens (NFR-3: colors via vars, no hex). */
const gothicTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--bg-panel)",
      color: "var(--ink)",
      height: "100%",
      fontSize: "14px",
    },
    ".cm-content": {
      fontFamily: "var(--font-mono), monospace",
      caretColor: "var(--accent)",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: "var(--bg-hover)" },
    ".cm-gutters": {
      backgroundColor: "var(--bg-void)",
      color: "var(--ink-faint)",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "var(--bg-elevated)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--bg-elevated)" },
  },
  { dark: true },
);

/**
 * Uncontrolled CodeMirror 6 host. We mount once and push edits out via
 * `onChange`; we deliberately don't re-seed the doc on every `value` change
 * (that would fight the user's cursor). `onChange` is read through a ref so the
 * mount effect never needs to re-run.
 */
export function Editor({
  initialValue,
  onChange,
}: {
  initialValue: string;
  onChange: (value: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    const listener = EditorView.updateListener.of((update) => {
      if (update.docChanged) onChangeRef.current(update.state.doc.toString());
    });

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          basicSetup,
          markdown(),
          slashComplete,
          tabIndents,
          EditorView.lineWrapping,
          gothicTheme,
          listener,
        ],
      }),
    });

    return () => view.destroy();
    // Mount once; initialValue is the seed, onChange is via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className={styles.editor} ref={host} />;
}
