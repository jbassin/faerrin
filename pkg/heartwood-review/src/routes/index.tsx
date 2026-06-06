import { createFileRoute, Link } from "@tanstack/react-router";
import { listSessions, type SessionListItem } from "@/server/sessions";

export const Route = createFileRoute("/")({
  loader: async (): Promise<SessionListItem[]> => listSessions(),
  component: SessionList,
});

const STATUS_LABEL: Record<SessionListItem["status"], string> = {
  unreviewed: "Unreviewed",
  partial: "In progress",
  reviewed: "Reviewed",
};

function SessionList() {
  const sessions = Route.useLoaderData();
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 820, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Heartwood Review</h1>
        <nav style={{ display: "flex", gap: "1rem", fontSize: "0.85rem" }}>
          <Link to="/dashboard">coverage &amp; slop</Link>
          <Link to="/preview">render preview</Link>
        </nav>
      </header>
      <p style={{ color: "#666" }}>
        Sessions ingested by <code>heartwood ingest</code>. Pick one to review.
      </p>

      {sessions.length === 0 ? (
        <p style={{ marginTop: "2rem", color: "#888" }}>
          No ingested sessions yet. Run{" "}
          <code>bun run --filter @faerrin/heartwood ingest &lt;arc&gt; &lt;date&gt;</code>{" "}
          (or <code>bun run --filter @faerrin/heartwood-review dev:fixture</code> for an
          offline sample).
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: "1.5rem" }}>
          {sessions.map((s: SessionListItem) => (
            <li
              key={`${s.sessionId.arc}@${s.sessionId.date}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.85rem 1rem",
                border: "1px solid #e2e2e5",
                borderRadius: 8,
                marginBottom: "0.6rem",
              }}
            >
              <div>
                <Link
                  to="/session/$arc/$date"
                  params={{ arc: s.sessionId.arc, date: s.sessionId.date }}
                  style={{ fontWeight: 600, fontSize: "1.05rem" }}
                >
                  {s.sessionId.arc}
                </Link>
                <div style={{ color: "#777", fontSize: "0.85rem" }}>
                  {s.sessionId.date} · {s.proposalCount} proposals
                  {s.conflictCount > 0 && ` · ${s.conflictCount} conflicts`}
                </div>
              </div>
              <StatusBadge status={s.status} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: SessionListItem["status"] }) {
  const bg =
    status === "reviewed" ? "#e6f4ea" : status === "partial" ? "#fef7e0" : "#eef0f3";
  const fg =
    status === "reviewed" ? "#137333" : status === "partial" ? "#b06000" : "#5f6368";
  return (
    <span
      style={{
        background: bg,
        color: fg,
        fontSize: "0.78rem",
        fontWeight: 600,
        padding: "0.2rem 0.6rem",
        borderRadius: 999,
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
