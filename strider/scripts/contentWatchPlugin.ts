import type { Plugin, ViteDevServer } from "vite";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SCRIPT = path.join(HERE, "build-content.ts");
const CONTENT_DIR = path.join(ROOT, "content");
const GENERATED_DIR = path.join(ROOT, "src", "generated");

function rebuild(): void {
  const result = spawnSync("bun", ["run", SCRIPT], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error("[content-watch] build-content.ts failed");
  }
}

function isContentMarkdown(file: string): boolean {
  return file.startsWith(CONTENT_DIR + path.sep) && file.endsWith(".md");
}

export function contentWatchPlugin(): Plugin {
  return {
    name: "strider:content-watch",
    buildStart() {
      // Ensures src/generated/*.ts exist before any module resolves them.
      rebuild();
    },
    configureServer(server: ViteDevServer) {
      server.watcher.add(CONTENT_DIR);

      const onChange = (file: string) => {
        if (!isContentMarkdown(file)) return;
        rebuild();
        // Invalidate generated modules so the next HMR cycle picks up new data.
        for (const name of ["factions.ts", "layers.ts"]) {
          const mod = server.moduleGraph.getModuleById(
            path.join(GENERATED_DIR, name),
          );
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
        server.ws.send({ type: "full-reload" });
      };

      server.watcher.on("change", onChange);
      server.watcher.on("add", onChange);
      server.watcher.on("unlink", onChange);
    },
  };
}
