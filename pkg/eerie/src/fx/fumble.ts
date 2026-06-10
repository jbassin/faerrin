import type { Application } from "pixi.js";
import { emitBurst } from "./particles";

// Seal-wax red and ash — a heavier, faster-falling shatter than a crit.
export function playFumble(app: Application, x: number, y: number): void {
  emitBurst(app, {
    x,
    y,
    count: 18,
    colors: [0x7c2a22, 0x3a434f, 0x5c4a30],
    speed: 240,
    spread: 0.8,
    gravity: 900,
    lifetimeMs: 750,
    radius: 3,
  });
}
