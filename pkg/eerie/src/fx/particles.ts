import { Container, Graphics } from "pixi.js";
import type { Application, Ticker } from "pixi.js";

export interface BurstOptions {
  /** origin in CSS pixels. */
  x: number;
  y: number;
  count: number;
  /** cycled per particle. */
  colors: number[];
  /** initial speed (px/s). */
  speed: number;
  /** 0..1 — how much speed varies between particles. */
  spread: number;
  /** downward acceleration (px/s²). */
  gravity: number;
  lifetimeMs: number;
  radius: number;
}

interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
}

/**
 * Spawn a one-shot particle burst. Everything lives in a single Container that is
 * destroyed (with its children) when the burst ends, and the ticker callback is
 * removed — so repeated bursts over a long stream don't leak.
 */
export function emitBurst(app: Application, opts: BurstOptions): void {
  const container = new Container();
  app.stage.addChild(container);

  const particles: Particle[] = [];
  for (let i = 0; i < opts.count; i += 1) {
    const color = opts.colors[i % opts.colors.length] ?? 0xffffff;
    const g = new Graphics().circle(0, 0, opts.radius * (0.5 + Math.random())).fill({ color });
    g.x = opts.x;
    g.y = opts.y;
    container.addChild(g);

    const angle = Math.random() * Math.PI * 2;
    const v = opts.speed * (1 - opts.spread * Math.random());
    // bias slightly upward so the burst arcs before gravity pulls it down
    particles.push({ g, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v - opts.speed * 0.4 });
  }

  let elapsed = 0;
  const tick = (ticker: Ticker) => {
    const dt = ticker.deltaMS / 1000;
    elapsed += ticker.deltaMS;
    const life = Math.min(1, elapsed / opts.lifetimeMs);

    for (const p of particles) {
      p.vy += opts.gravity * dt;
      p.g.x += p.vx * dt;
      p.g.y += p.vy * dt;
      p.g.alpha = 1 - life;
      p.g.scale.set(1 - 0.4 * life);
    }

    if (elapsed >= opts.lifetimeMs) {
      app.ticker.remove(tick);
      container.destroy({ children: true });
    }
  };

  app.ticker.add(tick);
}
