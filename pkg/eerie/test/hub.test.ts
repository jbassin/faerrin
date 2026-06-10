import { expect, test } from "bun:test";
import { RollHub } from "../src/hub";
import type { RollEvent } from "../src/schema";

const evt: RollEvent = {
  v: 1,
  user: "Kethra",
  expression: "1d20+7",
  total: 27,
  dice: [20],
  modifier: 7,
  isCrit: true,
  isFumble: false,
  ts: "2026-06-09T21:48:01Z",
};

test("fans a published event out to every subscriber as a data frame", () => {
  const hub = new RollHub();
  const a: string[] = [];
  const b: string[] = [];
  hub.add((f) => a.push(f));
  hub.add((f) => b.push(f));

  hub.publish(evt);

  expect(hub.clientCount).toBe(2);
  expect(a).toHaveLength(1);
  expect(b).toHaveLength(1);
  expect(a[0]).toStartWith("data: ");
  expect(a[0]).toEndWith("\n\n");
  expect(JSON.parse(a[0]!.slice("data: ".length))).toMatchObject({
    user: "Kethra",
    total: 27,
    isCrit: true,
  });
});

test("unsubscribe removes the client and stops delivery", () => {
  const hub = new RollHub();
  const got: string[] = [];
  const off = hub.add((f) => got.push(f));
  expect(hub.clientCount).toBe(1);

  off();
  expect(hub.clientCount).toBe(0);

  hub.publish(evt);
  expect(got).toHaveLength(0);
});

test("heartbeat sends a comment frame to all clients", () => {
  const hub = new RollHub();
  const got: string[] = [];
  hub.add((f) => got.push(f));

  hub.heartbeat();

  expect(got).toEqual([": ping\n\n"]);
});
