// Standalone route-tree regeneration. The Vite TanStack Start plugin
// regenerates `src/routeTree.gen.ts` during dev and build — but a production
// build strips `editor.tsx` via `routeFileIgnorePattern`, which then breaks
// `bun run typecheck` because the route file's `createFileRoute("/editor")`
// can no longer find "/editor" in the typed route map.
//
// This script writes a route tree that ALWAYS includes editor (i.e. matches
// dev). Run it before typecheck.

import { Generator, getConfig } from "@tanstack/router-generator";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const config = getConfig(
  {
    routesDirectory: path.join(ROOT, "src", "routes"),
    generatedRouteTree: path.join(ROOT, "src", "routeTree.gen.ts"),
  },
  ROOT,
);

const generator = new Generator({ config, root: ROOT });
await generator.run();
