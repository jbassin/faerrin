import { defineCollection, z } from "astro:content"
import { glob } from "astro/loaders"

// Content lives in ../content (shared with vendored Quartz until cutover). We give
// the loader the raw relative path (with .md) as the ID to keep IDs unique and
// prevent Astro's default `/index` stripping + lowercasing; the Quartz-faithful
// URL slug is derived from `entry.filePath` in the routes via slugifyFilePath.
//
// Frontmatter schema (the contract from docs/refactor-plan.md §4): the observed
// keys are title/tags/aliases/img and NOTHING else; 21 files have no frontmatter,
// and tags/aliases appear as either a string or a list. So: everything optional,
// lenient coercion to arrays, and `.passthrough()` so an unforeseen key never
// fails the build.
const toArray = (v: unknown): string[] =>
  v == null ? [] : (Array.isArray(v) ? v : [v]).map(String)

const strList = z
  .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
  .optional()
  .transform(toArray)

const docs = defineCollection({
  loader: glob({
    pattern: "**/*.md",
    base: "../shared-content/wiki",
    generateId: ({ entry }) => entry,
  }),
  schema: z
    .object({
      title: z
        .union([z.string(), z.number()])
        .optional()
        .transform((v) => (v == null ? undefined : String(v))),
      tags: strList,
      aliases: strList,
      img: z.string().optional(),
    })
    .passthrough(),
})

export const collections = { docs }
