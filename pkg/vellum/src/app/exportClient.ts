/// <reference types="vite/client" />
import type { ThemeMode } from "../render/index.ts";

const RENDER_URL =
  (import.meta.env.VITE_VELLUM_RENDER_URL as string | undefined) ??
  "http://localhost:5252";

/** POST the document to the render service and get back a PNG blob. */
export async function requestPng(
  source: string,
  mode: ThemeMode,
  scale = 2,
): Promise<Blob> {
  const res = await fetch(`${RENDER_URL}/render`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, mode, scale }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `render failed (${res.status})`);
  }
  return res.blob();
}
