import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The overlay is a single-route SPA. `vite build` emits dist/, which the Bun
// server (server.ts) serves to OBS as a Browser Source. In dev, the SSE feed
// is proxied to the local Bun server so the same-origin EventSource URL works.
const feedTarget = process.env.EERIE_SERVER_PORT
  ? `http://localhost:${process.env.EERIE_SERVER_PORT}`
  : "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      "/feed": { target: feedTarget, changeOrigin: true },
      "/api": { target: feedTarget, changeOrigin: true },
    },
  },
});
