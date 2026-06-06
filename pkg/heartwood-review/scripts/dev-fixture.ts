// Dev/offline fixture: write a realistic SessionArtifact WITHOUT running the
// (LLM-backed, paid) ingest pipeline, so the review app + server functions can be
// developed and tested offline. Real review data comes from
// `bun run --filter @faerrin/heartwood ingest <arc> <date>`. Run:
//   bun run --filter @faerrin/heartwood-review dev:fixture
import { join } from "node:path";
import {
  writeSessionArtifact,
  type SessionArtifact,
} from "@faerrin/heartwood/src/state/store.ts";

const SESSIONS_DIR = join(process.cwd(), "..", "heartwood", "state", "sessions");
const TRANSCRIPT = "000.through-a-song-darkly.2025-8-28.txt";

const claim = (
  id: string,
  text: string,
  start: number,
  end: number,
  surface: string,
): SessionArtifact["triage"]["canon"][number] => ({
  id,
  text,
  citations: [{ transcript: TRANSCRIPT, start, end }],
  speaker: "Gamemaster",
  role: "gm",
  modality: "gm-stated",
  entitySurfaceForms: [surface],
});

const artifact: SessionArtifact = {
  sessionId: { arc: "through-a-song-darkly", date: "2025-08-28" },
  transcript: TRANSCRIPT,
  contentHash: "devfixture0000",
  generatedAt: new Date().toISOString(),
  narrative:
    "The party made their way down to Sableclutch, the overlooked riverside district where the city's goods first arrive. They met Maren Dock, a warehouse foreman with an ear for trouble, and learned the Black Line Badges have begun quietly taxing the wharves.",
  triage: {
    canon: [
      claim("c1", "Sableclutch sits on the south bank of the Fousan River and handles the bulk of incoming river cargo.", 50, 52, "Sableclutch"),
      claim("c2", "Maren Dock is a warehouse foreman in Sableclutch, known for noticing trouble before it surfaces.", 100, 103, "Maren Dock"),
      claim("c3", "The Black Line Badges have begun levying an informal tax on the Sableclutch wharves.", 200, 204, "Black Line Badges"),
    ],
    uncertain: [
      claim("c4", "A player guessed the Badges answer to someone in the upper city.", 210, 212, "Black Line Badges"),
    ],
    noise: [],
  },
  proposals: [
    {
      id: "prop:e1",
      kind: "amend",
      status: "existing",
      entityId: "e1",
      canonicalName: "Sableclutch",
      targetPath: "Geography/Calaria/Hallia/Sableclutch/index.md",
      facts: [
        { claimId: "c1", text: "Sableclutch sits on the south bank of the Fousan River and handles the bulk of incoming river cargo.", citations: [{ transcript: TRANSCRIPT, start: 50, end: 52 }], modality: "gm-stated" },
        { claimId: "c3", text: "The Black Line Badges have begun levying an informal tax on the Sableclutch wharves.", citations: [{ transcript: TRANSCRIPT, start: 200, end: 204 }], modality: "gm-stated" },
      ],
    },
    {
      id: "prop:e2",
      kind: "create",
      status: "new",
      entityId: "e2",
      canonicalName: "Maren Dock",
      targetPath: null,
      facts: [
        { claimId: "c2", text: "Maren Dock is a warehouse foreman in Sableclutch, known for noticing trouble before it surfaces.", citations: [{ transcript: TRANSCRIPT, start: 100, end: 103 }], modality: "gm-stated" },
      ],
    },
  ],
  entities: [
    { id: "e1", canonicalName: "Sableclutch", aliases: ["Sableclutch"], wikiPath: "Geography/Calaria/Hallia/Sableclutch/index.md", status: "known", confidence: "high" },
    { id: "e2", canonicalName: "Maren Dock", aliases: ["Maren Dock", "Maren"], wikiPath: null, status: "pending", confidence: "low" },
    { id: "e3", canonicalName: "Black Line Badges", aliases: ["Black Line Badges", "Black Line"], wikiPath: null, status: "pending", confidence: "low" },
  ],
  needsConfirmation: [
    { id: "e2", canonicalName: "Maren Dock", aliases: ["Maren Dock", "Maren"], wikiPath: null, status: "pending", confidence: "low" },
    { id: "e3", canonicalName: "Black Line Badges", aliases: ["Black Line Badges", "Black Line"], wikiPath: null, status: "pending", confidence: "low" },
  ],
  conflicts: [
    {
      claimId: "c1",
      entityId: "e1",
      canonicalName: "Sableclutch",
      newStatement: "Sableclutch handles the bulk of incoming river cargo.",
      existingStatement: "the power centers of the Orgs that manage it are found elsewhere",
      source: "wiki",
      sourceRef: "Geography/Calaria/Hallia/Sableclutch/index.md",
      explanation: "The new fact frames Sableclutch as a cargo hub, which sits in tension with the page's note that its goods' power centers lie elsewhere.",
    },
  ],
};

await writeSessionArtifact(SESSIONS_DIR, artifact);
console.error(`Wrote dev fixture → ${SESSIONS_DIR}/through-a-song-darkly@2025-08-28.json`);
