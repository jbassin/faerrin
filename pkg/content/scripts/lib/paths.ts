import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Paths are derived from this file's location (content/scripts/lib/paths.ts),
// so the pipeline works regardless of where the monorepo is checked out.
const here = dirname(fileURLToPath(import.meta.url))

export const sharedRoot = resolve(here, "..", "..") // pkg/content
export const scriptsDir = resolve(sharedRoot, "scripts")
export const dataDir = resolve(scriptsDir, "data")
export const scriptOutDir = resolve(scriptsDir, "script")
// Wiki content is the monorepo SSOT, hosted here in content.
export const contentDir = resolve(sharedRoot, "wiki")
export const scriptContentDir = resolve(contentDir, "Script")

export const defsPath = resolve(scriptsDir, "defs.yaml")
export const campaignsPath = resolve(scriptsDir, "campaigns.yaml")
export const shibbolethJsonPath = resolve(scriptsDir, "shibboleth.json")
