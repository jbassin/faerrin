import { Application } from "pixi.js";
import { playCrit } from "./crit";
import { playFumble } from "./fumble";

/**
 * Owns a transparent pixi.js canvas overlaid on the page. Mounted lazily (pixi is
 * a big dependency, so it's dynamically imported by Overlay) and torn down cleanly.
 */
export class FxStage {
  #app: Application | null = null;
  readonly #mount: HTMLElement;

  constructor(mount: HTMLElement) {
    this.#mount = mount;
  }

  async init(): Promise<void> {
    const app = new Application();
    await app.init({
      backgroundAlpha: 0,
      resizeTo: window,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });

    const { canvas } = app;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    this.#mount.appendChild(canvas);

    this.#app = app;
  }

  /** Fire the effect near the ticker (bottom-left of the canvas). */
  play(kind: "crit" | "fumble"): void {
    const app = this.#app;
    if (!app) return;
    const x = 120;
    const y = window.innerHeight - 90;
    if (kind === "crit") playCrit(app, x, y);
    else playFumble(app, x, y);
  }

  destroy(): void {
    if (!this.#app) return;
    this.#app.destroy(true, { children: true });
    this.#app = null;
  }
}
