import { useCallback, useRef, useState } from "react";
import type { ThemeMode } from "../render/index.ts";
import { requestPng } from "./exportClient.ts";

export type ExportStatus =
  | { state: "idle" }
  | { state: "exporting" }
  | { state: "done" }
  | { state: "error"; message: string };

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** R-15a: copy the PNG to the clipboard (best-effort; download already ran). */
async function copyToClipboard(blob: Blob): Promise<void> {
  try {
    if (
      typeof ClipboardItem !== "undefined" &&
      navigator.clipboard?.write
    ) {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
    }
  } catch {
    /* clipboard blocked (focus/permission) — the download still happened */
  }
}

function explain(err: unknown): string {
  // A failed fetch (service down) surfaces as a TypeError (R-21 / R-23).
  if (err instanceof TypeError) {
    return "Render service unreachable — start it with `bun run render:server`.";
  }
  return err instanceof Error ? err.message : "Export failed.";
}

/**
 * Drives PNG export with explicit states (R-21). Serializes its own calls so a
 * mashed button can't fire concurrent exports.
 */
export function useExport(): {
  status: ExportStatus;
  exportPng: (source: string, mode: ThemeMode) => Promise<void>;
} {
  const [status, setStatus] = useState<ExportStatus>({ state: "idle" });
  const busy = useRef(false);

  const exportPng = useCallback(async (source: string, mode: ThemeMode) => {
    if (busy.current) return;
    busy.current = true;
    setStatus({ state: "exporting" });
    try {
      const blob = await requestPng(source, mode);
      downloadBlob(blob, "vellum.png");
      await copyToClipboard(blob);
      setStatus({ state: "done" });
    } catch (err) {
      setStatus({ state: "error", message: explain(err) });
    } finally {
      busy.current = false;
    }
  }, []);

  return { status, exportPng };
}
