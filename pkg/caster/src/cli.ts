#!/usr/bin/env bun
// Stage 1 inspection CLI. Usage:
//   bun run src/cli.ts            -> corpus overview (sessions per arc, wiki size)
//   bun run src/cli.ts <id|arc>   -> details for a session (e.g. 105 or observatory-slipped)

import { loadCorpus, loadSessions } from "./ingest/index.ts";
import { loadWiki } from "./ingest/wiki.ts";
import { loadOrDistill, readDigest } from "./distill/index.ts";
import { loadOrGenerateScript } from "./script/index.ts";
import { readScript } from "./script/index.ts";
import {
  loadOrSynthesize,
  MockTTSProvider,
  EdgeTTSProvider,
  DEFAULT_EDGE_VOICES,
  ElevenLabsTTSProvider,
  DEFAULT_ELEVENLABS_VOICES,
} from "./tts/index.ts";
import { readManifest } from "./tts/index.ts";
import { assembleEpisode } from "./assemble/index.ts";
import type { Session } from "./types.ts";

function findSession(sessions: Session[], arg: string): Session | undefined {
  return sessions.find((s) => s.id === arg || s.id.startsWith(`${arg}.`) || s.arc === arg);
}

function apiKeyHint(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return /authentication method/i.test(msg)
    ? "Needs an Anthropic API key. Set ANTHROPIC_API_KEY in your environment or .env."
    : msg;
}

// `script <id|arc> [--force]` — Stage 3: two-host script from a cached digest.
if (process.argv[2] === "script") {
  const args = process.argv.slice(3);
  const force = args.includes("--force");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("Usage: bun run src/cli.ts script <session-id|arc> [--force]");
    process.exit(1);
  }
  const sessions = await loadSessions();
  const match = findSession(sessions, target);
  if (!match) {
    console.error(`No session matching "${target}".`);
    process.exit(1);
  }
  const digest = await readDigest(match.id);
  if (!digest) {
    console.error(`No digest for ${match.id}. Run \`bun run distill ${target}\` first.`);
    process.exit(1);
  }
  const wiki = await loadWiki("../shared-content/wiki");
  let result;
  try {
    result = await loadOrGenerateScript(digest, wiki, { force });
  } catch (err) {
    console.error(`Script generation failed: ${apiKeyHint(err)}`);
    process.exit(1);
  }
  const { script } = result;
  console.error(result.cached ? `(cached → ${result.path})` : `(generated → ${result.path})`);
  console.log(`# ${script.title}\n`);
  for (const turn of script.turns) {
    const who = script.hosts[turn.speaker].name;
    const emo = turn.emotion ? ` (${turn.emotion})` : "";
    console.log(`${who}${emo}: ${turn.text}\n`);
  }
  console.log(`(${script.turns.length} turns)`);
  process.exit(0);
}

// `tts <id|arc> [--force]` — Stage 4: synthesize a cached script to per-turn clips.
// Default provider is the offline mock (silent WAV); real providers come later.
if (process.argv[2] === "tts") {
  const args = process.argv.slice(3);
  const force = args.includes("--force");
  const providerArg = (args.find((a) => a.startsWith("--provider="))?.split("=")[1] ??
    "elevenlabs") as "mock" | "edge" | "elevenlabs";
  const modelArg = args.find((a) => a.startsWith("--model="))?.split("=")[1];
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("Usage: bun run src/cli.ts tts <session-id|arc> [--provider=elevenlabs|edge|mock] [--model=<id>] [--force]");
    process.exit(1);
  }
  const sessions = await loadSessions();
  const match = findSession(sessions, target);
  if (!match) {
    console.error(`No session matching "${target}".`);
    process.exit(1);
  }
  const script = await readScript(match.id);
  if (!script) {
    console.error(`No script for ${match.id}. Run \`bun run script ${target}\` first.`);
    process.exit(1);
  }
  const synth =
    providerArg === "edge"
      ? { provider: new EdgeTTSProvider(), voices: DEFAULT_EDGE_VOICES }
      : providerArg === "mock"
        ? { provider: new MockTTSProvider() }
        : { provider: new ElevenLabsTTSProvider({ modelId: modelArg }), voices: DEFAULT_ELEVENLABS_VOICES };
  let result;
  try {
    result = await loadOrSynthesize(script, { force, ...synth });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ELEVENLABS_API_KEY/i.test(msg)) {
      console.error("ElevenLabs needs ELEVENLABS_API_KEY (set it in .env), or use --provider=edge (free) / --provider=mock (offline).");
    } else {
      console.error(`TTS failed: ${msg}`);
    }
    process.exit(1);
  }
  const { manifest, cached, path } = result;
  console.error(cached ? `(cached → ${path})` : `(synthesized → ${path})`);
  const totalMs = manifest.clips.reduce((sum, c) => sum + c.durationMs, 0);
  const mins = Math.floor(totalMs / 60000);
  const secs = Math.round((totalMs % 60000) / 1000);
  const unit = manifest.mode === "dialogue" ? "dialogue chunks" : "clips";
  console.log(`# ${script.title}`);
  console.log(`${manifest.clips.length} ${unit} (${manifest.format}) · ~${mins}m${secs}s · voices ${manifest.voices.A}/${manifest.voices.B}/${manifest.voices.C}`);
  console.log(`clips in: ${path.replace(/\.audio\.json$/, "/")}`);
  process.exit(0);
}

