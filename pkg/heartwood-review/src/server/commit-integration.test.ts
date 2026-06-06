import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performCommit, type CommitDeps } from "./commit.ts";
import {
  writeSessionArtifact,
  type SessionArtifact,
} from "@faerrin/heartwood/src/state/store.ts";
import {
  applyDecision,
  emptyReviewState,
  writeReviewState,
} from "@faerrin/heartwood/src/state/review.ts";

const SID = { arc: "through-a-song-darkly", date: "2025-08-28" };
const AMEND_PATH = "Geography/Calaria/Hallia/Sableclutch/index.md";
const TX = "000.through-a-song-darkly.2025-8-28.txt";

function artifact(): SessionArtifact {
  const fact = (claimId: string, text: string) => ({
    claimId,
    text,
    citations: [{ transcript: TX, start: 50, end: 52 }],
    modality: "gm-stated" as const,
  });
  const claim = (id: string, text: string) => ({
    id,
    text,
    citations: [{ transcript: TX, start: 50, end: 52 }],
    speaker: "Gamemaster",
    role: "gm" as const,
    modality: "gm-stated" as const,
    entitySurfaceForms: ["x"],
  });
  return {
    sessionId: SID,
    transcript: TX,
    contentHash: "h",
    generatedAt: "2026-06-06T00:00:00.000Z",
    narrative: "n",
    triage: { canon: [claim("c1", "a"), claim("c2", "b")], uncertain: [], noise: [] },
    proposals: [
      {
        id: "prop:e1",
        kind: "amend",
        status: "existing",
        entityId: "e1",
        canonicalName: "Sableclutch",
        targetPath: AMEND_PATH,
        facts: [fact("c1", "The wharves now pay an informal levy.")],
      },
      {
        id: "prop:e2",
        kind: "create",
        status: "new",
        entityId: "e2",
        canonicalName: "Maren Dock",
        targetPath: null,
        facts: [fact("c2", "Maren Dock foremans the warehouses.")],
      },
    ],
    entities: [],
    needsConfirmation: [],
    conflicts: [],
  };
}

async function setup() {
  const base = await mkdtemp(join(tmpdir(), "hw-commit-"));
  const deps: CommitDeps & { jjCalls: string[][] } = {
    wikiDir: join(base, "wiki"),
    sessionsDir: join(base, "sessions"),
    reviewDir: join(base, "review"),
    provRoot: join(base, "prov"),
    jjCalls: [],
    runJj: async (args: string[]) => {
      (deps.jjCalls as string[][]).push(args);
      return args[0] === "log" ? "abc1234\n" : "";
    },
  };
  // existing amend target
  const amendAbs = join(deps.wikiDir, AMEND_PATH);
  await mkdir(dirname(amendAbs), { recursive: true });
  await writeFile(amendAbs, "Sableclutch is overlooked by the capital.\n", "utf8");
  await writeSessionArtifact(deps.sessionsDir, artifact());
  // approve both; create gets a target path
  let rs = emptyReviewState(SID);
  rs = applyDecision(rs, { proposalId: "prop:e1", decision: "approved", authoredText: "A levy now bites the wharves." });
  rs = applyDecision(rs, {
    proposalId: "prop:e2",
    decision: "approved",
    authoredText: "Maren Dock keeps the warehouses honest.",
    targetPath: "People/Maren Dock.md",
  });
  await writeReviewState(deps.reviewDir, rs);
  return { base, deps, amendAbs };
}

describe("performCommit (Stage F, AC-7/AC-15)", () => {
  it("appends amend prose, writes the new page + provenance, and commits via jj", async () => {
    const { base, deps, amendAbs } = await setup();
    try {
      const r = await performCommit(SID, deps);
      expect(r.committed).toBe(true);
      expect(r.amend).toBe(1);
      expect(r.create).toBe(1);
      expect(r.revision).toBe("abc1234");

      // amend appended at end of body
      const amended = await readFile(amendAbs, "utf8");
      expect(amended).toContain("Sableclutch is overlooked by the capital.");
      expect(amended).toMatch(/A levy now bites the wharves\.\n$/);

      // create page written (plain prose, no frontmatter)
      const created = await readFile(join(deps.wikiDir, "People/Maren Dock.md"), "utf8");
      expect(created).toBe("Maren Dock keeps the warehouses honest.\n");

      // provenance sidecars written outside wiki/
      const prov = JSON.parse(
        await readFile(join(deps.provRoot, `${AMEND_PATH}.prov.json`), "utf8"),
      );
      expect(prov.records.length).toBeGreaterThan(0);
      expect(prov.records[0].citations[0]).toMatchObject({ transcript: TX, start: 50, end: 52 });

      // one jj commit with exactly the written paths, then a log read
      const commitCall = deps.jjCalls.find((c) => c[0] === "commit")!;
      expect(commitCall.slice(0, 3)).toEqual(["commit", "-m", expect.stringContaining("heartwood:")]);
      expect(commitCall).toContain(`pkg/content/wiki/${AMEND_PATH}`);
      expect(commitCall).toContain("pkg/content/wiki/People/Maren Dock.md");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("is idempotent — a second commit writes nothing (committedAt guard)", async () => {
    const { base, deps } = await setup();
    try {
      await performCommit(SID, deps);
      const before = deps.jjCalls.length;
      const r2 = await performCommit(SID, deps);
      expect(r2.committed).toBe(false);
      expect(r2.amend).toBe(0);
      expect(r2.create).toBe(0);
      expect(deps.jjCalls.length).toBe(before); // no new jj invocation
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("skips an approved create that has no target path", async () => {
    const { base, deps } = await setup();
    try {
      // overwrite review: create approved WITHOUT a target path
      let rs = emptyReviewState(SID);
      rs = applyDecision(rs, { proposalId: "prop:e2", decision: "approved", authoredText: "text" });
      await writeReviewState(deps.reviewDir, rs);
      const r = await performCommit(SID, deps);
      expect(r.committed).toBe(false);
      expect(r.skipped.some((s) => /target path/.test(s.reason))).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
