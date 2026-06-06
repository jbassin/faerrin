import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import path from "node:path";

// Local-first review app — runs in TanStack Start **SSR** mode (no prerender,
// unlike strider) so server functions (`createServerFn`) can read pkg/content,
// write the provenance sidecar, and shell out to `jj`. NOT Caddy-served.
export default defineConfig({
  // Bind loopback only — this is a single-user local tool whose server functions
  // read pkg/content and the state dir; do not expose them on the LAN.
  server: { port: 3001 },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  plugins: [tanstackStart(), viteReact()],
});
