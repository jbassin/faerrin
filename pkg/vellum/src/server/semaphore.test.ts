import { describe, expect, test } from "bun:test";
import { Semaphore } from "./semaphore.ts";

describe("Semaphore", () => {
  test("limits concurrency and queues the rest (SEC-5)", async () => {
    const gate = new Semaphore(2);
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];

    const task = (id: number) =>
      gate.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        order.push(id);
        active -= 1;
      });

    await Promise.all([1, 2, 3, 4, 5].map(task));

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(order).toHaveLength(5);
  });

  test("releases permits so later work still runs", async () => {
    const gate = new Semaphore(1);
    const a = await gate.acquire();
    let ran = false;
    const pending = gate.run(async () => {
      ran = true;
    });
    expect(ran).toBe(false); // blocked behind the held permit
    a(); // release
    await pending;
    expect(ran).toBe(true);
  });
});
