import { createFileRoute, Link } from "@tanstack/react-router";
import { ioSpike, type SpikeResult } from "@/server/spike";

// Phase-0a diagnostics: proves server-side read pkg/content + write sidecar +
// shell jj, and reports the runtime (node, not bun). Kept for reference.
export const Route = createFileRoute("/spike")({
  loader: async (): Promise<SpikeResult> => ioSpike(),
  component: SpikePage,
});

function SpikePage() {
  const spike = Route.useLoaderData();
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 760 }}>
      <p>
        <Link to="/">← sessions</Link>
      </p>
      <h1>Server-function I/O spike</h1>
      <dl>
        <dt>
          <strong>runtime</strong>
        </dt>
        <dd>
          <code>{spike.runtime}</code>
        </dd>
        <dt>
          <strong>(a) content read</strong>
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
          <strong>(c) jj status</strong>
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
