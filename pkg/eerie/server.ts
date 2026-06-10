import { resolve } from "node:path";
import { startServer } from "./src/server";

// Entry point: read env, serve the built overlay + ingest + SSE.
//   PORT         — listen port (default 8787)
//   EERIE_TOKEN  — shared secret required on POST /api/v1/roll (X-Eerie-Token)
const port = Number(process.env.PORT ?? 8787);
const token = process.env.EERIE_TOKEN?.trim() || null;
const distDir = resolve(import.meta.dir, "dist");

if (!token) {
  console.warn(
    "⚠️  EERIE_TOKEN is unset — POST /api/v1/roll is UNAUTHENTICATED. " +
      "Set EERIE_TOKEN in pkg/eerie/.env before exposing the ingest endpoint.",
  );
}

const { server } = startServer({ port, token, distDir });
console.log(`eerie listening on http://localhost:${server.port}`);
