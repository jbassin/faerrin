import { useCallback, useEffect, useMemo, useState } from "react";
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

  async function bulkStripPrefix() {
    const ops = [{ kind: "replace", find: "^\\d+\\s*[-.]\\s*", replaceWith: "", regex: true }];
    const { preview } = await apiSend<{ preview: { from: string; to: string; changed: boolean }[] }>(
      "POST",
      "/api/v1/tracks/bulk-rename",
      { ids: selectedIds, ops, preview: true },
    );
    const changes = preview.filter((p) => p.changed);
    if (changes.length === 0) return window.alert("No titles would change.");
    const sample = changes
      .slice(0, 8)
      .map((c) => `${c.from}  →  ${c.to}`)
      .join("\n");
    if (window.confirm(`Apply to ${changes.length} track(s)?\n\n${sample}`)) {
      await withBusy(async () => {
        await apiSend("POST", "/api/v1/tracks/bulk-rename", { ids: selectedIds, ops });
        await loadTracks();
      });
    }
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
      await fetch("/api/v1/ingest/upload", { method: "POST", credentials: "same-origin", body: form });
      await loadTracks();
    });
  }

  return (
    <div className="lib">
      <aside className="lib__facets">
        <h3>Collections</h3>
        <ul className="lib__list">
          <li>
            <button className={collectionId === null ? "is-active" : ""} onClick={() => setCollectionId(null)}>
              All
            </button>
          </li>
          {collections.map((c) => (
            <li key={c.id}>
              <button className={collectionId === c.id ? "is-active" : ""} onClick={() => setCollectionId(c.id)}>
                {c.name}
              </button>
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
          <button className="btn btn--ghost" disabled={!selected.size || busy} onClick={() => void bulkStripPrefix()}>
            Strip leading number ({selected.size})
          </button>
          <button className="btn btn--ghost" disabled={!selected.size || busy} onClick={() => void bulkTag()}>
            Tag selected
          </button>
          <button className="btn" disabled={!selected.size} onClick={() => void play(selectedIds)}>
            ▶ Play selected
          </button>
        </div>

        <table className="lib__tracks">
          <thead>
            <tr>
              <th />
              <th>Title</th>
              <th>Tags</th>
              <th>Status</th>
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
              </tr>
            ))}
            {tracks.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
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
