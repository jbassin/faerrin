// Sitemap at /sitemap.xml — ports ContentIndex.generateSiteMap over the content
// pages (simplified slugs, with lastmod from the git "modified" date). Hand-rolled
// to keep the dependency budget tight.
import type { APIRoute } from "astro"
import { loadSite } from "../lib/site.ts"
import { simplifySlug } from "../lib/slug.ts"
import { SITE_BASE_URL } from "../lib/config.ts"

export const GET: APIRoute = async () => {
  const site = await loadSite()
  const urls = site.docs
    .map((d) => {
      const loc = `https://${SITE_BASE_URL}/${encodeURI(simplifySlug(d.slug))}`
      const lastmod = d.date ? `<lastmod>${d.date.toISOString()}</lastmod>` : ""
      return `<url>
    <loc>${loc}</loc>
    ${lastmod}
  </url>`
    })
    .join("")

  const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } })
}
