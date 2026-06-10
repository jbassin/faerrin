import type { RollEvent } from "./schema";

export type FeedStatus = "open" | "closed";

export interface FeedOptions {
  /** SSE endpoint; same-origin default works in prod and (via vite proxy) in dev. */
  url?: string;
  onRoll: (event: RollEvent) => void;
  onStatus?: (status: FeedStatus) => void;
  /** Reconnect delay after a hard close (ms). */
  reconnectMs?: number;
}

/**
 * Subscribe to the server's roll feed. EventSource reconnects on transient drops
 * by itself; we additionally re-open after a hard CLOSED so an OBS source that's
 * been hidden/shown recovers without a manual refresh. Returns an unsubscribe fn.
 */
export function connectFeed(opts: FeedOptions): () => void {
  const { url = "/feed", onRoll, onStatus, reconnectMs = 2000 } = opts;
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const open = () => {
    if (stopped) return;
    source = new EventSource(url);

    source.onopen = () => onStatus?.("open");

    source.onmessage = (ev: MessageEvent<string>) => {
      try {
        onRoll(JSON.parse(ev.data) as RollEvent);
      } catch {
        // Ignore a malformed frame rather than tearing down the feed.
      }
    };

    source.onerror = () => {
      onStatus?.("closed");
      if (source && source.readyState === EventSource.CLOSED) {
        source.close();
        source = null;
        timer = setTimeout(open, reconnectMs);
      }
    };
  };

  open();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    source?.close();
  };
}
