/**
 * yt-dlp wrappers (plan B20/B21). The `YtDlp` interface is injected so the
 * ingest service can be unit-tested with a stub — the real impl shells out to
 * the `yt-dlp` binary and is never imported by tests (CI-safe, §11.2/§11.3).
 */
export interface PlaylistEntry {
  videoId: string;
  title: string;
}

export interface PlaylistInfo {
  title: string;
  entries: PlaylistEntry[];
}

export interface DownloadTarget {
  /** A full video URL, or a bare videoId (resolved to a watch URL). */
  url?: string;
  videoId?: string;
}

export interface DownloadResult {
  filePath: string;
  title: string;
  videoId: string;
  format: string;
  durationMs?: number;
  fileSize?: number;
}

export interface YtDlp {
  enumerate(url: string): Promise<PlaylistInfo>;
  download(target: DownloadTarget, destDir: string, onProgress?: (pct: number) => void): Promise<DownloadResult>;
}

/**
 * Whether a URL should be treated as a playlist import (B21) vs a single video
 * (B20). A `list=` param means playlist — EXCEPT auto-generated radio/mix lists
 * (`RD…`, `UL…`), which are effectively infinite and treated as a single video.
 */
export function isPlaylistUrl(url: string): boolean {
  let list: string | null;
  try {
    list = new URL(url).searchParams.get("list");
  } catch {
    return false;
  }
  if (!list) return false;
  return !/^(RD|UL|RDMM|RDCLAK)/.test(list);
}

/** Best-effort extraction of the `v=` video id (or youtu.be path). */
export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    return u.searchParams.get("v");
  } catch {
    return null;
  }
}

async function runJson(cmd: string[]): Promise<unknown> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) throw new Error(`yt-dlp failed (exit ${code})`);
  return JSON.parse(out);
}

/** The real yt-dlp-backed implementation used on the host. */
export const realYtDlp: YtDlp = {
  async enumerate(url) {
    const data = (await runJson([
      "yt-dlp",
      "--flat-playlist",
      "--dump-single-json",
      "--no-warnings",
      url,
    ])) as { title?: string; entries?: { id?: string; title?: string }[] };
    return {
      title: data.title ?? "Imported playlist",
      entries: (data.entries ?? [])
        .filter((e): e is { id: string; title?: string } => typeof e.id === "string")
        .map((e) => ({ videoId: e.id, title: e.title ?? e.id })),
    };
  },

  async download(target, destDir, onProgress) {
    const url = target.url ?? `https://www.youtube.com/watch?v=${target.videoId}`;
    const outTmpl = `${destDir}/%(id)s.%(ext)s`;
    const proc = Bun.spawn(
      [
        "yt-dlp",
        "-f",
        "bestaudio/best",
        "--no-playlist",
        "--newline",
        "--no-warnings",
        "--print",
        "after_move:%(id)s\t%(title)s\t%(ext)s\t%(duration)s\t%(filepath)s",
        "-o",
        outTmpl,
        url,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    let meta: DownloadResult | null = null;
    const decoder = new TextDecoder();
    // Bun's stdout ReadableStream is async-iterable at runtime; the DOM lib type omits it.
    for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
      for (const line of decoder.decode(chunk).split("\n")) {
        const prog = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (prog && onProgress) onProgress(Number(prog[1]));
        if (line.includes("\t")) {
          const [videoId, title, ext, duration, filepath] = line.split("\t");
          if (videoId && filepath) {
            meta = {
              videoId,
              title: title ?? videoId,
              format: ext ?? "webm",
              filePath: filepath.trim(),
              durationMs: duration && duration !== "NA" ? Math.round(Number(duration) * 1000) : undefined,
            };
          }
        }
      }
    }
    if ((await proc.exited) !== 0 || !meta) throw new Error("yt-dlp download failed");
    onProgress?.(100);
    return meta;
  },
};
