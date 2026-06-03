// Generates the canonical line-numbered transcripts under ../transcripts/ from
// the pipeline's output (scripts/script/*.txt, in this package) — the single source
// of truth. Replaces the old, broken heartwood/update-transcripts.sh (which had
// dead /emerald/ paths AND a fixed `tail -n +38` that assumed a 37-line header;
// headers actually vary 27–38 lines by campaign).
//
// Transform (header-length agnostic): drop everything up to the first quoted
// line, then per line strip the leading "> " and emit `NNNNNN\t<text>` with a
// 6-digit zero-padded counter (matches the historical `cut -c 3- | nl -n rz` form).
//
// Run: `bun run --filter shared-content build:transcripts` (or from this dir,
// `bun scripts/build-transcripts.ts`).

import { fileURLToPath } from "node:url";
import path from "node:path";
import { readdir, mkdir, rm } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const sharedRoot = path.resolve(here, "..");
const srcDir = path.resolve(sharedRoot, "scripts", "script");
const outDir = path.resolve(sharedRoot, "transcripts");

function transform(raw: string): string {
  const lines = raw.split("\n");
  const start = lines.findIndex((l) => l.startsWith("> "));
  if (start < 0) return ""; // no body found
  const body = lines.slice(start);
  // Trailing empty element from a final newline shouldn't be numbered.
  if (body.length && body[body.length - 1] === "") body.pop();

  let counter = 0;
  const out: string[] = [];
  for (const line of body) {
    const text = line.slice(2); // strip "> " (or first 2 chars), like `cut -c 3-`
    if (text.length > 0) {
      counter += 1;
      out.push(`${String(counter).padStart(6, "0")}\t${text}`);
    } else {
      // `nl -b t` leaves empty lines unnumbered (blank number field).
      out.push(`${" ".repeat(6)}\t`);
    }
  }
  return out.join("\n") + "\n";
}

async function main() {
  const entries = (await readdir(srcDir)).filter((n) => n.endsWith(".txt")).sort();
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const name of entries) {
    const raw = await Bun.file(path.join(srcDir, name)).text();
    await Bun.write(path.join(outDir, name), transform(raw));
  }
  console.log(`build-transcripts: wrote ${entries.length} transcript(s) → ${path.relative(process.cwd(), outDir)}`);
}

await main();