// `assemble <id|arc>` — Stage 5: stitch clips → episode.mp3 + transcript.md (needs ffmpeg).
if (process.argv[2] === "assemble") {
  const target = process.argv.slice(3).find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("Usage: bun run src/cli.ts assemble <session-id|arc>");
    process.exit(1);
  }
  const sessions = await loadSessions();
  const match = findSession(sessions, target);
  if (!match) {
    console.error(`No session matching "${target}".`);
    process.exit(1);
  }
  const manifest = await readManifest(match.id);
  if (!manifest) {
    console.error(`No audio manifest for ${match.id}. Run \`bun run tts ${target}\` first.`);
    process.exit(1);
  }
  const script = await readScript(match.id);
  if (!script) {
    console.error(`No script for ${match.id}. Run \`bun run script ${target}\` first.`);
    process.exit(1);
  }
  let outputs;
  try {
    outputs = await assembleEpisode(manifest, script);
  } catch (err) {
    console.error(`Assembly failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  const bytes = Bun.file(outputs.audioPath).size;
  console.log(`# ${script.title}`);
  console.log(`episode:    ${outputs.audioPath} (${(bytes / 1_000_000).toFixed(1)} MB)`);
  console.log(`transcript: ${outputs.transcriptPath}`);
  process.exit(0);
}

// `distill <id|arc> [--force]` — Stage 2: distill a session to story beats.
// Reuses the cached out/<id>.digest.json if present; --force re-runs the LLM.
// A live run needs ANTHROPIC_API_KEY.
if (process.argv[2] === "distill") {
  const args = process.argv.slice(3);
  const force = args.includes("--force");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("Usage: bun run src/cli.ts distill <session-id|arc> [--force]");
    process.exit(1);
  }
  const sessions = await loadSessions();
  const match = findSession(sessions, target);
  if (!match) {
    console.error(`No session matching "${target}".`);
    process.exit(1);
  }
  let result;
  try {
    result = await loadOrDistill(match, { force });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/authentication method/i.test(msg)) {
      console.error("Distillation needs an Anthropic API key. Set ANTHROPIC_API_KEY in your environment or .env.");
    } else {
      console.error(`Distillation failed: ${msg}`);
    }
    process.exit(1);
  }
  const { digest } = result;
  console.error(result.cached ? `(cached → ${result.path})` : `(distilled → ${result.path})`);
  console.log(`# ${digest.sessionId}\n\n${digest.synopsis}\n`);
  for (const beat of digest.beats) {
    const tags = [...beat.characters, ...beat.locations];
    const mood = beat.tone ? ` · ${beat.tone}` : "";
    console.log(`${beat.order}. ${beat.summary}${tags.length ? `  [${tags.join(", ")}]` : ""}${mood}`);
    if (beat.significance) console.log(`   why: ${beat.significance}`);
    for (const d of beat.details ?? []) console.log(`   - ${d}`);
    if (beat.wikiRefs.length) console.log(`   wiki: ${beat.wikiRefs.join(", ")}`);
  }
  console.log(`\n(${digest.discarded.length} table-talk samples discarded)`);
  process.exit(0);
}

function speakerBreakdown(session: Session): string {
  const counts = new Map<string, number>();
  for (const t of session.turns) {
    const key = t.player ? `${t.speaker} (${t.player}/${t.role})` : `${t.speaker} (unmapped)`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `    ${String(n).padStart(5)}  ${k}`)
    .join("\n");
}

const arg = process.argv[2];
const { sessions, wiki } = await loadCorpus();

if (!arg) {
  const byArc = new Map<string, Session[]>();
  for (const s of sessions) {
    (byArc.get(s.arc) ?? byArc.set(s.arc, []).get(s.arc)!).push(s);
  }
  console.log(`Sessions: ${sessions.length}   Wiki pages: ${wiki.pages.size}\n`);
  for (const [arc, group] of byArc) {
    const main = group[0]?.isMain ? " [main]" : "";
    console.log(`  ${arc}${main} — ${group.length} session(s)  «${group[0]?.arcTitle ?? "?"}»`);
  }
  console.log("\nPass a session id or arc slug for details (e.g. `bun run src/cli.ts 105`).");
} else {
  const match = sessions.find((s) => s.id === arg || s.id.startsWith(`${arg}.`) || s.arc === arg);
  if (!match) {
    console.error(`No session matching "${arg}".`);
    process.exit(1);
  }
  console.log(`${match.id}`);
  console.log(`  arc:    ${match.arc} «${match.arcTitle}»${match.isMain ? " [main]" : ""}`);
  console.log(`  date:   ${match.date}`);
  console.log(`  turns:  ${match.turns.length}`);
  console.log(`  speakers:\n${speakerBreakdown(match)}`);
}
