// Build-time data layer. Runs during `astro build` (Node/Bun runtime), scans the
// pipeline's gitignored ../out for finished episodes, and shapes them for the
// pages. Pure Node fs + ffprobe so Vite never has to resolve the `bun` module.
//
// Reuses the pipeline's own contracts and helpers (type-only + pure functions):
//  - shared artifact types from src/types.ts
//  - stripAudioTags from src/tts/tags.ts (clean v3 "[warm]…[laughs]" cues for display)
//  - buildArcTitles / buildMainArcs from src/ingest/shibboleth.ts (titles + main/one-shot)
//  - parseFilename / dateSortKey from src/ingest/transcript.ts (campaign numbering)

import { readdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AudioManifest,
  Script,
  SessionDigest,
  Shibboleth,
  SpeakerId,
} from "../../../caster/src/types.ts";
import { stripAudioTags } from "../../../caster/src/tts/tags.ts";
import { buildArcTitles, buildMainArcs } from "../../../caster/src/ingest/shibboleth.ts";
import { dateSortKey, parseFilename } from "../../../caster/src/ingest/transcript.ts";

const execFileAsync = promisify(execFile);

// Sibling caster package root (pkg/caster) — holds the pipeline's out/ + content/.
const REPO = fileURLToPath(new URL("../../../caster", import.meta.url));
const OUT_DIR = path.join(REPO, "out");
const TRANSCRIPTS_DIR = path.join(REPO, "content", "transcripts");
const SHIBBOLETH = path.join(REPO, "content", "shibboleth.json");

const EPISODE_SUFFIX = ".episode.mp3";

/** One line of displayable transcript (audio tags already stripped). */
export interface TranscriptLine {
  speaker: SpeakerId;
  /** Resolved host name, e.g. "Reed". */
  name: string;
  text: string;
}

/** Everything a page needs about one finished episode. */
export interface Episode {
  /** Full session id, e.g. "000.through-a-song-darkly.2026-5-25". */
  id: string;
  /** Numeric campaign prefix from the filename, e.g. 0. NOT the episode number. */
  arcNo: number;
  /** Pretty campaign title, e.g. "Through a Song, Darkly". */
  arcTitle: string;
  /**
   * 1-based position of this session within its campaign, ordered by date across
   * ALL transcripts in the campaign (not just finished ones). This is the episode
   * number; e.g. the 28th "Through a Song, Darkly" session is episode 28.
   */
  episodeNo: number;
  /** Main, long-running campaign (number < 100) vs. one-shot / mini-campaign. */
  isMain: boolean;
  /** Session date string from the id, e.g. "2026-5-25". */
  date: string;
  /** Raw script title, which may embed the campaign name (kept for reference). */
  title: string;
  /** Episode-only title with any leading campaign-name prefix stripped. */
  episodeTitle: string;
  hostA: string;
  hostB: string;
  /** Third host name; empty string for legacy two-host episodes. */
  hostC: string;
  /** Episode length in milliseconds. */
  runtimeMs: number;
  /** Synopsis, audio tags stripped. */
  synopsis: string;
  /** Public URL of the copied audio, e.g. "/audio/<id>.mp3". */
  mp3Url: string;
  transcript: TranscriptLine[];
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Sortable key for an unpadded "YYYY-M-D" date. */
function dateKey(date: string): number {
  const [y = "0", m = "0", d = "0"] = date.split("-");
  return Number(y) * 10000 + Number(m) * 100 + Number(d);
}

/** Split "NNN.arc-slug.YYYY-M-D" into its parts (slug may not contain dots). */
function parseId(id: string): { arcNo: number; slug: string; date: string } {
  const parts = id.split(".");
  const arcNo = Number(parts[0]);
  const date = parts[parts.length - 1] ?? "";
  const slug = parts.slice(1, -1).join(".");
  return { arcNo: Number.isFinite(arcNo) ? arcNo : 0, slug, date };
}

/**
 * Build session-id -> episode number by scanning every transcript in the
 * campaign corpus, grouping by campaign prefix, and ranking by date. The episode
 * number is a session's position among ALL its campaign's transcripts (1-based),
 * so a finished episode keeps the same number even when earlier ones aren't yet
 * rendered to audio. Returns an empty map if the transcripts dir is unavailable.
 */
async function buildEpisodeNumbers(): Promise<Map<string, number>> {
  let names: string[];
  try {
    names = await readdir(TRANSCRIPTS_DIR);
  } catch {
    return new Map();
  }

  // campaign prefix -> [{ id, dateKey }] gathered, then ranked per campaign.
  const byCampaign = new Map<string, { id: string; key: number }[]>();
  for (const name of names) {
    const parsed = parseFilename(name);
    if (!parsed) continue;
    const list = byCampaign.get(parsed.arcNumber) ?? [];
    list.push({ id: parsed.id, key: dateSortKey(parsed.date) });
    byCampaign.set(parsed.arcNumber, list);
  }

  const numbers = new Map<string, number>();
  for (const list of byCampaign.values()) {
    list.sort((a, b) => a.key - b.key);
    list.forEach((entry, i) => numbers.set(entry.id, i + 1));
  }
  return numbers;
}

/**
 * Strip a leading campaign-name prefix from a script title. The script LLM often
 * emits "Through a Song, Darkly — The Canary in the Ballroom"; the episode title
 * is just the part after the campaign name. Tolerant of em/en dash, colon, or
 * hyphen separators; falls back to the full title when there's no such prefix.
 */
function stripCampaignPrefix(title: string, arcTitle: string): string {
  const t = title.trim();
  if (!arcTitle) return t;
  if (t.toLowerCase().startsWith(arcTitle.toLowerCase())) {
    const rest = t.slice(arcTitle.length).replace(/^\s*[—–:-]\s*/, "").trim();
    if (rest) return rest;
  }
  return t;
}

/** Exact episode length via ffprobe; falls back to summed clip durations. */
async function probeRuntimeMs(id: string, manifest: AudioManifest | null): Promise<number> {
  const mp3 = path.join(OUT_DIR, `${id}${EPISODE_SUFFIX}`);
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "json",
      mp3,
    ]);
    const seconds = Number(JSON.parse(stdout)?.format?.duration);
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000);
  } catch {
    // ffprobe missing or failed — fall through to the manifest estimate.
  }
  return manifest?.clips.reduce((sum, c) => sum + (c.durationMs || 0), 0) ?? 0;
}

