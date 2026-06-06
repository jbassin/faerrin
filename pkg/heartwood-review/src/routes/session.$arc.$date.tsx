import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getSession, type SessionView } from "@/server/sessions";
import { commitSession, type CommitResult } from "@/server/commit";
import type { ReviewState } from "@faerrin/heartwood/src/state/review.ts";
import { ProposalCard } from "@/components/ProposalCard.tsx";
import { TriageView } from "@/components/TriageView.tsx";
import { ConflictCard } from "@/components/ConflictCard.tsx";
import { groupProposalsByEvent } from "@/lib/event-groups.ts";

export const Route = createFileRoute("/session/$arc/$date")({
  loader: async ({ params }): Promise<SessionView> =>
    getSession({ data: { arc: params.arc, date: params.date } }),
  component: SessionPage,
});

type Conflict = SessionView["artifact"]["conflicts"][number];
type Proposal = SessionView["artifact"]["proposals"][number];

function SessionPage() {
  const { artifact, review: initialReview, pageTypes, allSlugs, suppressedProposalIds, rejectionInfo } =
    Route.useLoaderData() as SessionView;
  const [review, setReview] = useState<ReviewState>(initialReview);
  const [tab, setTab] = useState<"proposals" | "triage">("proposals");
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [committing, setCommitting] = useState(false);

  const decided = artifact.proposals.filter(
    (p: Proposal) => (review.decisions[p.id]?.decision ?? "pending") !== "pending",
  ).length;

  const proposalById = new Map(artifact.proposals.map((p: Proposal) => [p.id, p]));
  const suppressed = new Set(suppressedProposalIds);
  // AC-26: previously-rejected proposals are kept out of the main flow (shown in a tray below).
  const shownProposals = artifact.proposals.filter((p: Proposal) => !suppressed.has(p.id));
  const suppressedProposals = artifact.proposals.filter((p: Proposal) => suppressed.has(p.id));
  const eventGroups = groupProposalsByEvent(shownProposals);

  const renderCard = (p: Proposal) => (
    <ProposalCard
      key={p.id}
      arc={artifact.sessionId.arc}
      date={artifact.sessionId.date}
      proposal={p}
      initialDecision={review.decisions[p.id]?.decision ?? "pending"}
      initialText={review.decisions[p.id]?.authoredText ?? ""}
      initialTargetPath={review.decisions[p.id]?.targetPath ?? ""}
      initialWeave={review.decisions[p.id]?.weave}
      initialReason={review.decisions[p.id]?.rejectionReason ?? ""}
      pageType={pageTypes[p.id] ?? "lore"}
      allSlugs={allSlugs}
      onSaved={setReview}
    />
  );
  const approvedUncommitted = artifact.proposals.filter((p: Proposal) => {
    const d = review.decisions[p.id];
    return d?.decision === "approved" && !d.committedAt;
  }).length;

  async function doCommit() {
    setCommitting(true);
    try {
      const result = await commitSession({
        data: { arc: artifact.sessionId.arc, date: artifact.sessionId.date },
      });
      setCommitResult(result);
    } finally {
      setCommitting(false);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 880, margin: "0 auto" }}>
      <p>
        <Link to="/">← sessions</Link>
      </p>
      <h1 style={{ marginBottom: 0 }}>{artifact.sessionId.arc}</h1>
      <div style={{ color: "#777" }}>
        {artifact.sessionId.date} · {artifact.transcript}
      </div>

      {/* AC-23: narrative overview first. */}
      <section style={{ marginTop: "1.25rem", padding: "1rem 1.25rem", background: "#f6f7f9", borderRadius: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: "1rem", color: "#555" }}>Session narrative</h2>
        <p style={{ marginBottom: 0 }}>{artifact.narrative}</p>
      </section>

      {/* AC-11: conflicts surfaced, pulled to the top. */}
      {artifact.conflicts.length > 0 && (
        <section
          style={{
            marginTop: "1rem",
            padding: "0.85rem 1.1rem",
            background: "rgba(176,96,0,0.08)",
            border: "1px solid rgba(176,96,0,0.3)",
            borderRadius: 8,
          }}
        >
          <strong style={{ color: "#b06000" }}>⚠ {artifact.conflicts.length} potential conflict(s)</strong>
          {artifact.conflicts.map((c: Conflict, i: number) => (
            <ConflictCard
              key={`${c.claimId}:${i}`}
              arc={artifact.sessionId.arc}
              date={artifact.sessionId.date}
              conflict={c}
              initial={review.conflictResolutions[c.claimId]}
              onResolved={setReview}
            />
          ))}
        </section>
      )}

      {/* Tabs. */}
      <nav style={{ display: "flex", gap: "0.5rem", margin: "1.25rem 0 1rem" }}>
        <Tab label={`Proposals (${artifact.proposals.length})`} active={tab === "proposals"} onClick={() => setTab("proposals")} />
        <Tab
          label={`Triage (${artifact.triage.canon.length}/${artifact.triage.uncertain.length}/${artifact.triage.noise.length})`}
          active={tab === "triage"}
          onClick={() => setTab("triage")}
        />
        <span style={{ marginLeft: "auto", alignSelf: "center", fontSize: "0.85rem", color: "#777" }}>
          {decided}/{artifact.proposals.length} decided
        </span>
      </nav>

      {tab === "proposals" && (
        <>
          {eventGroups.map((group, gi) => {
            const proposals = group.map((id) => proposalById.get(id)!);
            if (proposals.length <= 1) return proposals.map(renderCard);
            // AC-22: related per-page edits from one event, grouped so they stay consistent.
            return (
              <div
                key={`event-${gi}`}
                style={{
                  border: "1px dashed #9aa0a6",
                  borderRadius: 12,
                  padding: "0.75rem",
                  marginBottom: "1rem",
                  background: "rgba(154,160,166,0.06)",
                }}
              >
                <div style={{ fontSize: "0.8rem", color: "#5f6368", fontWeight: 600, marginBottom: "0.5rem" }}>
                  ⛓ Event group · {proposals.length} pages — these edits share transcript moments; keep
                  them consistent
                </div>
                {proposals.map(renderCard)}
              </div>
            );
          })}

          {/* AC-26 / D-7: previously-rejected claims, collapsed — never silently discarded. */}
          {suppressedProposals.length > 0 && (
            <details style={{ marginTop: "0.5rem" }}>
              <summary style={{ cursor: "pointer", color: "#777", fontSize: "0.9rem", fontWeight: 600 }}>
                Previously rejected ({suppressedProposals.length}) — suppressed from earlier sessions
              </summary>
              <p style={{ fontSize: "0.8rem", color: "#999", margin: "0.4rem 0 0.75rem" }}>
                These match claims you rejected before. They&rsquo;re kept here so nothing is lost — act on
                one to bring it back into canon.
              </p>
              {suppressedProposals.map((p: Proposal) => {
                const info = rejectionInfo[p.id];
                return (
                  <div key={p.id}>
                    {info && (
                      <div style={{ fontSize: "0.75rem", color: "#c5221f", marginBottom: "-0.4rem" }}>
                        ⊘ rejected in {info.sessions} earlier session{info.sessions === 1 ? "" : "s"}
                        {info.reason ? ` · ${info.reason}` : ""}
                      </div>
                    )}
                    {renderCard(p)}
                  </div>
                );
              })}
            </details>
          )}
        </>
      )}

      {tab === "triage" && (
        <TriageView
          arc={artifact.sessionId.arc}
          date={artifact.sessionId.date}
          triage={artifact.triage}
          review={review}
          onChanged={setReview}
        />
      )}

      {/* Commit bar (AC-7): one batched jj revision per session; nothing written until here. */}
      <section
        style={{
          marginTop: "1.5rem",
          padding: "1rem 1.15rem",
          border: "1px solid #d0d0d5",
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => void doCommit()}
          disabled={committing || approvedUncommitted === 0}
          style={{
            font: "inherit",
            fontWeight: 600,
            padding: "0.5rem 1.1rem",
            borderRadius: 8,
            border: "1px solid #137333",
            background: committing || approvedUncommitted === 0 ? "#f1f1f3" : "#137333",
            color: committing || approvedUncommitted === 0 ? "#aaa" : "#fff",
            cursor: committing || approvedUncommitted === 0 ? "not-allowed" : "pointer",
          }}
        >
          {committing ? "Committing…" : `Commit ${approvedUncommitted} approved → jj`}
        </button>
        <span style={{ fontSize: "0.85rem", color: "#777" }}>
          Writes approved prose + provenance to the wiki and creates one jj revision. Other working
          changes are left untouched.
        </span>
        {commitResult && (
          <div style={{ flexBasis: "100%", fontSize: "0.85rem" }}>
            {commitResult.committed ? (
              <span style={{ color: "#137333" }}>
                ✓ Committed <code>{commitResult.revision}</code> — {commitResult.message}
              </span>
            ) : (
              <span style={{ color: "#777" }}>Nothing committed.</span>
            )}
            {commitResult.skipped.length > 0 && (
              <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem", color: "#b06000" }}>
                {commitResult.skipped.map((s, i) => (
                  <li key={i}>
                    {s.proposal}: {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        font: "inherit",
        fontSize: "0.9rem",
        fontWeight: 600,
        padding: "0.3rem 0.85rem",
        borderRadius: 8,
        border: "1px solid",
        borderColor: active ? "#2b6cb0" : "#d0d0d5",
        background: active ? "rgba(43,108,176,0.1)" : "transparent",
        color: active ? "#2b6cb0" : "#555",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
