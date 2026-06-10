import { useCallback, useEffect, useMemo, useState } from "react";
import type { RenameOp } from "../lib/rename";
import { apiGet, apiSend } from "./api";
import type { Collection, Tag, Track } from "./types";

/** The library browser: filter by collection/tag/search, multi-select, rename, bulk tag, upload. */
export function Library() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [collectionId, setCollectionId] = useState<number | null>(null);
  const [tagId, setTagId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const loadFacets = useCallback(async () => {
    setCollections(await apiGet<Collection[]>("/api/v1/collections"));
    setTags(await apiGet<Tag[]>("/api/v1/tags"));
  }, []);

  const loadTracks = useCallback(async () => {
    const params = new URLSearchParams();
    if (collectionId) params.set("collection", String(collectionId));
    if (tagId) params.set("tag", String(tagId));
    if (q.trim()) params.set("q", q.trim());
    setTracks(await apiGet<Track[]>(`/api/v1/tracks?${params.toString()}`));
  }, [collectionId, tagId, q]);

  useEffect(() => {
    void loadFacets();
  }, [loadFacets]);
  useEffect(() => {
    void loadTracks();
  }, [loadTracks]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Select-all operates on the current (filtered) view.
  const allSelected = tracks.length > 0 && tracks.every((t) => selected.has(t.id));
  const someSelected = tracks.some((t) => selected.has(t.id));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const t of tracks) (allSelected ? next.delete(t.id) : next.add(t.id));
      return next;
    });

  const selectedIds = useMemo(() => [...selected], [selected]);

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  async function renameOne(track: Track) {
    const title = window.prompt("Rename track", track.title);
    if (title && title !== track.title) {
      await withBusy(async () => {
        await apiSend("PATCH", `/api/v1/tracks/${track.id}`, { title });
        await loadTracks();
      });
    }
  }

  /** Preview a bulk rename, show a sample diff, and apply on confirm. */
  async function runBulkRename(ops: RenameOp[], emptyMsg: string) {
    const { preview } = await apiSend<{ preview: { from: string; to: string; changed: boolean }[] }>(
      "POST",
      "/api/v1/tracks/bulk-rename",
      { ids: selectedIds, ops, preview: true },
    );
    const changes = preview.filter((p) => p.changed);
    if (changes.length === 0) return window.alert(emptyMsg);
    const sample = changes
      .slice(0, 10)
      .map((c) => `${c.from}\n   →  ${c.to || "(empty)"}`)
      .join("\n");
    if (window.confirm(`Apply to ${changes.length} of ${selectedIds.length} selected?\n\n${sample}`)) {
      await withBusy(async () => {
        await apiSend("POST", "/api/v1/tracks/bulk-rename", { ids: selectedIds, ops });
        await loadTracks();
      });
    }
  }

  const stripLeadingNumber = () =>
    runBulkRename(
      [{ kind: "replace", find: "^\\d+\\s*[-.]\\s*", replaceWith: "", regex: true }],
      "No selected titles start with a number.",
    );

  async function stripPrefix() {
    const value = window.prompt("Remove this text from the START of every selected title:");
    if (!value) return;
    await runBulkRename(
      [{ kind: "stripPrefix", value }, { kind: "collapseWhitespace" }],
      `No selected titles start with "${value}".`,
    );
  }

  async function stripSuffix() {
    const value = window.prompt("Remove this text from the END of every selected title:");
    if (!value) return;
    await runBulkRename(
      [{ kind: "stripSuffix", value }, { kind: "collapseWhitespace" }],
      `No selected titles end with "${value}".`,
    );
  }

  async function deleteSelected() {
    if (!window.confirm(`Delete ${selected.size} track(s) and their audio files? This cannot be undone.`)) return;
    await withBusy(async () => {
      await apiSend("POST", "/api/v1/tracks/bulk-delete", { ids: selectedIds });
      setSelected(new Set());
      await loadFacets();
      await loadTracks();
    });
  }

  async function deleteOne(t: Track) {
    if (!window.confirm(`Delete "${t.title}" and its file? This cannot be undone.`)) return;
    await withBusy(async () => {
      await apiSend("DELETE", `/api/v1/tracks/${t.id}`);
      await loadTracks();
    });
  }

  // --- collection management ---
  async function newCollection() {
    const name = window.prompt("New collection name:");
    if (!name?.trim()) return;
    await withBusy(async () => {
      await apiSend("POST", "/api/v1/collections", { name: name.trim() });
      await loadFacets();
    });
  }

  async function renameCollection(c: Collection) {
    const name = window.prompt("Rename collection:", c.name);
    if (!name?.trim() || name === c.name) return;
    await withBusy(async () => {
      await apiSend("PATCH", `/api/v1/collections/${c.id}`, { name: name.trim() });
      await loadFacets();
    });
  }

  async function deleteCollection(c: Collection) {
    if (!window.confirm(`Delete collection "${c.name}"? Its tracks are kept (moved to no collection).`)) return;
    await withBusy(async () => {
      await apiSend("DELETE", `/api/v1/collections/${c.id}`);
      if (collectionId === c.id) setCollectionId(null);
      await loadFacets();
      await loadTracks();
    });
  }

  async function moveSelected(value: string) {
    if (!value || !selected.size) return;
    const target = value === "none" ? null : Number(value);
    await withBusy(async () => {
      await apiSend("POST", "/api/v1/tracks/bulk-move", { ids: selectedIds, collectionId: target });
      await loadFacets();
      await loadTracks();
    });
  }

  async function bulkTag() {
    const raw = window.prompt("Add tag(s) to selected (comma-separated)", "calm");
    if (!raw) return;
    const addTags = raw.split(",").map((s) => s.trim()).filter(Boolean);
    await withBusy(async () => {
      await apiSend("POST", "/api/v1/tracks/bulk-tag", { ids: selectedIds, addTags });
      await loadFacets();
      await loadTracks();
    });
  }

  async function play(trackIds: number[]) {
    if (trackIds.length === 0) return;
    try {
      await apiSend("POST", "/api/v1/playback/play", { trackIds });
    } catch {
      window.alert("Playback unavailable (is the Discord bot online and are you in a voice channel?).");
    }
  }

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const form = new FormData();
    for (const f of files) form.append("files", f);
    if (collectionId) form.append("collectionId", String(collectionId));
    await withBusy(async () => {
      try {
        const res = await fetch("/api/v1/ingest/upload", { method: "POST", credentials: "same-origin", body: form });
        if (!res.ok) {
          window.alert(`Upload failed: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
          return;
        }
        const out = (await res.json()) as { created: unknown[]; errors: { name: string; error: string }[] };
        if (out.errors?.length) {
          window.alert(`Skipped ${out.errors.length} file(s):\n${out.errors.map((e) => `${e.name}: ${e.error}`).join("\n")}`);
        }
        await loadFacets();
        await loadTracks();
      } catch (err) {
        window.alert(`Upload failed: ${(err as Error).message}`);
      }
    });
  }

  return (
    <div className="lib">
      <aside className="lib__facets">
        <h3>
          Collections
          <button className="lib__add" title="New collection" onClick={() => void newCollection()}>
            ＋
          </button>
        </h3>
        <ul className="lib__list">
          <li>
            <button className={collectionId === null ? "is-active" : ""} onClick={() => setCollectionId(null)}>
              All
            </button>
          </li>
          {collections.map((c) => (
            <li key={c.id} className="lib__collrow">
              <button className={collectionId === c.id ? "is-active" : ""} onClick={() => setCollectionId(c.id)}>
                {c.name}
              </button>
              <span className="lib__collacts">
                <button title="Rename" onClick={() => void renameCollection(c)}>
                  ✎
                </button>
                <button title="Delete collection" onClick={() => void deleteCollection(c)}>
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>

        <h3>Tags</h3>
        <ul className="lib__list lib__tags">
          <li>
            <button className={tagId === null ? "is-active" : ""} onClick={() => setTagId(null)}>
              any
            </button>
          </li>
          {tags.map((t) => (
            <li key={t.id}>
              <button className={tagId === t.id ? "is-active" : ""} onClick={() => setTagId(t.id)}>
                {t.name} {t.track_count ? <span className="muted">· {t.track_count}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="lib__main">
        <div className="lib__toolbar">
          <input
            className="lib__search"
            placeholder="Search titles…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="btn btn--ghost">
            Upload
            <input type="file" multiple hidden accept="audio/*" onChange={(e) => upload(e.target.files)} />
          </label>
          <span className="lib__selcount">{selected.size} selected</span>
          <button className="btn btn--ghost" disabled={!selected.size || busy} onClick={() => void stripPrefix()}>
            Strip prefix…
          </button>
          <button className="btn btn--ghost" disabled={!selected.size || busy} onClick={() => void stripSuffix()}>
            Strip suffix…
          </button>
          <button className="btn btn--ghost" disabled={!selected.size || busy} onClick={() => void stripLeadingNumber()}>
            Strip #
          </button>
          <button className="btn btn--ghost" disabled={!selected.size || busy} onClick={() => void bulkTag()}>
            Tag
          </button>
          <select
            className="lib__moveto"
            disabled={!selected.size || busy}
            value=""
            onChange={(e) => void moveSelected(e.target.value)}
          >
            <option value="">Move to…</option>
            <option value="none">(no collection)</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="btn btn--ghost btn--danger" disabled={!selected.size || busy} onClick={() => void deleteSelected()}>
            Delete
          </button>
          <button className="btn" disabled={!selected.size} onClick={() => void play(selectedIds)}>
            ▶ Play
          </button>
        </div>

        <table className="lib__tracks">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  title="Select all (filtered)"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allSelected && someSelected;
                  }}
                  onChange={toggleAll}
                />
              </th>
              <th>Title</th>
              <th>Tags</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tracks.map((t) => (
              <tr key={t.id} className={selected.has(t.id) ? "is-selected" : ""}>
                <td>
                  <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                </td>
                <td>
                  <button className="lib__play" title="Play" onClick={() => void play([t.id])}>
                    ▶
                  </button>
                  <button className="lib__title" onClick={() => void renameOne(t)} title="Click to rename">
                    {t.title}
                  </button>
                </td>
                <td className="muted">{t.tags.map((tag) => tag.name).join(", ")}</td>
                <td className={t.status === "error" ? "is-error" : "muted"}>{t.status}</td>
                <td>
                  <button className="lib__del" title="Delete track + file" onClick={() => void deleteOne(t)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {tracks.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No tracks — upload audio or import from YouTube.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