/**
 * Load every finished episode (one with an out/<id>.episode.mp3), newest arc and
 * session first ordering left to callers. Used by both pages at build time.
 */
export async function loadEpisodes(): Promise<Episode[]> {
  let names: string[];
  try {
    names = await readdir(OUT_DIR);
  } catch {
    return [];
  }

  const shibboleth = (await readJson<Shibboleth>(SHIBBOLETH)) ?? {};
  const arcTitles = buildArcTitles(shibboleth);
  const mainArcs = buildMainArcs(shibboleth);
  const episodeNumbers = await buildEpisodeNumbers();

  const ids = names
    .filter((n) => n.endsWith(EPISODE_SUFFIX))
    .map((n) => n.slice(0, -EPISODE_SUFFIX.length));

  const episodes: Episode[] = [];
  for (const id of ids) {
    const script = await readJson<Script>(path.join(OUT_DIR, `${id}.script.json`));
    if (!script) continue; // no script => can't title/label it; skip defensively.

    const digest = await readJson<SessionDigest>(path.join(OUT_DIR, `${id}.digest.json`));
    const manifest = await readJson<AudioManifest>(path.join(OUT_DIR, `${id}.audio.json`));

    const { arcNo, slug, date } = parseId(id);
    const arcTitle = arcTitles.get(slug) ?? slug;
    const hostA = script.hosts.A.name;
    const hostB = script.hosts.B.name;
    // hosts.C is absent on episodes scripted before the third host existed; the
    // raw JSON is read directly (no parseScript backfill), so guard the access.
    const hostC = script.hosts.C?.name ?? "";

    episodes.push({
      id,
      arcNo,
      arcTitle,
      // Prefer the corpus-wide ranking; fall back to the campaign rule (<100 ==
      // main) for isMain and to 0 for a number we couldn't derive from disk.
      episodeNo: episodeNumbers.get(id) ?? 0,
      isMain: mainArcs.has(slug) || arcNo < 100,
      date,
      title: script.title,
      episodeTitle: stripCampaignPrefix(script.title, arcTitle),
      hostA,
      hostB,
      hostC,
      runtimeMs: await probeRuntimeMs(id, manifest),
      synopsis: stripAudioTags(digest?.synopsis ?? ""),
      mp3Url: `/audio/${id}.mp3`,
      transcript: script.turns.map((t) => ({
        speaker: t.speaker,
        name: script.hosts[t.speaker]?.name ?? t.speaker,
        text: stripAudioTags(t.emotion ? `[${t.emotion}] ${t.text}` : t.text),
      })),
    });
  }

  // Group by arc (numeric), then chronologically within an arc — mirrors
  // loadSessions ordering in src/ingest/index.ts.
  episodes.sort((a, b) => a.arcNo - b.arcNo || dateKey(a.date) - dateKey(b.date));
  return episodes;
}

/** Format a millisecond runtime as "MM:SS" (or "H:MM:SS" past an hour). */
export function formatRuntime(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
