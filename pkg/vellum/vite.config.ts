import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const dir = fileURLToPath(new URL(".", import.meta.url));

// Single-route SPA (AD-5: no TanStack SSR). Two HTML entries:
//   index.html  — the editor app
//   render.html — the bare render surface the M3 render service screenshots
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(dir, "index.html"),
        render: resolve(dir, "render.html"),
      },
    },
  },
});
