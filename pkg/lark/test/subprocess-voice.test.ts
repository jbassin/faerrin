import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SubprocessBot } from "../src/bot/subprocess-voice";

// A fake "voice daemon" that speaks the same stdio protocol but needs no Discord
// or network — exercises the Bun-side framing (id correlation + events).
const FAKE_DAEMON = `
const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
send({ event: "ready" });
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.cmd === "resolveChannel") send({ id: m.id, ok: true, channelId: "chan-x" });
    else if (m.cmd === "position") send({ id: m.id, ok: true, positionMs: 42 });
    else if (m.cmd === "boom") send({ id: m.id, ok: false, error: "kaboom" });
    else send({ id: m.id, ok: true });
  }
});
`;

let dir: string;
let daemonPath: string;
let bot: SubprocessBot;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lark-daemon-"));
  daemonPath = join(dir, "fake-daemon.mjs");
  writeFileSync(daemonPath, FAKE_DAEMON);
  bot = new SubprocessBot("node", daemonPath, process.env);
});
afterEach(async () => {
  await bot.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("SubprocessBot stdio protocol", () => {
  test("resolves ready from the daemon's ready event", async () => {
    await expect(bot.ready).resolves.toBeUndefined();
  });

  test("correlates a request to its response by id", async () => {
    await bot.ready;
    expect(await bot.resolver.channelOf("u1")).toBe("chan-x");
  });

  test("join marks connected + currentChannelId", async () => {
    await bot.ready;
    expect(bot.isConnected()).toBe(false);
    await bot.join("c9");
    expect(bot.isConnected()).toBe(true);
    expect(bot.currentChannelId()).toBe("c9");
    bot.leave();
    expect(bot.isConnected()).toBe(false);
  });

  test("a failed command rejects with the daemon's error", async () => {
    await bot.ready;
    // @ts-expect-error reach the private request via a known failing cmd path
    await expect(bot.request("boom")).rejects.toThrow(/kaboom/);
  });
});

describe("SubprocessBot daemon exit", () => {
  test("ready rejects if the daemon exits before signalling ready", async () => {
    const d = join(dir, "dies.mjs");
    writeFileSync(d, "process.exit(3);");
    const dead = new SubprocessBot("node", d, process.env);
    await expect(dead.ready).rejects.toThrow(/exited/);
    await dead.close();
  });
});
