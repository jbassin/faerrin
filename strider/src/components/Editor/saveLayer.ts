import {
  layerFilename,
  serializeLayer,
  slugify,
  type EditableChange,
} from "@/lib/editorHelpers";

const WRITER_PORT = 3001;

// Resolves the writer host from wherever the page itself was served — so
// accessing the dev server at http://192.168.0.x:3000 routes the POST to
// http://192.168.0.x:3001 (where the sidecar is bound to 0.0.0.0).
function writerUrl(): string {
  const host =
    typeof window !== "undefined" ? window.location.hostname : "localhost";
  return `http://${host}:${WRITER_PORT}/write-layer`;
}

interface SaveArgs {
  draftChange: EditableChange;
  logMessage: string;
  timestamp: string;
}

export async function saveLayer({
  draftChange,
  logMessage,
  timestamp,
}: SaveArgs): Promise<void> {
  const fileSlug =
    draftChange.op === "skein-connect"
      ? slugify(logMessage) || `${draftChange.from}-${draftChange.to}`
      : draftChange.op === "claim"
        ? slugify(logMessage) ||
          `claim-${draftChange.faction ?? "none"}-${draftChange.hexes.length}`
        : draftChange.op === "update"
          ? slugify(logMessage) || draftChange.slug
          : draftChange.slug;
  const filename = layerFilename(timestamp, fileSlug);
  const content = serializeLayer({
    timestamp,
    message: logMessage,
    changes: [draftChange],
  });

  let res: Response;
  try {
    res = await fetch(writerUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, content }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    throw new Error(
      `${msg} — is the sidecar running? \`bun run editor:server\``,
    );
  }

  const body = (await res.json()) as {
    ok: boolean;
    error?: string;
    path?: string;
  };
  if (!res.ok || !body.ok) {
    throw new Error(body.error ?? `writer returned HTTP ${res.status}`);
  }
}
