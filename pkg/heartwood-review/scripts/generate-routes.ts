// Standalone route-tree regeneration (mirrors strider's). The Vite TanStack
// Start plugin regenerates `src/routeTree.gen.ts` during dev and build, but
// `bun run typecheck` runs without the plugin — so generate the tree first.

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
