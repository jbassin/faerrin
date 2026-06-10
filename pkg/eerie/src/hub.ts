import type { RollEvent } from "./schema";

/** A connected SSE client: a sink that receives raw, pre-formatted SSE frames. */
export type SseClient = (frame: string) => void;

/**
 * In-memory fan-out for roll events. The server wraps each /feed connection's
 * stream controller as an SseClient; ingest calls publish(). Deliberately
 * transport-agnostic (clients are plain callbacks) so it unit-tests without HTTP.
 */
export class RollHub {
  readonly #clients = new Set<SseClient>();

  /** Register a client; returns an unsubscribe fn (call on disconnect). */
  add(client: SseClient): () => void {
    this.#clients.add(client);
    return () => {
      this.#clients.delete(client);
    };
  }

  get clientCount(): number {
    return this.#clients.size;
  }

  /** Fan a roll out to every connected client as a `data:` SSE frame. */
  publish(event: RollEvent): void {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.#clients) client(frame);
  }

  /** Send a comment frame to keep proxies/OBS from idling the connection out. */
  heartbeat(): void {
    for (const client of this.#clients) client(": ping\n\n");
  }
}
