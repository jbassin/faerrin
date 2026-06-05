# face

Static web player for the [caster](../caster/README.md) pipeline — lists every finished
episode (anything with an `out/<id>.episode.mp3`) and plays it on a mobile-first,
*Marathon*-styled page. Deployed at **https://caster.iridi.cc**.

- **Astro** (SSG) renders all content to static HTML — phones download almost no JS.
- The audio player + transcript toggle are the only interactive bits; the player
  is a single hydrated **Solid** island (~2 KB gz). The transcript uses native
  `<details>` (zero JS).
- All episode data is read **at build time** from `../out` by
  [`src/lib/episodes.ts`](src/lib/episodes.ts), reusing the pipeline's own types,
  `stripAudioTags`, and arc-title helpers. Exact runtimes come from `ffprobe`.

## Build & deploy

```bash
bun install
bun run site:build      # → dist/  (HTML + assets + audio/*.mp3 copied from ../out)
bun run preview         # serve dist/ locally to check it
```

`dist/` is fully self-contained — point the `caster.iridi.cc` static host / reverse
proxy at `site/dist/`. Re-run `site:build` after generating new episodes to refresh.

```bash
bun run dev             # live dev server while editing the UI
bun run check           # astro check (types)
```

## How it picks up episodes

An episode appears on the site as soon as `out/<id>.episode.mp3` exists (Stage 5
output). The build reads `<id>.script.json` (title/hosts/transcript),
`<id>.digest.json` (synopsis), and `<id>.audio.json` (fallback runtime), then
copies the mp3 into `dist/audio/<id>.mp3` via an `astro:build:done` hook in
[`astro.config.mjs`](astro.config.mjs).
