import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import path from "node:path";

// Local-first review app — runs in TanStack Start **SSR** mode (no prerender,
// unlike strider) so server functions (`createServerFn`) can read pkg/content,
// write the provenance sidecar, and shell out to `jj`. NOT Caddy-served.
export default defineConfig({
  server: { port: 3001, host: true },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  plugins: [tanstackStart(), viteReact()],
});
