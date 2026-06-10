import type { Application } from "pixi.js";
import { emitBurst } from "./particles";

// Phosphor-teal celebration with an amber spark — the gothic accent palette.
export function playCrit(app: Application, x: number, y: number): void {
  emitBurst(app, {
    x,
    y,
    count: 30,
    colors: [0x6dd5c0, 0xa6ffe9, 0xf0b46e],
    speed: 420,
    spread: 0.6,
    gravity: 680,
    lifetimeMs: 900,
    radius: 3,
  });
}
