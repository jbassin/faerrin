#!/usr/bin/env bun
// Stage 1 inspection CLI. Usage:
//   bun run src/cli.ts            -> corpus overview (sessions per arc, wiki size)
//   bun run src/cli.ts <id|arc>   -> details for a session (e.g. 105 or observatory-slipped)

import { loadCorpus, loadSessions } from "./ingest/index.ts";
import { loadWiki } from "./ingest/wiki.ts";
import { loadOrDistill, readDigest } from "./distill/index.ts";
import { AnthropicClient } from "@faerrin/llm";
import { loadOrGenerateScript } from "./script/index.ts";
import {
  readScript,
  scoreScript,
  formatReport,
  loadThreads,
  saveThreads,
  mergeThreads,
  extractThreads,
} from "./script/index.ts";
import {
  loadOrSynthesize,
  MockTTSProvider,
  EdgeTTSProvider,
  DEFAULT_EDGE_VOICES,
  ElevenLabsTTSProvider,
  DEFAULT_ELEVENLABS_VOICES,
  DEFAULT_STABILITY,
  resolveStability,
  parseSeedFlag,
  loadLexicon,
} from "./tts/index.ts";
import { readManifest } from "./tts/index.ts";
import { assembleEpisode } from "./assemble/index.ts";
import { loadOrFuseMega } from "./mega/index.ts";
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
  const lint = args.includes("--lint");
  const oneShot = args.includes("--one-shot");
  const sharpen = args.includes("--sharpen");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("Usage: bun run src/cli.ts script <session-id|arc> [--one-shot] [--sharpen] [--force] [--lint]");
    process.exit(1);
  }
  const sessions = await loadSessions();
  const match = findSession(sessions, target);
  if (!match) {
    console.error(`No session matching "${target}".`);
    process.exit(1);
  }
  // `--lint`: score the EXISTING cached script's tavern-ness; never generate.
  if (lint) {
    const existing = await readScript(match.id);
    if (!existing) {
      console.error(`No script for ${match.id}. Run \`bun run script ${target}\` first.`);
      process.exit(1);
    }
    console.log(`# ${existing.title}  (${existing.turns.length} turns)\n`);
    console.log(formatReport(scoreScript(existing)));
    process.exit(0);
  }
  const digest = await readDigest(match.id);
  if (!digest) {
    console.error(`No digest for ${match.id}. Run \`bun run distill ${target}\` first.`);
    process.exit(1);
  }
  const wiki = await loadWiki("../content/wiki");
  // Cross-session running threads (inside jokes/grudges/predictions) for callbacks.
  const threads = await loadThreads("content/running-threads.json");
  let result;
  try {
    // Two-pass (improv → dressing) is the default; --one-shot opts out.
    result = await loadOrGenerateScript(digest, wiki, { force, twoPass: !oneShot, sharpen, threads });
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

// `threads <id|arc>` — mine a cached script for cross-session running threads
// (inside jokes, grudges, predictions) and accumulate them into the store so future
// episodes can call back to them. Needs ANTHROPIC_API_KEY.
if (process.argv[2] === "threads") {
  const target = process.argv.slice(3).find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("Usage: bun run src/cli.ts threads <session-id|arc>");
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
  const STORE = "content/running-threads.json";
  let mined;
  try {
    mined = await extractThreads(new AnthropicClient(), script, script.hosts);
  } catch (err) {
    console.error(`Thread extraction failed: ${apiKeyHint(err)}`);
    process.exit(1);
  }
  const existing = await loadThreads(STORE);
  const merged = mergeThreads(existing, mined);
  await saveThreads(STORE, merged);
  console.error(`(threads → ${STORE})`);
  console.log(`# running threads after ${match.id}`);
  console.log(`mined ${mined.length}; store now ${merged.length} (was ${existing.length})\n`);
  for (const t of mined) console.log(`- ${t.text} [${t.kind}]`);
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
  const stabilityArg = args.find((a) => a.startsWith("--stability="))?.split("=")[1];
  const seedArg = args.find((a) => a.startsWith("--seed="))?.split("=")[1];
  const noPronunciation = args.includes("--no-pronunciation");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("Usage: bun run src/cli.ts tts <session-id|arc> [--provider=elevenlabs|edge|mock] [--model=<id>] [--stability=creative|natural|robust|0..1] [--seed=<int>|random] [--no-pronunciation] [--force]");
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
  let elevenLabs: ElevenLabsTTSProvider;
  try {
    elevenLabs = new ElevenLabsTTSProvider({
      modelId: modelArg,
      stability: stabilityArg !== undefined ? resolveStability(stabilityArg) : DEFAULT_STABILITY,
      seed: parseSeedFlag(seedArg, match.id),
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const synth =
    providerArg === "edge"
      ? { provider: new EdgeTTSProvider(), voices: DEFAULT_EDGE_VOICES }
      : providerArg === "mock"
        ? { provider: new MockTTSProvider() }
        : { provider: elevenLabs, voices: DEFAULT_ELEVENLABS_VOICES };
  const pronunciations = noPronunciation ? {} : await loadLexicon("content/pronunciations.json");
  let result;
  try {
    result = await loadOrSynthesize(script, { force, pronunciations, ...synth });
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
  const args = process.argv.slice(3);
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("Usage: bun run src/cli.ts assemble <session-id|arc> [--no-bed] [--bed=<path>] [--bed-gain=<0..1>]");
    process.exit(1);
  }
  // Ambient bed is ON by default (assets/tavern.mp3); --no-bed opts out. A missing
  // file is skipped with a notice inside assembleEpisode, so this stays safe in CI.
  const noBed = args.includes("--no-bed");
  const bedPath = args.find((a) => a.startsWith("--bed="))?.split("=")[1] ?? "assets/tavern.mp3";
  const bedGain = args.find((a) => a.startsWith("--bed-gain="))?.split("=")[1];
  if (bedGain !== undefined && !(Number(bedGain) >= 0 && Number(bedGain) <= 1)) {
    console.error("--bed-gain must be a number in [0,1] (e.g. 0.07).");
    process.exit(1);
  }
  const bed = noBed
    ? undefined
    : { path: bedPath, ...(bedGain !== undefined ? { gain: Number(bedGain) } : {}) };
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
    outputs = await assembleEpisode(manifest, script, { bed });
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

// `mega <from> <to> [...]` — fuse the sessions in an inclusive date range into one
// fresh month-in-review recap, then run the remaining stages under a synthetic
// mega id (fuse → script → tts → assemble). The face site auto-surfaces the result
// on its next build (no face changes). Needs ANTHROPIC_API_KEY (fuse + script) and,
// for real audio, a TTS provider + ffmpeg (assemble). `--digest-only`/`--script-only`
// stop early so you can eyeball the cheap stages before spending on synthesis.
if (process.argv[2] === "mega") {
  const args = process.argv.slice(3);
  const [from, to] = args.filter((a) => !a.startsWith("--"));
  if (!from || !to) {
    console.error(
      "Usage: bun run src/cli.ts mega <from> <to> [--minutes=<n>] [--arc=<slug>] [--digest-only] [--script-only] [--provider=elevenlabs|edge|mock] [--model=<id>] [--stability=creative|natural|robust|0..1] [--seed=<int>|random] [--no-pronunciation] [--no-bed] [--bed=<path>] [--bed-gain=<0..1>] [--force]",
    );
    process.exit(1);
  }
  // Guard the date args up front: a typo'd date would otherwise sort to NaN/0 and
  // silently mis-select (e.g. an empty window or a widened one) rather than error.
  const DATE_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;
  for (const [label, value] of [["from", from], ["to", to]] as const) {
    if (!DATE_RE.test(value)) {
      console.error(`Invalid ${label} date "${value}" — expected YYYY-M-D (e.g. 2026-5-7).`);
      process.exit(1);
    }
  }
  const force = args.includes("--force");
  const arc = args.find((a) => a.startsWith("--arc="))?.split("=")[1];
  const digestOnly = args.includes("--digest-only");
  const scriptOnly = args.includes("--script-only");

  // Target runtime drives both the fuse beat budget and the script token ceiling.
  // Empirically ~2.1 min of finished audio per beat; a single session episode runs
  // ~23 min from ~11 beats, so a "mega" defaults to ~1 hour. ~1100 output tokens/min
  // gives the two-pass script generous headroom (well under Opus 4.8's 128k cap; the
  // client streams, so a large ceiling carries no timeout risk and only caps truncation).
  const minutesArg = args.find((a) => a.startsWith("--minutes="))?.split("=")[1];
  const minutes = minutesArg !== undefined ? Number(minutesArg) : 60;
  if (!(minutes > 0) || !Number.isFinite(minutes)) {
    console.error(`--minutes must be a positive number (got "${minutesArg}").`);
    process.exit(1);
  }
  const targetBeats = Math.max(6, Math.round(minutes / 2.1));
  const scriptMaxTokens = Math.min(120_000, Math.max(32_000, Math.round(minutes * 1100)));

  // Step 1 — fuse the in-range members' cached digests into one mega digest.
  const sessions = await loadSessions();
  let mega;
  try {
    mega = await loadOrFuseMega(
      sessions,
      { from, to, ...(arc ? { arc } : {}) },
      { force, targetBeats },
    );
  } catch (err) {
    console.error(`Fuse failed: ${apiKeyHint(err)}`);
    process.exit(1);
  }
  const { digest, id } = mega;
  console.error(mega.cached ? `(cached digest → ${mega.path})` : `(fused → ${mega.path})`);
  console.log(`# mega ${id}`);
  console.log(
    `${digest.beats.length} beats across the span (target ~${targetBeats} ≈ ${minutes}m)\n\n${digest.synopsis}\n`,
  );
  if (digestOnly) {
    console.log("(--digest-only) drop the flag to generate the script + audio.");
    process.exit(0);
  }

  // Step 2 — Stage 3 script, keyed by the mega id (two-pass, wiki-grounded).
  const wiki = await loadWiki("../content/wiki");
  const threads = await loadThreads("content/running-threads.json");
  let scriptResult;
  try {
    scriptResult = await loadOrGenerateScript(digest, wiki, {
      force,
      twoPass: true,
      threads,
      maxTokens: scriptMaxTokens,
    });
  } catch (err) {
    console.error(`Script generation failed: ${apiKeyHint(err)}`);
    process.exit(1);
  }
  const megaScript = scriptResult.script;
  console.error(
    scriptResult.cached
      ? `(cached script → ${scriptResult.path})`
      : `(generated script → ${scriptResult.path})`,
  );
  console.log(`script: ${megaScript.turns.length} turns — "${megaScript.title}"`);
  if (scriptOnly) {
    console.log("(--script-only) drop the flag to synthesize + assemble the audio.");
    process.exit(0);
  }

  // Step 3 — Stage 4 TTS (mirrors the `tts` command's provider construction).
  const providerArg = (args.find((a) => a.startsWith("--provider="))?.split("=")[1] ??
    "elevenlabs") as "mock" | "edge" | "elevenlabs";
  const modelArg = args.find((a) => a.startsWith("--model="))?.split("=")[1];
  const stabilityArg = args.find((a) => a.startsWith("--stability="))?.split("=")[1];
  const seedArg = args.find((a) => a.startsWith("--seed="))?.split("=")[1];
  const noPronunciation = args.includes("--no-pronunciation");
  let elevenLabs: ElevenLabsTTSProvider;
  try {
    elevenLabs = new ElevenLabsTTSProvider({
      modelId: modelArg,
      stability: stabilityArg !== undefined ? resolveStability(stabilityArg) : DEFAULT_STABILITY,
      seed: parseSeedFlag(seedArg, id),
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const synth =
    providerArg === "edge"
      ? { provider: new EdgeTTSProvider(), voices: DEFAULT_EDGE_VOICES }
      : providerArg === "mock"
        ? { provider: new MockTTSProvider() }
        : { provider: elevenLabs, voices: DEFAULT_ELEVENLABS_VOICES };
  const pronunciations = noPronunciation ? {} : await loadLexicon("content/pronunciations.json");
  let ttsResult;
  try {
    ttsResult = await loadOrSynthesize(megaScript, { force, pronunciations, ...synth });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ELEVENLABS_API_KEY/i.test(msg)) {
      console.error(
        "ElevenLabs needs ELEVENLABS_API_KEY (set it in .env), or use --provider=edge (free) / --provider=mock (offline).",
      );
    } else {
      console.error(`TTS failed: ${msg}`);
    }
    process.exit(1);
  }
  console.error(
    ttsResult.cached ? `(cached audio → ${ttsResult.path})` : `(synthesized → ${ttsResult.path})`,
  );

  // Step 4 — Stage 5 assemble (mirrors the `assemble` command's bed handling).
  const noBed = args.includes("--no-bed");
  const bedPath = args.find((a) => a.startsWith("--bed="))?.split("=")[1] ?? "assets/tavern.mp3";
  const bedGain = args.find((a) => a.startsWith("--bed-gain="))?.split("=")[1];
  if (bedGain !== undefined && !(Number(bedGain) >= 0 && Number(bedGain) <= 1)) {
    console.error("--bed-gain must be a number in [0,1] (e.g. 0.07).");
    process.exit(1);
  }
  const bed = noBed
    ? undefined
    : { path: bedPath, ...(bedGain !== undefined ? { gain: Number(bedGain) } : {}) };
  let outputs;
  try {
    outputs = await assembleEpisode(ttsResult.manifest, megaScript, { bed });
  } catch (err) {
    console.error(`Assembly failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  const bytes = Bun.file(outputs.audioPath).size;
  console.log(`episode:    ${outputs.audioPath} (${(bytes / 1_000_000).toFixed(1)} MB)`);
  console.log(`transcript: ${outputs.transcriptPath}`);
  console.log("\nRebuild face to publish it: bun run --filter @faerrin/face build");
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
    if (beat.tableAngle) console.log(`   angle: ${beat.tableAngle}`);
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
