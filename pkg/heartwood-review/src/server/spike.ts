import { createServerFn } from "@tanstack/react-start";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Phase 0a server-function I/O spike (plan §Phase 0a #4). Proves the three
// server-side capabilities the review app needs from a single `createServerFn`,
// running in TanStack Start SSR (NOT a Bun sidecar like strider):
//   (a) READ  a file under pkg/content (the SSOT wiki/transcripts)
//   (b) WRITE a sidecar file (provenance write, here to a throwaway temp dir)
//   (c) SHELL out to `jj --no-pager status` (read-only) via Bun.spawn
// The dev server cwd is pkg/heartwood-review, so pkg/content is `../content`
// (same cwd-relative convention the heartwood core scripts use).

export interface SpikeResult {
  /** Which JS runtime the server function actually executes in. */
  runtime: string;
  /** First line of a known wiki page, proving content reads work. */
  contentRead: string;
  /** Round-tripped sidecar payload, proving server-side writes work. */
  sidecarWriteRoundTrip: string;
  /** `jj --no-pager status` stdout, proving shell-out to jj works. */
  jjStatus: string;
}

// Use Node child_process (NOT Bun.spawn): the Vite SSR runtime is Node, so the
// `Bun` global is undefined inside server functions. All server-side I/O in this
// app must use node:* APIs for the same reason.
async function runJj(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("jj", ["--no-pager", ...args], {
    cwd: process.cwd(),
  });
  return stdout.trim();
}

export const ioSpike = createServerFn({ method: "GET" }).handler(
  async (): Promise<SpikeResult> => {
    // (a) read a real wiki page from the SSOT
    const samplePage = join(
      process.cwd(),
      "..",
      "content",
      "wiki",
      "Geography",
      "Calaria",
      "Hallia",
      "Sableclutch",
      "index.md",
    );
    const raw = await readFile(samplePage, "utf8");
    const contentRead =
      raw.split("\n").find((l) => l.trim() && !l.startsWith("---")) ??
      "(empty)";

    // (b) write + read back a sidecar payload in a throwaway temp dir
    const dir = await mkdtemp(join(tmpdir(), "hwr-spike-"));
    const sidecar = join(dir, "sample.prov.json");
    const payload = JSON.stringify({ ok: true, at: new Date().toISOString() });
    await writeFile(sidecar, payload, "utf8");
    const sidecarWriteRoundTrip = await readFile(sidecar, "utf8");
    await rm(dir, { recursive: true, force: true });

    // (c) shell out to jj (read-only status)
    const jjStatus = await runJj(["status"]);

    const runtime =
      typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
        ? `bun ${process.versions.bun ?? "?"}`
        : `node ${process.version}`;

    return { runtime, contentRead: contentRead.slice(0, 200), sidecarWriteRoundTrip, jjStatus };
  },
);
