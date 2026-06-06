import { createFileRoute, Link } from "@tanstack/react-router";
import { getSession, type SessionView } from "@/server/sessions";

type Proposal = SessionView["artifact"]["proposals"][number];
type Fact = Proposal["facts"][number];
type Citation = Fact["citations"][number];

export const Route = createFileRoute("/session/$arc/$date")({
  loader: async ({ params }): Promise<SessionView> =>
    getSession({ data: { arc: params.arc, date: params.date } }),
  component: SessionPage,
});

function SessionPage() {
  const { artifact, review } = Route.useLoaderData();
  const decisionOf = (id: string) => review.decisions[id]?.decision ?? "pending";

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 860, margin: "0 auto" }}>
      <p>
        <Link to="/">← sessions</Link>
      </p>
      <h1 style={{ marginBottom: 0 }}>{artifact.sessionId.arc}</h1>
      <div style={{ color: "#777" }}>
        {artifact.sessionId.date} · {artifact.transcript}
      </div>

      {/* AC-23: narrative overview first */}
      <section
        style={{
          marginTop: "1.25rem",
          padding: "1rem 1.25rem",
          background: "#f6f7f9",
          borderRadius: 8,
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1rem", color: "#555" }}>Session narrative</h2>
        <p style={{ marginBottom: 0 }}>{artifact.narrative}</p>
      </section>

      <div style={{ display: "flex", gap: "1.5rem", margin: "1rem 0", fontSize: "0.9rem", color: "#555" }}>
        <span>canon {artifact.triage.canon.length}</span>
        <span>uncertain {artifact.triage.uncertain.length}</span>
        <span>noise {artifact.triage.noise.length}</span>
        {artifact.conflicts.length > 0 && (
          <span style={{ color: "#b06000", fontWeight: 600 }}>⚠ {artifact.conflicts.length} conflicts</span>
        )}
      </div>

      <h2 style={{ fontSize: "1.05rem" }}>Proposals ({artifact.proposals.length})</h2>
      {artifact.proposals.map((p: Proposal) => (
        <article
          key={p.id}
          style={{ border: "1px solid #e2e2e5", borderRadius: 8, padding: "1rem", marginBottom: "0.85rem" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong>{p.canonicalName}</strong>
            <span style={{ fontSize: "0.78rem", color: "#777" }}>
              {p.kind === "amend" ? `amend → ${p.targetPath}` : "create new page"} · {decisionOf(p.id)}
            </span>
          </div>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
            {p.facts.map((f: Fact) => (
              <li key={f.claimId} style={{ marginBottom: "0.25rem" }}>
                {f.text}{" "}
                <span style={{ color: "#999", fontSize: "0.8rem" }}>
                  (L{f.citations.map((c: Citation) => `${c.start}-${c.end}`).join(", ")})
                </span>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </main>
  );
}
