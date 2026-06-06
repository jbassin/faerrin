import { createFileRoute, Link } from "@tanstack/react-router";
import { getDashboard, type DashboardData } from "@/server/dashboard";

export const Route = createFileRoute("/dashboard")({
  loader: async (): Promise<DashboardData> => getDashboard(),
  component: Dashboard,
});

const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;

function Dashboard() {
  const data = Route.useLoaderData() as DashboardData;
  const { coverage, slop, reasonTally, reviewedSessions, totalSessions } = data;
  const reasons = Object.entries(reasonTally).sort((a, b) => b[1] - a[1]);

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
        maxWidth: 880,
        margin: "0 auto",
      }}
    >
      <p>
        <Link to="/">← sessions</Link>
      </p>
      <h1 style={{ marginBottom: "0.25rem" }}>Coverage &amp; slop</h1>
      <p style={{ color: "#777", marginTop: 0 }}>
        {reviewedSessions} of {totalSessions} sessions reviewed.
      </p>

      {/* Headline slop — from reviewer decisions, NOT the §9 warnings (non-circular, §12). */}
      <section style={cardStyle}>
        <h2 style={h2Style}>Slop rate (reviewer decisions)</h2>
        <div style={{ display: "flex", gap: "2rem", alignItems: "baseline" }}>
          <div
            style={{
              fontSize: "2.4rem",
              fontWeight: 700,
              color: slop.aggregate.slop > 0 ? "#c5221f" : "#137333",
            }}
          >
            {pct(slop.aggregate.slopRate)}
          </div>
          <div style={{ fontSize: "0.85rem", color: "#777" }}>
            {slop.aggregate.slop} slop / {slop.aggregate.decided} decided
            <br />
            {slop.aggregate.voiceRejections} voice rejections ·{" "}
            {slop.aggregate.rewrites} rewrites
          </div>
        </div>
        <p style={{ fontSize: "0.78rem", color: "#999", marginBottom: 0 }}>
          Share of decided proposals rejected for voice/quality (or rewritten
          away from a draft) — computed from your accept/reject decisions, never
          from the automated warnings.
        </p>
        {slop.perSession.length > 0 && (
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>session</Th>
                <Th>decided</Th>
                <Th>slop</Th>
                <Th>rate</Th>
              </tr>
            </thead>
            <tbody>
              {slop.perSession.map((r) => (
                <tr key={`${r.arc}@${r.date}`}>
                  <Td>
                    {r.arc} <span style={{ color: "#999" }}>{r.date}</span>
                  </Td>
                  <Td>{r.decided}</Td>
                  <Td>{r.slop}</Td>
                  <Td>{pct(r.slopRate)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Rejection-reason tally (AC-16 tuning signal). */}
      {reasons.length > 0 && (
        <section style={cardStyle}>
          <h2 style={h2Style}>Rejection reasons</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {reasons.map(([reason, n]) => (
              <span key={reason} style={{ fontSize: "0.85rem" }}>
                <strong>{n}</strong> {reason}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Coverage from the eval harness (AC-19); empty until `heartwood eval --save` is run. */}
      <section style={cardStyle}>
        <h2 style={h2Style}>Coverage (eval harness)</h2>
        {coverage.length === 0 ? (
          <p style={{ fontSize: "0.85rem", color: "#999", marginBottom: 0 }}>
            No eval results yet. Run{" "}
            <code>
              bun run --filter @faerrin/heartwood eval &lt;arc&gt; &lt;date&gt;
              --save
            </code>{" "}
            to populate coverage / precision / false-canon against the
            hand-labeled set (baseline to beat ~52%).
          </p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>session</Th>
                <Th>facts</Th>
                <Th>claims</Th>
                <Th>coverage</Th>
                <Th>precision</Th>
                <Th>false-canon</Th>
              </tr>
            </thead>
            <tbody>
              {coverage.map((r) => (
                <tr key={`${r.arc}@${r.date}`}>
                  <Td>
                    {r.arc} <span style={{ color: "#999" }}>{r.date}</span>
                  </Td>
                  <Td>{r.labeledFacts}</Td>
                  <Td>{r.producedClaims}</Td>
                  <Td
                    style={{
                      color: r.coverage >= 0.52 ? "#137333" : "#c5221f",
                      fontWeight: 600,
                    }}
                  >
                    {pct(r.coverage)}
                  </Td>
                  <Td>{pct(r.precision)}</Td>
                  <Td>{pct(r.falseCanonRate)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  marginTop: "1.25rem",
  padding: "1rem 1.25rem",
  border: "1px solid #e2e2e5",
  borderRadius: 10,
};
const h2Style: React.CSSProperties = {
  marginTop: 0,
  fontSize: "1rem",
  color: "#555",
};
const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: "0.75rem",
  fontSize: "0.85rem",
};

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "0.3rem 0.5rem",
        borderBottom: "1px solid #e2e2e5",
        color: "#777",
        fontWeight: 600,
      }}
    >
      {children}
    </th>
  );
}
function Td({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <td
      style={{
        padding: "0.3rem 0.5rem",
        borderBottom: "1px solid #f0f0f2",
        ...style,
      }}
    >
      {children}
    </td>
  );
}
