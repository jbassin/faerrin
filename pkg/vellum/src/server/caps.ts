import type { ThemeMode } from "../render/index.ts";

/**
 * SEC-4 resource caps. The render endpoint is public and unauthenticated, takes
 * arbitrary author markdown, and drives a shared headless Chromium — so every
 * input is bounded here, before anything reaches the browser.
 */
export const RENDER_LIMITS = {
  /** Max source size (bytes). Bounds parse + DOM cost. */
  maxSourceBytes: 64 * 1024,
  minScale: 1,
  /** R-16: user-controllable scale is capped (amplification vector otherwise). */
  maxScale: 4,
  defaultScale: 2,
  /** Hard ceiling on rasterized pixels (scale² × viewport) — OOM guard. */
  maxPixelArea: 8000 * 8000,
  /** Per-render Chromium timeout (ms). */
  renderTimeoutMs: 15_000,
} as const;

export interface RenderRequest {
  source: string;
  mode: ThemeMode;
  scale: number;
}

export type Validation =
  | { ok: true; value: RenderRequest }
  | { ok: false; status: number; error: string };

const MODES: readonly ThemeMode[] = ["mechanical", "diegetic"];

/** Validate + normalize an untrusted render request body. Pure. */
export function validateRenderRequest(body: unknown): Validation {
  if (typeof body !== "object" || body === null) {
    return { ok: false, status: 400, error: "body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;

  if (typeof record.source !== "string") {
    return { ok: false, status: 400, error: "source must be a string" };
  }
  const byteLength = new TextEncoder().encode(record.source).length;
  if (byteLength > RENDER_LIMITS.maxSourceBytes) {
    return {
      ok: false,
      status: 413,
      error: `source exceeds ${RENDER_LIMITS.maxSourceBytes} bytes`,
    };
  }

  let mode: ThemeMode = "mechanical";
  if (record.mode !== undefined) {
    if (
      typeof record.mode !== "string" ||
      !MODES.includes(record.mode as ThemeMode)
    ) {
      return { ok: false, status: 400, error: "mode must be mechanical|diegetic" };
    }
    mode = record.mode as ThemeMode;
  }

  let scale: number = RENDER_LIMITS.defaultScale;
  if (record.scale !== undefined) {
    if (typeof record.scale !== "number" || !Number.isFinite(record.scale)) {
      return { ok: false, status: 400, error: "scale must be a number" };
    }
    if (
      record.scale < RENDER_LIMITS.minScale ||
      record.scale > RENDER_LIMITS.maxScale
    ) {
      return {
        ok: false,
        status: 422,
        error: `scale must be ${RENDER_LIMITS.minScale}–${RENDER_LIMITS.maxScale}`,
      };
    }
    scale = record.scale;
  }

  return { ok: true, value: { source: record.source, mode, scale } };
}
