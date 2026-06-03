import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Repo root is derived from this file's location (scripts/lib/paths.ts),
// so the pipeline works regardless of where the repo is checked out.
// This replaces the previously hardcoded "/emerald/..." absolute paths.
const here = dirname(fileURLToPath(import.meta.url))

export const repoRoot = resolve(here, "..", "..")
export const scriptsDir = resolve(repoRoot, "scripts")
export const dataDir = resolve(scriptsDir, "data")
export const scriptOutDir = resolve(scriptsDir, "script")
// Wiki content is the monorepo SSOT, hosted in the sibling shared-content package.
export const contentDir = resolve(repoRoot, "..", "shared-content", "wiki")
export const scriptContentDir = resolve(contentDir, "Script")

export const defsPath = resolve(scriptsDir, "defs.yaml")
export const campaignsPath = resolve(scriptsDir, "campaigns.yaml")
export const shibbolethJsonPath = resolve(scriptsDir, "shibboleth.json")
