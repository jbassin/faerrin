import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import path from "node:path";

// Local-first review app — runs in TanStack Start **SSR** mode (no prerender,
// unlike strider) so server functions (`createServerFn`) can read pkg/content,
// write the provenance sidecar, and shell out to `jj`. NOT Caddy-served.
export default defineConfig({
  // host:true (0.0.0.0) is intentional — the worldbuilder reviews from another device
  // on his LAN. Safe because (a) every file-reading server fn is path-contained via
  // within()/arc-date validation (no traversal), and (b) it's never exposed publicly.
  // Do not "re-fix" this to loopback; see the security note in CLAUDE.md.
  server: { port: 3001, host: true },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  plugins: [tanstackStart(), viteReact()],
});
