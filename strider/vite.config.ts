import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { readdirSync } from "node:fs";
import path from "node:path";
import { contentWatchPlugin } from "./scripts/contentWatchPlugin";

const factionSlugs = readdirSync(path.resolve(__dirname, "content/factions"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.replace(/^\d+-/, "").replace(/\.md$/, ""));

const isProduction = process.env.NODE_ENV === "production";

export default defineConfig({
  server: { port: 3000, host: true },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  plugins: [
    contentWatchPlugin(),
    tanstackStart({
      prerender: {
        enabled: true,
        autoSubfolderIndex: false,
        crawlLinks: false,
        failOnError: true,
      },
      pages: [
        { path: "/" },
        ...factionSlugs.map((slug) => ({ path: `/factions/${slug}` })),
      ],
      router: {
        routeFileIgnorePattern: isProduction ? "editor\\.tsx$" : undefined,
      },
    }),
    viteReact(),
  ],
});
