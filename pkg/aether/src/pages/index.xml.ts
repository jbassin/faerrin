// RSS feed at /index.xml — ports ContentIndex.generateRSSFeed (rssSlug "index",
// rssLimit 10, rssFullHtml false). Covers the content pages (not folder/tag
// listings), newest first. Hand-rolled to avoid an extra dependency.
import type { APIRoute } from "astro"
import { loadSite, type SiteDoc } from "../lib/site.ts"
import { simplifySlug } from "../lib/slug.ts"
import { SITE_TITLE, SITE_BASE_URL } from "../lib/config.ts"

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const desc = (d: SiteDoc) =>
  (d.entry.body ?? "")
    .replace(/^---[\s\S]*?---/, "")
    .replace(/[#>*_`\[\]\(\)!]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150)

export const GET: APIRoute = async () => {
  const site = await loadSite()
  const limit = 10
  const sorted = [...site.docs].sort((a, b) => {
    if (a.date && b.date) return b.date.getTime() - a.date.getTime()
    if (a.date && !b.date) return -1
    if (!a.date && b.date) return 1
    return a.title.localeCompare(b.title)
  })

  const items = sorted
    .slice(0, limit)
    .map((d) => {
      const url = `https://${SITE_BASE_URL}/${encodeURI(simplifySlug(d.slug))}`
      const date = d.date ?? new Date()
      return `<item>
    <title>${esc(d.title)}</title>
    <link>${url}</link>
    <guid>${url}</guid>
    <description><![CDATA[ ${desc(d)} ]]></description>
    <pubDate>${date.toUTCString()}</pubDate>
  </item>`
    })
    .join("")

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
    <channel>
      <title>${esc(SITE_TITLE)}</title>
      <link>https://${SITE_BASE_URL}</link>
      <description>Last ${limit} notes on ${esc(SITE_TITLE)}</description>
      <generator>Quartz -- quartz.jzhao.xyz</generator>
      ${items}
    </channel>
  </rss>`

  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } })
}
