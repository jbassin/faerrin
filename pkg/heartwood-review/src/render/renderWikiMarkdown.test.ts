import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderWikiMarkdown } from "./renderWikiMarkdown.ts";

const ALL = ["Geography/Calaria/Hallia/index", "Org/index", "Test/Page"];
const render = (md: string) =>
  renderWikiMarkdown(md, { srcSlug: "Test/Page", allSlugs: ALL });

// --- Always-on structural assertions: the hard gate (no build needed). -------
describe("renderWikiMarkdown — aether-faithful structures", () => {
  it("resolves [[wikilinks]] to internal anchors (shortest strategy)", async () => {
    const html = await render("See [[Hallia]] for more.");
    expect(html).toContain('class="internal"');
    expect(html).toMatch(
      /<a href="[^"]*Hallia[^"]*" class="internal">Hallia<\/a>/,
    );
  });

  it("renders Obsidian callouts to Quartz callout DOM", async () => {
    const html = await render("> [!note] Heads up\n> body text");
    expect(html).toContain('data-callout="note"');
    expect(html).toContain('class="callout-title"');
    expect(html).toContain("callout-content");
  });

  it("adds github-slugger heading ids (Astro rehypeHeadingIds parity)", async () => {
    const html = await render("## Enlightenment\n\ntext");
    expect(html).toContain('<h2 id="enlightenment">');
  });

  it("applies smartypants (-- → em dash) like Astro", async () => {
    const html = await render("a -- b");
    expect(html).toContain("—");
    expect(html).not.toContain("--");
  });

  it("expands transcript-line directives via aether's plugin + handlers", async () => {
    const html = await render(
      ':::transcript-line{second="12" user="Bob" start="0:12" char="Borin"}\nhello\n:::',
    );
    expect(html).toContain("transcript-line");
    expect(html).toContain('class="transcript-time"');
  });
});

// --- Golden diff vs aether's live build (skipped when build output absent). ---
// pkg/aether/public is gitignored, so this only runs after a local `astro build`.
const PUBLIC = join(process.cwd(), "..", "aether", "public");
const goldens: Array<{ rel: string; built: string }> = [
  {
    rel: "Geography/Calaria/Hallia/Sableclutch/index.md",
    built: "Geography/Calaria/Hallia/Sableclutch/index.html",
  },
  {
    rel: "Phenomena/Harmony/Voidsong.md",
    built: "Phenomena/Harmony/Voidsong.html",
  },
  { rel: "Divinity/Hierophant.md", built: "Divinity/Hierophant.html" },
];

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const stripFrontmatter = (s: string) => s.replace(/^---\n[\s\S]*?\n---\n?/, "");
const articleInner = (html: string) =>
  html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/)?.[1] ?? "";

describe.skipIf(!existsSync(PUBLIC))(
  "renderWikiMarkdown — byte-faithful vs aether build",
  () => {
    // allSlugs computed from the real wiki, loaded lazily (Node fs).
    const wikiDir = join(process.cwd(), "..", "content", "wiki");

    for (const g of goldens) {
      it(`matches built article for ${g.rel}`, async () => {
        const builtPath = join(PUBLIC, g.built);
        if (!existsSync(builtPath)) return; // page not in this build
        const { loadAllSlugs } = await import("../server/content.ts");
        const { slugForPath } = await import("./remark-wikilinks-injected.ts");
        const allSlugs = await loadAllSlugs();
        const body = stripFrontmatter(
          readFileSync(join(wikiDir, g.rel), "utf8"),
        );
        const mine = await renderWikiMarkdown(body, {
          srcSlug: slugForPath(g.rel),
          allSlugs,
        });
        const theirs = articleInner(readFileSync(builtPath, "utf8"));
        expect(norm(mine)).toBe(norm(theirs));
      });
    }
  },
);
