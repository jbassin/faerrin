/**
 * Bun-side proxy to the Node voice daemon (plan §11.1). Implements the same
 * `VoiceAdapter` interface the engine already uses (so the engine + its tests are
 * unchanged) and a `VoiceStateResolver`, forwarding each call to the Node
 * subprocess over newline-JSON on stdio. This is the D1 fallback: Bun keeps the
 * server/DB/engine; Node owns the gateway + voice.
 */
import type { Subprocess } from "bun";
import type { TrackEndReason, VoiceAdapter, VoiceStateResolver } from "./voice";

type Pending = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void };

export class SubprocessBot implements VoiceAdapter {
  private readonly proc: Subprocess<"pipe", "pipe", "inherit">;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private buf = "";
  private connected = false;
  private channelId: string | null = null;
  private endCb: ((reason: TrackEndReason) => void) | null = null;
  private cachedPosition = 0;

  /** Set by the bootstrap to drive auto-leave (B2). */
  onPopulation: ((nonBotCount: number) => void) | null = null;

  /** Resolves once the daemon's Discord client is ready (or rejects on early exit). */
  readonly ready: Promise<void>;

  constructor(nodeBin: string, daemonPath: string, env: Record<string, string | undefined>) {
    let readyResolve!: () => void;
    let readyReject!: (e: Error) => void;
    let settled = false;
    this.ready = new Promise<void>((res, rej) => {
      readyResolve = () => {
        settled = true;
        res();
      };
      readyReject = rej;
    });
    // Defensive: callers opt in to awaiting `ready`; if nobody does and the
    // daemon exits, the floating rejection must not surface as "unhandled".
    void this.ready.catch(() => {});

    // `--dns-result-order=ipv4first` belt-and-suspenders with the in-daemon
    // dns.setDefaultResultOrder: this host's IPv6 is broken and Discord voice
    // (*.discord.media) advertises AAAA, so we must keep Node off IPv6.
    this.proc = Bun.spawn([nodeBin, "--dns-result-order=ipv4first", daemonPath], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      env,
    });
    this.readyResolve = readyResolve;
    void this.readLoop();
    void this.proc.exited.then((code) => {
      this.connected = false;
      const err = new Error(`voice daemon exited (code ${code})`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      if (!settled) readyReject(err);
    });
  }

  private readonly readyResolve: () => void;

  private async readLoop(): Promise<void> {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of this.proc.stdout as unknown as AsyncIterable<Uint8Array>) {
        this.buf += decoder.decode(chunk);
        let i: number;
        while ((i = this.buf.indexOf("\n")) >= 0) {
          const line = this.buf.slice(0, i);
          this.buf = this.buf.slice(i + 1);
          if (line.trim()) this.onLine(line);
        }
      }
    } catch {
      // stdout closed/errored when the daemon exited — expected on shutdown.
    }
  }

  private onLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg);
      else p.reject(new Error(String(msg.error ?? "command failed")));
      return;
    }
    switch (msg.event) {
      case "ready":
        this.readyResolve();
        break;
      case "trackEnd": {
        const cb = this.endCb;
        this.endCb = null;
        cb?.((msg.reason as TrackEndReason) ?? "finished");
        break;
      }
      case "population":
        this.onPopulation?.(Number(msg.count ?? 0));
        break;
      case "position":
        this.cachedPosition = Number(msg.positionMs ?? 0);
        break;
    }
  }

  private request(cmd: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(`${JSON.stringify({ id, cmd, ...args })}\n`);
      this.proc.stdin.flush();
    });
  }

  // --- VoiceAdapter ---
  async join(channelId: string): Promise<void> {
    await this.request("join", { channelId });
    this.connected = true;
    this.channelId = channelId;
  }
  leave(): void {
    this.connected = false;
    this.channelId = null;
    this.cachedPosition = 0;
    void this.request("leave").catch(() => {});
  }
  isConnected(): boolean {
    return this.connected;
  }
  currentChannelId(): string | null {
    return this.channelId;
  }
  async play(filePath: string, filter: string, onEnd: (reason: TrackEndReason) => void): Promise<void> {
    this.endCb = onEnd;
    this.cachedPosition = 0;
    await this.request("play", { filePath, filter });
  }
  pause(): void {
    void this.request("pause").catch(() => {});
  }
  resume(): void {
    void this.request("resume").catch(() => {});
  }
  stopAudio(): void {
    this.endCb = null;
    void this.request("stop").catch(() => {});
  }
  positionMs(): number {
    return this.cachedPosition;
  }

  // --- VoiceStateResolver (follow-the-operator, D8) ---
  readonly resolver: VoiceStateResolver = {
    channelOf: async (userId: string) => {
      const res = await this.request("resolveChannel", { userId }).catch(() => ({}) as Record<string, unknown>);
      return (res.channelId as string | null) ?? null;
    },
  };

  /** Terminate the daemon (shutdown). */
  kill(): void {
    this.proc.kill();
  }

  /** Terminate and await full exit — use in tests so no subprocess outlives the run. */
  async close(): Promise<void> {
    this.proc.kill();
    await this.proc.exited;
  }
}
