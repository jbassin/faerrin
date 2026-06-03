import { Container, Graphics } from "pixi.js";
import type { Application } from "pixi.js";

export const HEX_SIZE = 2;
const SQRT3 = Math.sqrt(3);
const HEX_HEIGHT = (SQRT3 / 2) * HEX_SIZE;

export const WORLD_VIEWBOX = { width: 224, height: 256 };

export function hexVertsAtPixel(px: number, py: number): number[] {
  return [
    px + HEX_SIZE,
    py,
    px + HEX_SIZE / 2,
    py + HEX_HEIGHT,
    px - HEX_SIZE / 2,
    py + HEX_HEIGHT,
    px - HEX_SIZE,
    py,
    px - HEX_SIZE / 2,
    py - HEX_HEIGHT,
    px + HEX_SIZE / 2,
    py - HEX_HEIGHT,
  ];
}

export function drawEdgesPath(
  g: Graphics,
  edges: ReadonlyArray<readonly [number, number, number, number]>,
): void {
  for (const [x1, y1, x2, y2] of edges) {
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
  }
}

export function dashedLinePath(
  g: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dash: number,
  gap: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  const period = dash + gap;
  for (let t = 0; t < len; t += period) {
    const tEnd = Math.min(t + dash, len);
    g.moveTo(x1 + ux * t, y1 + uy * t);
    g.lineTo(x1 + ux * tEnd, y1 + uy * tEnd);
  }
}

export interface WorldHandle {
  world: Container;
  fit: (width: number, height: number) => void;
}

export function attachWorld(app: Application): WorldHandle {
  const world = new Container();
  world.label = "world";
  app.stage.addChild(world);
  function fit(width: number, height: number) {
    const scale = Math.min(
      width / WORLD_VIEWBOX.width,
      height / WORLD_VIEWBOX.height,
    );
    world.scale.set(scale);
    world.position.set(width / 2, height / 2);
  }
  fit(app.renderer.width, app.renderer.height);
  return { world, fit };
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
