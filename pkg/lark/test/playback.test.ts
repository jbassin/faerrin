import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db/index";
import * as repo from "../src/db/repo";
import { PlaybackEngine } from "../src/bot/playback";
import type { TrackEndReason, VoiceAdapter, VoiceStateResolver } from "../src/bot/voice";

/** A fake voice adapter that records calls and lets tests fire track-end. */
class FakeVoice implements VoiceAdapter {
  connected = false;
  channel: string | null = null;
  playing: string | null = null;
  paused = false;
  lastFilter = "";
  private endCb: ((r: TrackEndReason) => void) | null = null;
  failPlayFor: Set<string> = new Set();

  async join(channelId: string) {
    this.connected = true;
    this.channel = channelId;
  }
  leave() {
    this.connected = false;
    this.channel = null;
    this.playing = null;
  }
  isConnected() {
    return this.connected;
  }
  currentChannelId() {
    return this.channel;
  }
  async play(filePath: string, filter: string, onEnd: (r: TrackEndReason) => void) {
    if (this.failPlayFor.has(filePath)) throw new Error("play failed");
    this.playing = filePath;
    this.paused = false;
    this.lastFilter = filter;
    this.endCb = onEnd;
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  stopAudio() {
    this.playing = null;
  }
  positionMs() {
    return 0;
  }
  /** Test helper: simulate the current track ending. */
  async fireEnd(reason: TrackEndReason = "finished") {
    const cb = this.endCb;
    this.endCb = null;
    cb?.(reason);
    await new Promise((r) => setTimeout(r, 0)); // let the serialized handler run
  }
}

let db: Database;
let voice: FakeVoice;
const resolver: VoiceStateResolver = { channelOf: (uid) => (uid === "op" ? "chan-1" : null) };

function mkTrack(title: string, filePath: string | null = `/data/${title}.ogg`, lufs: number | null = -20) {
  return repo.createTrack(db, { title, sourceType: "upload", filePath, loudnessLufs: lufs }).id;
}

function engine(opts?: { autoLeaveMs?: number; setTimer?: any; clearTimer?: any }) {
  return new PlaybackEngine({ db, voice, resolver, targetLufs: -16, ...opts });
}

beforeEach(() => {
  db = openDb(":memory:");
  voice = new FakeVoice();
});

describe("join / follow-the-operator (B1)", () => {
  test("joins the operator's channel", async () => {
    await engine().join({ userId: "op" });
    expect(voice.channel).toBe("chan-1");
  });
  test("explicit channel overrides", async () => {
    await engine().join({ userId: "op", channelId: "chan-9" });
    expect(voice.channel).toBe("chan-9");
  });
  test("409 when operator is in no channel and no override", async () => {
    await expect(engine().join({ userId: "ghost" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("play / stop (B4/B5/D6)", () => {
  test("play joins + plays first track with gain filter", async () => {
    const e = engine();
    const t1 = mkTrack("a");
    const np = await e.play({ trackIds: [t1, mkTrack("b")], userId: "op" });
    expect(voice.playing).toBe("/data/a.ogg");
    expect(voice.lastFilter).toContain("volume=4.00dB"); // -16 - (-20) = +4
    expect(voice.lastFilter).toContain("alimiter");
    expect(np.status).toBe("playing");
    expect(np.queueLength).toBe(2);
  });
  test("stop clears queue but stays connected (D6)", async () => {
    const e = engine();
    await e.play({ trackIds: [mkTrack("a")], userId: "op" });
    const np = await e.stop();
    expect(np.status).toBe("idle");
    expect(np.connected).toBe(true);
    expect(np.queueLength).toBe(0);
  });
});

describe("queue advance + loop (B7/B8)", () => {
  test("finishing advances to next track", async () => {
    const e = engine();
    const [a, b] = [mkTrack("a"), mkTrack("b")];
    await e.play({ trackIds: [a, b], userId: "op" });
    await voice.fireEnd("finished");
    expect(voice.playing).toBe("/data/b.ogg");
  });
  test("loop=none stops at end of queue", async () => {
    const e = engine();
    await e.play({ trackIds: [mkTrack("a")], userId: "op" });
    await voice.fireEnd("finished");
    expect(e.nowPlaying().status).toBe("idle");
  });
  test("loop=track repeats current", async () => {
    const e = engine();
    await e.play({ trackIds: [mkTrack("a"), mkTrack("b")], userId: "op" });
    await e.setLoop("track");
    await voice.fireEnd("finished");
    expect(voice.playing).toBe("/data/a.ogg");
  });
  test("loop=playlist wraps", async () => {
    const e = engine();
    const [a, b] = [mkTrack("a"), mkTrack("b")];
    await e.play({ trackIds: [a, b], userId: "op" });
    await e.setLoop("playlist");
    await voice.fireEnd("finished"); // → b
    await voice.fireEnd("finished"); // → wrap to a
    expect(voice.playing).toBe("/data/a.ogg");
  });
});

describe("resilient skip (B10)", () => {
  test("a track that fails to play is skipped and marked error", async () => {
    const e = engine();
    const a = mkTrack("a");
    const b = mkTrack("b");
    voice.failPlayFor.add("/data/a.ogg");
    await e.play({ trackIds: [a, b], userId: "op" });
    expect(voice.playing).toBe("/data/b.ogg");
    expect(repo.getTrack(db, a)!.status).toBe("error");
  });
  test("missing file is skipped", async () => {
    const e = engine();
    const a = mkTrack("a", null); // no file_path
    const b = mkTrack("b");
    await e.play({ trackIds: [a, b], userId: "op" });
    expect(voice.playing).toBe("/data/b.ogg");
  });
});

describe("auto-leave (B2)", () => {
  test("empty channel arms a timer that leaves; rejoin cancels it", async () => {
    let fn: (() => void) | null = null;
    const setTimer = ((f: () => void) => {
      fn = f;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    const cleared: number[] = [];
    const clearTimer = ((t: number) => cleared.push(t)) as typeof clearTimeout;
    const e = engine({ autoLeaveMs: 60_000, setTimer, clearTimer });
    await e.play({ trackIds: [mkTrack("a")], userId: "op" });

    e.notifyPopulation(0); // everyone left → arm
    expect(typeof fn).toBe("function");
    e.notifyPopulation(2); // someone rejoined → cancel
    expect(cleared).toEqual([1]);

    e.notifyPopulation(0); // arm again, then fire
    fn!();
    await new Promise((r) => setTimeout(r, 0));
    expect(voice.isConnected()).toBe(false);
  });
});

describe("async channel resolution (REST fallback, D8)", () => {
  test("play awaits an async resolver and joins the resolved channel", async () => {
    const asyncResolver: VoiceStateResolver = {
      channelOf: async (uid) => (uid === "op" ? "chan-async" : null),
    };
    const e = new PlaybackEngine({ db, voice, resolver: asyncResolver, targetLufs: -16 });
    await e.play({ trackIds: [mkTrack("a")], userId: "op" });
    expect(voice.channel).toBe("chan-async");
  });

  test("409 when the async resolver finds no channel", async () => {
    const asyncResolver: VoiceStateResolver = { channelOf: async () => null };
    const e = new PlaybackEngine({ db, voice, resolver: asyncResolver, targetLufs: -16 });
    await expect(e.play({ trackIds: [mkTrack("a")], userId: "ghost" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("serialization (B9)", () => {
  test("interleaved commands resolve to a consistent state", async () => {
    const e = engine();
    const [a, b, c] = [mkTrack("a"), mkTrack("b"), mkTrack("c")];
    await Promise.all([
      e.play({ trackIds: [a, b, c], userId: "op" }),
      e.next(),
      e.pause(),
      e.resume(),
    ]);
    const np = e.nowPlaying();
    expect(np.connected).toBe(true);
    expect(["playing", "paused"]).toContain(np.status);
    expect(np.queueLength).toBe(3);
  });
});
