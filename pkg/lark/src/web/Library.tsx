import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import type { RenameOp } from "../lib/rename";
import { apiGet, apiSend } from "./api";
import { groupByColor, rowTintStyle } from "./grouping";
import { usePlayback } from "./playbackState";
import type { Collection, Tag, Track } from "./types";
import { useDialog } from "./ui/Dialog";
import { Menu } from "./ui/Menu";
import { TagEditModal } from "./ui/TagEditModal";
import { useToast } from "./ui/Toast";

/** Row style: colored-tag tint, with selection taking over the background. */
function rowStyle(color: string | null, selected: boolean): CSSProperties | undefined {
  const tint = rowTintStyle(color);
  if (!selected) return tint;
  return { ...(tint ?? {}), background: "var(--row-sel)" };
}

/** The library browser: filter by collection/tag/search, multi-select, rename, bulk tag, upload. */
export function Library() {
  const toast = useToast();
  const { confirm, promptText } = useDialog();
  const playback = usePlayback();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [collectionId, setCollectionId] = useState<number | null>(null);
  const [tagId, setTagId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);

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
  const sections = useMemo(() => groupByColor(tracks), [tracks]);
  // The track id currently sounding (not just queued/paused), for the row toggle.
  const playingId = playback.np?.status === "playing" ? playback.np.current?.trackId : undefined;

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  async function renameOne(track: Track) {
    const title = await promptText({ title: "Rename track", defaultValue: track.title });
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
    if (changes.length === 0) return toast.info(emptyMsg);
    const sample = changes
      .slice(0, 10)
      .map((c) => `${c.from}\n   →  ${c.to || "(empty)"}`)
      .join("\n");
    const ok = await confirm({
      title: "Apply bulk rename",
      body: (
        <>
          <p className="muted">
            Apply to {changes.length} of {selectedIds.length} selected?
          </p>
          <pre className="modal__diff">{sample}</pre>
        </>
      ),
      confirmLabel: `Apply ${changes.length}`,
    });
    if (ok) {
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
    const value = await promptText({ title: "Strip prefix", label: "Remove this text from the START of every selected title:" });
    if (!value) return;
    await runBulkRename(
      [{ kind: "stripPrefix", value }, { kind: "collapseWhitespace" }],
      `No selected titles start with "${value}".`,
    );
  }

  async function stripSuffix() {
    const value = await promptText({ title: "Strip suffix", label: "Remove this text from the END of every selected title:" });
    if (!value) return;
    await runBulkRename(
      [{ kind: "stripSuffix", value }, { kind: "collapseWhitespace" }],
      `No selected titles end with "${value}".`,
    );
  }

  async function deleteSelected() {
    const ok = await confirm({
      title: "Delete tracks",
      body: `Delete ${selected.size} track(s) and their audio files? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await withBusy(async () => {
      await apiSend("POST", "/api/v1/tracks/bulk-delete", { ids: selectedIds });
      setSelected(new Set());
      await loadFacets();
      await loadTracks();
    });
  }

  // --- collection management ---
  async function newCollection() {
    const name = await promptText({ title: "New collection", label: "Collection name:" });
    if (!name?.trim()) return;
    await withBusy(async () => {
      await apiSend("POST", "/api/v1/collections", { name: name.trim() });
      await loadFacets();
    });
  }

  async function renameCollection(c: Collection) {
    const name = await promptText({ title: "Rename collection", defaultValue: c.name });
    if (!name?.trim() || name === c.name) return;
    await withBusy(async () => {
      await apiSend("PATCH", `/api/v1/collections/${c.id}`, { name: name.trim() });
      await loadFacets();
    });
  }

  async function deleteCollection(c: Collection) {
    const ok = await confirm({
      title: "Delete collection",
      body: `Delete collection "${c.name}"? Its tracks are kept (moved to no collection).`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
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

  async function applyTags(addTags: string[]) {
    if (addTags.length === 0 || !selected.size) return;
    await withBusy(async () => {
      await apiSend("POST", "/api/v1/tracks/bulk-tag", { ids: selectedIds, addTags });
      await loadFacets();
      await loadTracks();
    });
  }

  async function bulkTag() {
    const raw = await promptText({ title: "New tag", label: "Tag(s) to add to selected (comma-separated):", placeholder: "calm, ambient" });
    if (!raw) return;
    await applyTags(raw.split(",").map((s) => s.trim()).filter(Boolean));
  }

  async function saveTag(tag: Tag, patch: { name: string; color: string | null }) {
    await apiSend("PATCH", `/api/v1/tags/${tag.id}`, patch);
    await loadFacets();
    await loadTracks(); // color change can re-group / re-tint rows
  }

  async function play(trackIds: number[]) {
    if (trackIds.length === 0) return;
    try {
      await playback.playTracks(trackIds);
    } catch {
      toast.error("Playback unavailable — is the Discord bot online and are you in a voice channel?");
    }
  }

  /** Row button: pause/resume if this track is the current one, otherwise start it. */
  function togglePlay(t: Track) {
    const np = playback.np;
    if (np?.current?.trackId === t.id) {
      if (np.status === "playing") return void playback.cmd("/api/v1/playback/pause");
      if (np.status === "paused") return void playback.cmd("/api/v1/playback/resume");
    }
    void play([t.id]);
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
          toast.error(`Upload failed: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
          return;
        }
        const out = (await res.json()) as { created: unknown[]; errors: { name: string; error: string }[] };
        if (out.errors?.length) {
          toast.error(`Skipped ${out.errors.length} file(s): ${out.errors.map((e) => `${e.name} (${e.error})`).join("; ")}`);
        }
        await loadFacets();
        await loadTracks();
      } catch (err) {
        toast.error(`Upload failed: ${(err as Error).message}`);
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
        <ul className="lib__list">
          <li>
            <button className={tagId === null ? "is-active" : ""} onClick={() => setTagId(null)}>
              any
            </button>
          </li>
          {tags.map((t) => (
            <li key={t.id} className="lib__tagrow">
              <button className={tagId === t.id ? "is-active" : ""} onClick={() => setTagId(t.id)}>
                <span
                  className="lib__tagdot"
                  style={{ background: t.color ?? "transparent", borderColor: t.color ?? "var(--muted)" }}
                />
                {t.name} {t.track_count ? <span className="muted">· {t.track_count}</span> : null}
              </button>
              <button className="lib__tagedit" title="Edit tag" onClick={() => setEditingTag(t)}>
                ✎
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="lib__main">
        <div className="lib__bar">
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
        </div>

        <div className="lib__selbar">
          <span className="lib__selcount">{selected.size} selected</span>
          <Menu
            label="Rename"
            disabled={!selected.size || busy}
            items={[
              { label: "Strip prefix…", onSelect: () => void stripPrefix() },
              { label: "Strip suffix…", onSelect: () => void stripSuffix() },
              { label: "Strip leading number", onSelect: () => void stripLeadingNumber() },
            ]}
          />
          <Menu
            label="Tag"
            disabled={!selected.size || busy}
            items={[
              ...tags.map((t) => ({
                label: t.name,
                color: t.color,
                onSelect: () => void applyTags([t.name]),
              })),
              { label: "New tag…", onSelect: () => void bulkTag() },
            ]}
          />
          <Menu
            label="Move to"
            disabled={!selected.size || busy}
            items={[
              { label: "(no collection)", onSelect: () => void moveSelected("none") },
              ...collections.map((c) => ({ label: c.name, onSelect: () => void moveSelected(String(c.id)) })),
            ]}
          />
          <button
            className="btn btn--ghost btn--danger"
            disabled={!selected.size || busy}
            onClick={() => void deleteSelected()}
          >
            Delete
          </button>
          <button className="btn" disabled={!selected.size || busy} onClick={() => void play(selectedIds)}>
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
            </tr>
          </thead>
          {tracks.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={3} className="muted">
                  No tracks — upload audio or import from YouTube.
                </td>
              </tr>
            </tbody>
          ) : (
            sections.map((sec) => (
              <tbody key={sec.key}>
                <tr className="lib__secthead">
                  <td colSpan={3}>
                    <span
                      className="lib__sectdot"
                      style={{ background: sec.color ?? "transparent", borderColor: sec.color ?? "var(--muted)" }}
                    />
                    {sec.label} <span className="muted">· {sec.tracks.length}</span>
                  </td>
                </tr>
                {sec.tracks.map((t) => (
                  <tr key={t.id} className={selected.has(t.id) ? "is-selected" : ""} style={rowStyle(sec.color, selected.has(t.id))}>
                    <td>
                      <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                    </td>
                    <td>
                      <button
                        className="lib__play"
                        title={playingId === t.id ? "Pause" : "Play"}
                        onClick={() => togglePlay(t)}
                      >
                        {playingId === t.id ? "⏸" : "▶"}
                      </button>
                      {t.status === "error" && (
                        <span className="lib__warn" title="File error — track may not play">
                          ⚠
                        </span>
                      )}
                      <button className="lib__title" onClick={() => void renameOne(t)} title="Click to rename">
                        {t.title}
                      </button>
                    </td>
                    <td>
                      <div className="lib__tagcell">
                        {t.tags.map((tag) => (
                          <span
                            key={tag.id}
                            className="lib__chip"
                            style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            ))
          )}
        </table>
      </section>

      {editingTag && (
        <TagEditModal
          tag={editingTag}
          onClose={() => setEditingTag(null)}
          onSave={(patch) => saveTag(editingTag, patch)}
        />
      )}
    </div>
  );
}
