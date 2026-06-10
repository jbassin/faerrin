/**
 * Per-job pub/sub for SSE download progress (plan B22). Mirrors eerie's hub
 * idea but keyed by job id, so a browser watching one import only receives that
 * job's frames. Listeners receive ready-to-write SSE frame strings.
 */
export type SseListener = (frame: string) => void;

export class JobHub {
  private readonly subs = new Map<number, Set<SseListener>>();

  subscribe(jobId: number, listener: SseListener): () => void {
    let set = this.subs.get(jobId);
    if (!set) this.subs.set(jobId, (set = new Set()));
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) this.subs.delete(jobId);
    };
  }

  /** Publish a JSON payload to everyone watching `jobId` as one SSE `data:` event. */
  publish(jobId: number, payload: unknown): void {
    const set = this.subs.get(jobId);
    if (!set || set.size === 0) return;
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const listener of set) {
      try {
        listener(frame);
      } catch {
        set.delete(listener);
      }
    }
  }

  subscriberCount(jobId: number): number {
    return this.subs.get(jobId)?.size ?? 0;
  }
}
