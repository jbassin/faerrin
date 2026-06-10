/**
 * Node voice daemon (plan §11.1 fallback). Bun's @discordjs/voice can't
 * establish a voice UDP connection (D1 — the spike aborts at "joining voice"),
 * so the Discord gateway + voice run here under **Node**, controlled by the Bun
 * server over a tiny newline-JSON protocol on stdio:
 *
 *   stdin  (Bun → daemon): {"id":N,"cmd":"join","channelId":"…"}
 *   stdout (daemon → Bun): {"id":N,"ok":true,...}  responses
 *                          {"event":"trackEnd","reason":"finished"}  events
 *   stderr: human logs (flow into journalctl)
 *
 * Env: DISCORD_TOKEN, LARK_GUILD_ID. Plain JS (no build step) so `node
 * voice-daemon.mjs` just runs.
 */
import {
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";
import { Client, GatewayIntentBits } from "discord.js";
import prism from "prism-media";

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.LARK_GUILD_ID;

const log = (...a) => console.error("[lark-voice]", ...a);
const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const player = createAudioPlayer();

let connection = null;
let currentChannelId = null;
let currentResource = null;
let suppressEnd = false;

player.on(AudioPlayerStatus.Idle, () => {
  currentResource = null;
  if (suppressEnd) {
    suppressEnd = false;
    return;
  }
  send({ event: "trackEnd", reason: "finished" });
});
player.on("error", (err) => {
  log("player error:", err?.message ?? err);
  currentResource = null;
  if (suppressEnd) {
    suppressEnd = false;
    return;
  }
  send({ event: "trackEnd", reason: "error" });
});

// Push playback position ~1.5s while audio is flowing (Bun caches it for now-playing).
setInterval(() => {
  if (currentResource && player.state.status === AudioPlayerStatus.Playing) {
    send({ event: "position", positionMs: currentResource.playbackDuration });
  }
}, 1500).unref?.();

async function resolveChannel(userId) {
  const guild = client.guilds.cache.get(GUILD_ID);
  const cached = guild?.voiceStates.cache.get(userId)?.channelId ?? null;
  log(`resolveChannel ${userId}: cache has ${guild?.voiceStates.cache.size ?? 0} state(s), cached=${cached ?? "none"}`);
  if (cached) return cached;
  try {
    const vs = await client.rest.get(`/guilds/${GUILD_ID}/voice-states/${userId}`);
    log(`resolveChannel ${userId}: REST channel=${vs?.channel_id ?? "none"}`);
    return vs?.channel_id ?? null;
  } catch (err) {
    log(`resolveChannel ${userId}: REST ${err?.status === 404 ? "404 (not in voice)" : `failed: ${err?.message ?? err}`}`);
    return null;
  }
}

async function join(channelId) {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) throw new Error(`guild ${GUILD_ID} not in gateway cache`);
  log(`joining voice channel ${channelId}…`);
  const conn = joinVoiceChannel({ channelId, guildId: GUILD_ID, adapterCreator: guild.voiceAdapterCreator });
  if (conn !== connection) {
    conn.on("stateChange", (o, n) => log(`voice connection ${o.status} → ${n.status}`));
    conn.on("error", (e) => log("voice connection error:", e?.message ?? e));
  }
  connection = conn;
  conn.subscribe(player);
  await entersState(conn, VoiceConnectionStatus.Ready, 20_000);
  currentChannelId = channelId;
  log(`voice connection READY in ${channelId}`);
}

function leave() {
  suppressEnd = true;
  player.stop(true);
  connection?.destroy();
  connection = null;
  currentChannelId = null;
}

function play({ filePath, filter }) {
  if (currentResource) suppressEnd = true; // replacing — don't emit a spurious end
  const args = ["-analyzeduration", "0", "-loglevel", "0", "-i", filePath];
  if (filter) args.push("-af", filter);
  args.push("-f", "s16le", "-ar", "48000", "-ac", "2");
  const transcoder = new prism.FFmpeg({ args });
  currentResource = createAudioResource(transcoder, { inputType: StreamType.Raw });
  player.play(currentResource);
}

async function handle(msg) {
  const { id, cmd } = msg;
  log(`cmd: ${cmd}${msg.channelId ? ` channel=${msg.channelId}` : ""}${msg.userId ? ` user=${msg.userId}` : ""}`);
  try {
    let result;
    switch (cmd) {
      case "join":
        await join(msg.channelId);
        break;
      case "leave":
        leave();
        break;
      case "play":
        play(msg);
        break;
      case "pause":
        player.pause();
        break;
      case "resume":
        player.unpause();
        break;
      case "stop":
        suppressEnd = true;
        player.stop(true);
        break;
      case "position":
        result = { positionMs: currentResource?.playbackDuration ?? 0 };
        break;
      case "resolveChannel":
        result = { channelId: await resolveChannel(msg.userId) };
        break;
      default:
        throw new Error(`unknown cmd ${cmd}`);
    }
    send({ id, ok: true, ...(result ?? {}) });
  } catch (err) {
    send({ id, ok: false, error: String(err?.message ?? err) });
  }
}

// --- stdin: newline-delimited JSON commands ---
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (line.trim()) {
      try {
        void handle(JSON.parse(line));
      } catch (err) {
        log("bad command line:", err?.message ?? err);
      }
    }
  }
});

// Log every voice-state change so we can see whether the bot observes the
// operator joining/leaving voice at all (intent/gateway sanity).
client.on("voiceStateUpdate", (oldState, newState) => {
  log(`voiceStateUpdate user=${newState.id} channel=${newState.channelId ?? oldState.channelId ?? "none"}`);
  // Auto-leave input (B2): report non-bot population of the active channel.
  if (!currentChannelId) return;
  const ch = client.guilds.cache.get(GUILD_ID)?.channels.cache.get(currentChannelId);
  if (ch?.isVoiceBased()) send({ event: "population", count: ch.members.filter((m) => !m.user.bot).size });
});

client.once("clientReady", () => {
  const guild = client.guilds.cache.get(GUILD_ID);
  log(`ready as ${client.user?.tag} in "${guild?.name ?? GUILD_ID}" — ${guild?.voiceStates.cache.size ?? 0} voice states cached`);
  send({ event: "ready" });
});

if (!TOKEN || !GUILD_ID) {
  log("missing DISCORD_TOKEN or LARK_GUILD_ID");
  process.exit(1);
}
client.login(TOKEN).catch((err) => {
  log("login failed:", err?.message ?? err);
  process.exit(1);
});
