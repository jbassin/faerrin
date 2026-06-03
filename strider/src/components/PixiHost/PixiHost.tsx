import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Application } from "pixi.js";
import { useRouterState } from "@tanstack/react-router";
import { PixiContext, type PixiCtx } from "./pixiContext";
import styles from "./PixiHost.module.css";

interface Props {
  children: ReactNode;
}

export default function PixiHost({ children }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ctx, setCtx] = useState<PixiCtx | null>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // The /editor route owns its own Pixi Application; running the shader
  // background app at the same time means two live WebGL contexts.
  const isEditor = pathname.startsWith("/editor");

  useEffect(() => {
    if (isEditor) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let app: Application | null = null;
    let bgDestroy: (() => void) | null = null;
    let bgTick: (() => void) | null = null;

    (async () => {
      const [{ Application: PixiApp, Container: PixiContainer }, balatroMod] =
        await Promise.all([import("pixi.js"), import("./balatroBackground")]);

      const a = new PixiApp();
      await a.init({
        canvas,
        resizeTo: window,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
        preference: "webgl",
      });
      if (cancelled) {
        a.destroy(true, { children: true, texture: true });
        return;
      }
      app = a;

      const bg = balatroMod.createBalatroBackground(a);
      bg.mesh.label = "background";
      a.stage.addChild(bg.mesh);

      const start = performance.now();
      bgTick = () => bg.update(performance.now() - start);
      a.ticker.add(bgTick);
      bgDestroy = bg.destroy;

      // Stage children, back to front: background (shader) → panel (translucent
      // panel-bg drawn on top of the shader so the .frame's chrome appears
      // opaque) → world (map hexes, drawn ABOVE the panel-bg so the map isn't
      // dimmed by it). All in a single GL context.
      const panel = new PixiContainer();
      panel.label = "panel";
      a.stage.addChild(panel);

      const world = new PixiContainer();
      world.label = "world";
      a.stage.addChild(world);

      setCtx({ app: a, panel, world });
    })();

    return () => {
      cancelled = true;
      if (app) {
        if (bgTick) app.ticker.remove(bgTick);
        bgDestroy?.();
        app.destroy(true, { children: true, texture: true });
      }
      setCtx(null);
    };
  }, [isEditor]);

  return (
    <PixiContext.Provider value={ctx}>
      {!isEditor && (
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      )}
      {children}
    </PixiContext.Provider>
  );
}
