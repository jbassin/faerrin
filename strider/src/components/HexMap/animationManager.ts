// Scene-local lifecycle manager for short-lived overlay animations.
//
// Each Animation has its own duration; `tick(now)` advances every entry,
// calls `update(easedT)` once per frame, and runs `cleanup()` exactly once
// when the animation hits t >= 1 (or is cleared explicitly).
//
// No DOM, no Pixi dependency — pure tick loop, so this could be unit-tested
// in isolation if needed.

export interface Animation {
  startAt: number;
  durationMs: number;
  update: (t: number) => void;
  cleanup: () => void;
}

export class AnimationManager {
  private active: Animation[] = [];

  start(anim: Animation): void {
    this.active.push(anim);
  }

  tick(now: number): void {
    if (this.active.length === 0) return;
    const survivors: Animation[] = [];
    for (const anim of this.active) {
      const elapsed = now - anim.startAt;
      if (elapsed < 0) {
        survivors.push(anim);
        continue;
      }
      const t =
        anim.durationMs <= 0 ? 1 : Math.min(1, elapsed / anim.durationMs);
      anim.update(t);
      if (t >= 1) {
        anim.cleanup();
      } else {
        survivors.push(anim);
      }
    }
    this.active = survivors;
  }

  clear(): void {
    for (const anim of this.active) {
      try {
        anim.cleanup();
      } catch {
        // ignore — scene teardown
      }
    }
    this.active = [];
  }
}
