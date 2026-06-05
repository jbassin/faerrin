import type { Session, WikiCorpus } from "../types.ts";
import {
  buildArcTitles,
  buildMainArcs,
  buildSpeakerIndex,
  loadShibboleth,
} from "./shibboleth.ts";
import { dateSortKey, loadSession } from "./transcript.ts";
import { loadWiki } from "./wiki.ts";

export interface CasterPaths {
  transcripts: string;
  wiki: string;
  shibboleth: string;
}

export const DEFAULT_PATHS: CasterPaths = {
  transcripts: "../content/transcripts",
  wiki: "../content/wiki",
  shibboleth: "content/shibboleth.json",
};

export interface Corpus {
  sessions: Session[];
  wiki: WikiCorpus;
}

/** Load every transcript into a Session, with speakers resolved. */
export async function loadSessions(
  paths: CasterPaths = DEFAULT_PATHS,
): Promise<Session[]> {
  const shibboleth = await loadShibboleth(paths.shibboleth);
  const speakerIndex = buildSpeakerIndex(shibboleth);
  const arcTitles = buildArcTitles(shibboleth);
  const mainArcs = buildMainArcs(shibboleth);

  const glob = new Bun.Glob("*.txt");
  const sessions: Session[] = [];

  for await (const rel of glob.scan({ cwd: paths.transcripts })) {
    const session = await loadSession(
      `${paths.transcripts}/${rel}`,
      speakerIndex,
      arcTitles,
      mainArcs,
    );
    if (session) sessions.push(session);
  }

  // Group by arc (numeric prefix), then chronologically within an arc.
  sessions.sort((a, b) => {
    const arcA = Number(a.id.split(".")[0]);
    const arcB = Number(b.id.split(".")[0]);
    return arcA - arcB || dateSortKey(a.date) - dateSortKey(b.date);
  });
  return sessions;
}

/** Load the full Stage 1 corpus: sessions + wiki. */
export async function loadCorpus(
  paths: CasterPaths = DEFAULT_PATHS,
): Promise<Corpus> {
  const [sessions, wiki] = await Promise.all([
    loadSessions(paths),
    loadWiki(paths.wiki),
  ]);
  return { sessions, wiki };
}
