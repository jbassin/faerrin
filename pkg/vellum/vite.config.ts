import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Single-route SPA (AD-5: no TanStack SSR — the editor and export are
// inherently client-only). The render service (M3) is a separate process.
export default defineConfig({
  plugins: [react()],
});
