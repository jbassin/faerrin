import { createFileRoute, Link } from "@tanstack/react-router";
import { ioSpike, type SpikeResult } from "@/server/spike";

export const Route = createFileRoute("/")({
  loader: async (): Promise<SpikeResult> => ioSpike(),
  component: HomePage,
});

function HomePage() {
  const spike = Route.useLoaderData();
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 760 }}>
      <h1>Heartwood Review</h1>
      <p>Local-first review app — scaffold up. Sessions list coming next.</p>
      <p>
        <Link to="/preview">→ render-fidelity preview</Link> (compare against
        heart.iridi.cc)
      </p>

      <h2>Phase 0a server-function I/O spike</h2>
      <dl>
        <dt>
          <strong>runtime</strong> — server-function JS engine
        </dt>
        <dd>
          <code>{spike.runtime}</code>
        </dd>
        <dt>
          <strong>(a) content read</strong> — pkg/content wiki page
        </dt>
        <dd>
          <code>{spike.contentRead}</code>
        </dd>
        <dt>
          <strong>(b) sidecar write round-trip</strong>
        </dt>
        <dd>
          <code>{spike.sidecarWriteRoundTrip}</code>
        </dd>
        <dt>
          <strong>(c) jj status</strong> — shelled via Bun.spawn
        </dt>
        <dd>
          <pre style={{ background: "#0001", padding: "0.75rem", whiteSpace: "pre-wrap" }}>
            {spike.jjStatus}
          </pre>
        </dd>
      </dl>
    </main>
  );
}
