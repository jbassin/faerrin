import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const dir = fileURLToPath(new URL(".", import.meta.url));

// Local render sidecar (`bun run render:server`); overridable for non-default ports.
const renderTarget = process.env.VELLUM_RENDER_PORT
  ? `http://localhost:${process.env.VELLUM_RENDER_PORT}`
  : "http://localhost:5252";

// Single-route SPA (AD-5: no TanStack SSR). Two HTML entries:
//   index.html  — the editor app
//   render.html — the bare render surface the M3 render service screenshots
export default defineConfig({
  plugins: [react()],
  // Mirror the production Caddy topology in dev: the editor posts same-origin
  // /render (and /health), and the dev server proxies those to the local
  // sidecar — so the default same-origin render URL works in dev too, no env
  // var needed (see src/app/exportClient.ts, deploy/Caddyfile.example).
  server: {
    proxy: {
      "/render": { target: renderTarget, changeOrigin: true },
      "/health": { target: renderTarget, changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(dir, "index.html"),
        render: resolve(dir, "render.html"),
      },
    },
  },
});
