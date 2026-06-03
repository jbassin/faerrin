// Static JSON endpoint, emitted as dist/episodes.json at build time. Maps each
// finished episode's session date ("YYYY-M-D", e.g. "2026-5-25") to an object with
// the absolute URL of its transcript page and the episode title, so downstream
// systems can resolve a session date to a directly linkable, labelled episode.
// Reuses the same build-time data layer as the pages, so the manifest can never
// drift from what the site actually serves.

import type { APIRoute } from "astro";
import { loadEpisodes } from "../lib/episodes.ts";

// No adapter is configured, so this is prerendered to a static file; make it
// explicit so it stays static even if SSR is enabled later.
export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  const episodes = await loadEpisodes();

  // Date -> { link, title }. `link` is the absolute transcript-page URL resolved
  // against the configured `site` origin; the episode page lives at `/<id>` (the
  // [id].astro route). Falls back to the relative path if `site` is unset (no
  // origin to anchor to). `title` is the campaign-prefix-stripped episode title.
  // loadEpisodes orders by arc then date; on the rare chance two sessions share a
  // date, the later-ordered one wins (last write).
  const byDate: Record<string, { link: string; title: string }> = {};
  for (const ep of episodes) {
    const transcriptPath = `/${ep.id}`;
    byDate[ep.date] = {
      link: site ? new URL(transcriptPath, site).href : transcriptPath,
      title: ep.episodeTitle,
    };
  }

  return new Response(JSON.stringify(byDate, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
};
