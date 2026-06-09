/**
 * Multi-document store (rest of R-19). Pure reducers over a {docs, activeId}
 * state plus thin localStorage load/save with migration from the old
 * single-document key. The editor is one active doc at a time; new/switch/
 * rename/delete operate here.
 */
export interface VellumDoc {
  id: string;
  title: string;
  source: string;
  /** true once the user renames, so edits stop re-deriving the title. */
  titlePinned?: boolean;
  updatedAt: number;
}

export interface DocStore {
  docs: VellumDoc[];
  activeId: string;
}

const STORE_KEY = "vellum:docs";
const LEGACY_KEY = "vellum:active-doc";
const UNTITLED = "Untitled";

/** Title from the first `:::kind[Label]`, else "Untitled". */
export function deriveTitle(source: string): string {
  const match = source.match(/:::[a-z]+\[([^\]\n]+)\]/i);
  return match?.[1]?.trim() || UNTITLED;
}

let fallbackCounter = 0;
function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `doc-${Date.now()}-${fallbackCounter}`;
}

export function createDoc(
  source = "",
  opts?: { id?: string; now?: number },
): VellumDoc {
  return {
    id: opts?.id ?? newId(),
    title: deriveTitle(source),
    source,
    updatedAt: opts?.now ?? Date.now(),
  };
}

export function emptyStore(
  source = "",
  opts?: { id?: string; now?: number },
): DocStore {
  const doc = createDoc(source, opts);
  return { docs: [doc], activeId: doc.id };
}

export function activeDoc(store: DocStore): VellumDoc {
  return store.docs.find((d) => d.id === store.activeId) ?? store.docs[0]!;
}

/** Append a new document and make it active. */
export function addDoc(
  store: DocStore,
  source = "",
  opts?: { id?: string; now?: number },
): DocStore {
  const doc = createDoc(source, opts);
  return { docs: [...store.docs, doc], activeId: doc.id };
}

export function setActive(store: DocStore, id: string): DocStore {
  return store.docs.some((d) => d.id === id) ? { ...store, activeId: id } : store;
}

/** Update the active document's source (re-deriving title unless pinned). */
export function updateActiveSource(
  store: DocStore,
  source: string,
  opts?: { now?: number },
): DocStore {
  return {
    ...store,
    docs: store.docs.map((d) =>
      d.id === store.activeId
        ? {
            ...d,
            source,
            title: d.titlePinned ? d.title : deriveTitle(source),
            updatedAt: opts?.now ?? Date.now(),
          }
        : d,
    ),
  };
}

export function renameActive(store: DocStore, title: string): DocStore {
  const clean = title.trim();
  return {
    ...store,
    docs: store.docs.map((d) =>
      d.id === store.activeId
        ? { ...d, title: clean || d.title, titlePinned: true }
        : d,
    ),
  };
}

/** Delete a document; deleting the last one resets to a single empty doc. */
export function deleteDoc(store: DocStore, id: string): DocStore {
  if (store.docs.length <= 1) return emptyStore("");
  const docs = store.docs.filter((d) => d.id !== id);
  const activeId =
    store.activeId === id ? docs[docs.length - 1]!.id : store.activeId;
  return { docs, activeId };
}

// ── persistence ─────────────────────────────────────────────────────────

export function loadStore(fallbackSource: string): DocStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DocStore;
      if (parsed?.docs?.length) return parsed;
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy != null) return emptyStore(legacy);
  } catch {
    /* corrupt/unavailable storage — fall through */
  }
  return emptyStore(fallbackSource);
}

export function saveStore(store: DocStore): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* private mode / quota — non-fatal */
  }
}
