// Slim link-graph index at /static/contentIndex.json — the data contract the
// Graph island fetches (mirrors Quartz's global `fetchData`/contentIndex, but
// ONLY the {title, links, tags} subset the graph needs — NOT the multi-MB
// full-text blob Quartz emits for FlexSearch). Built from src/lib/site.ts,
// whose resolved-link edges are the same ones migration/parity-graph.ts gates
// (168/168), so the graph data is parity-guaranteed.
import type { APIRoute } from "astro"
import { loadSite } from "../../lib/site.ts"

export const GET: APIRoute = async () => {
  const site = await loadSite()
  const index: Record<string, { title: string; links: string[]; tags: string[] }> = {}
  for (const d of site.docs) {
    index[d.slug] = { title: d.title, links: d.links, tags: d.tags }
  }
  return new Response(JSON.stringify(index), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}
