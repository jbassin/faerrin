/**
 * Minimal FIFO concurrency gate (SEC-5). Bounds how many renders hit the shared
 * warm browser at once; excess requests queue rather than crashing it.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.available = permits;
  }

  /** Number currently queued (for "queued" UX / observability). */
  get queued(): number {
    return this.waiters.length;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return this.release;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.available -= 1;
    return this.release;
  }

  private release = (): void => {
    this.available += 1;
    const next = this.waiters.shift();
    if (next) next();
  };

  /** Run `fn` while holding a permit. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
