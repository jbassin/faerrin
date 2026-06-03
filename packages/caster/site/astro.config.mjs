import { defineConfig } from "astro/config";
import solid from "@astrojs/solid-js";
import { fileURLToPath } from "node:url";
import { readdir, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

// Pipeline artifacts live one level up, in caster/out (gitignored).
const OUT_DIR = fileURLToPath(new URL("../out", import.meta.url));

/**
 * Copy every finished episode mp3 from ../out into the static bundle as
 * dist/audio/<id>.mp3, so the deployable output is fully self-contained.
 * Runs after Astro writes dist/, hooking astro:build:done.
 */
function copyEpisodeAudio() {
  return {
    name: "caster:copy-episode-audio",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const distDir = fileURLToPath(dir);
        const audioDir = path.join(distDir, "audio");
        await mkdir(audioDir, { recursive: true });

        let copied = 0;
        let entries = [];
        try {
          entries = await readdir(OUT_DIR);
        } catch {
          logger.warn(`no out/ directory at ${OUT_DIR} — no audio copied`);
          return;
        }
        for (const name of entries) {
          if (!name.endsWith(".episode.mp3")) continue;
          const id = name.slice(0, -".episode.mp3".length);
          await copyFile(path.join(OUT_DIR, name), path.join(audioDir, `${id}.mp3`));
          copied++;
        }
        logger.info(`copied ${copied} episode mp3(s) into dist/audio/`);
      },
    },
  };
}

export default defineConfig({
  site: "https://caster.iridi.cc",
  integrations: [solid(), copyEpisodeAudio()],
  // The data layer reads ../out and ../src at build time; allow Vite to read up.
  vite: {
    server: { fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
  },
});
