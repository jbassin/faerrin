import { createRoot } from "react-dom/client";
import { parseDocument, DocumentView, type ThemeMode } from "../render/index.ts";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@faerrin/gothic/index.css";
import "./render.css";

/**
 * Render-only entry. The render service (Playwright) loads this page and calls
 * `window.vellumRender(source, mode)`, then screenshots [data-vellum-export].
 * It uses the SAME renderer library as the editor preview, so the PNG matches
 * what the author sees (R-15).
 */
declare global {
  interface Window {
    vellumRender: (source: string, mode: string) => Promise<void>;
  }
}

const host = document.getElementById("render-root");
if (!host) throw new Error("vellum render: missing #render-root");
const root = createRoot(host);

function normalizeMode(mode: string): ThemeMode {
  return mode === "diegetic" ? "diegetic" : "mechanical";
}

window.vellumRender = (source, mode) =>
  new Promise<void>((resolve) => {
    const document_ = parseDocument(source, { mode: normalizeMode(mode) });
    root.render(<DocumentView document={document_} />);
    // Wait for layout + webfonts so the screenshot is deterministic (R-17).
    requestAnimationFrame(() => {
      void document.fonts.ready.then(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
