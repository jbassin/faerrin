import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The web UI is a React SPA. `vite build` emits dist/, which the Bun server
// (server.ts) serves. In dev, /api and /auth are proxied to the local Bun
// server so same-origin cookies/EventSource work.
const apiTarget = process.env.LARK_SERVER_PORT
  ? `http://localhost:${process.env.LARK_SERVER_PORT}`
  : "http://localhost:8788";

export default defineConfig({
  root: resolve(import.meta.dirname, "src/web"),
  build: { outDir: resolve(import.meta.dirname, "dist"), emptyOutDir: true },
  plugins: [react()],
  server: {
    port: 3001,
    host: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/auth": { target: apiTarget, changeOrigin: true },
    },
  },
});
