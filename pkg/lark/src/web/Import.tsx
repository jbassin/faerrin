import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiSend } from "./api";
import { Menu } from "./ui/Menu";

interface JobItem {
  id: number;
  video_id: string;
  title: string;
  status: "queued" | "downloading" | "done" | "error";
  progress_pct: number;
  error: string | null;
}
interface Job {
  id: number;
  type: "single" | "playlist";
  title: string | null;
  status: "queued" | "running" | "done" | "error" | "partial";
  total_items: number;
  completed_items: number;
}
interface Snapshot {
  job: Job;
  items: JobItem[];
}

const TERMINAL = new Set(["done", "error", "partial"]);

/** Submit a YouTube URL and watch per-video download progress over SSE (B22). */
export function Import({ onImported }: { onImported: () => void }) {
  const [url, setUrl] = useState("");
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [collections, setCollections] = useState<{ id: number; name: string }[]>([]);
  const [target, setTarget] = useState(""); // "" = new collection (playlist) / none (single)
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    apiGet<{ id: number; name: string }[]>("/api/v1/collections")
      .then(setCollections)
      .catch(() => {});
  }, []);

  const watch = useCallback(
    (jobId: number) => {
      setBusy(true);
      esRef.current?.close();
      const es = new EventSource(`/api/v1/ingest/jobs/${jobId}/events`);
      esRef.current = es;
      es.onmessage = (ev) => {
        const data = JSON.parse(ev.data) as Snapshot;
        setSnap(data);
        if (data.job && TERMINAL.has(data.job.status)) {
          es.close();
          setBusy(false);
          onImported();
        }
      };
      es.onerror = () => {
        es.close();
        setBusy(false);
      };
    },
    [onImported],
  );

  // Keep the latest `watch` reachable from the mount-only reattach effect
  // without re-running it whenever `onImported` changes identity.
  const watchRef = useRef(watch);
  watchRef.current = watch;

  // On (re)load, resume watching any still-running import (server-side downloads
  // outlive the page, so a returning operator sees live progress again). B22.
  useEffect(() => {
    let cancelled = false;
    apiGet<Job[]>("/api/v1/ingest/jobs")
      .then((jobs) => {
        const active = jobs.find((j) => j.status === "queued" || j.status === "running");
        if (active && !cancelled) watchRef.current(active.id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      esRef.current?.close();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setSnap(null);
    try {
      const job = await apiSend<Job>("POST", "/api/v1/ingest/youtube", {
        url: url.trim(),
        collectionId: target ? Number(target) : undefined,
      });
      setUrl("");
      watch(job.id);
    } catch {
      setBusy(false);
    }
  }

  return (
    <section className="import card">
      <form className="import__form" onSubmit={submit}>
        <input
          className="lib__search"
          placeholder="Paste a YouTube video or playlist URL…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Menu
          label={target ? `into: ${collections.find((c) => String(c.id) === target)?.name ?? "…"}` : "New collection / none"}
          items={[
            { label: "New collection / none", onSelect: () => setTarget("") },
            ...collections.map((c) => ({ label: `into: ${c.name}`, onSelect: () => setTarget(String(c.id)) })),
          ]}
        />
        <button className="btn" type="submit" disabled={busy || !url.trim()}>
          {busy ? "Importing…" : "Import"}
        </button>
      </form>

      {snap && (
        <div className="import__progress">
          <div className="muted">
            {snap.job.title ?? "Importing"} — {snap.job.completed_items}/{snap.job.total_items} · {snap.job.status}
          </div>
          <ul className="import__items">
            {snap.items.map((it) => (
              <li key={it.id} className={`import__item is-${it.status}`}>
                <span className="import__item-title">{it.title}</span>
                <span className="import__bar">
                  <span className="import__bar-fill" style={{ width: `${it.progress_pct}%` }} />
                </span>
                <span className="muted">{it.error ?? it.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
