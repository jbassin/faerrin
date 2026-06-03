import { createContext, useContext } from "react";
import type { Application, Container } from "pixi.js";

export interface PixiCtx {
  app: Application;
  panel: Container;
  world: Container;
}

export const PixiContext = createContext<PixiCtx | null>(null);

export function usePixi(): PixiCtx | null {
  return useContext(PixiContext);
}
