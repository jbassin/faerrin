import { createFileRoute, Link } from "@tanstack/react-router";
import { renderPagePreview, type PagePreview } from "@/server/render";
import "@/styles/wiki-render.css";

// Phase-0a render-fidelity checkpoint route. Pick a page via ?path=… and compare
// the rendered article against the live page on heart.iridi.cc. Defaults to a
// page exercising prose + internal links; the SAMPLES cover the other page types.
const SAMPLES: { label: string; path: string }[] = [
  {
    label: "Prose + links (Sableclutch)",
    path: "Geography/Calaria/Hallia/Sableclutch/index.md",
  },
  { label: "Callout (Voidsong)", path: "Phenomena/Harmony/Voidsong.md" },
  { label: "Deity :: stat block (Hierophant)", path: "Divinity/Hierophant.md" },
];

interface PreviewSearch {
  path: string;
}

export const Route = createFileRoute("/preview")({
  validateSearch: (search: Record<string, unknown>): PreviewSearch => ({
    path:
      typeof search.path === "string" && search.path
        ? search.path
        : SAMPLES[0]!.path,
  }),
  loaderDeps: ({ search }) => ({ path: search.path }),
  loader: async ({ deps }): Promise<PagePreview> =>
    renderPagePreview({ data: { path: deps.path } }),
  component: PreviewPage,
});

function PreviewPage() {
  const page = Route.useLoaderData();
  return (
    <div style={{ padding: "1.5rem", maxWidth: 880, margin: "0 auto" }}>
      <nav
        style={{
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <Link to="/" style={{ fontSize: "0.9rem" }}>
          ← home
        </Link>
        {SAMPLES.map((s) => (
          <Link
            key={s.path}
            to="/preview"
            search={{ path: s.path }}
            style={{ fontSize: "0.9rem" }}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      <p style={{ fontSize: "0.8rem", color: "#888" }}>
        Rendering <code>{page.path}</code> — compare to{" "}
        <a href="https://heart.iridi.cc" target="_blank" rel="noreferrer">
          heart.iridi.cc
        </a>
      </p>
      <h1 className="article-title">{page.title}</h1>
      <article
        className="wiki-article"
        // Rendered server-side via the aether-faithful renderer (renderWikiMarkdown).
        dangerouslySetInnerHTML={{ __html: page.html }}
      />
    </div>
  );
}
