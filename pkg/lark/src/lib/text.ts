/**
 * Tag + slug normalization (plan B16). Pure helpers so `Calm` and `calm`
 * collapse to one tag and collections get stable URL-safe slugs.
 */

/** Normalize a tag name: trim, collapse inner whitespace, lowercase. */
export function normalizeTag(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

/** URL/identity slug from arbitrary text: lowercase, non-alphanumerics → '-'. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Disambiguate a slug against existing ones by appending -2, -3, … */
export function uniqueSlug(base: string, exists: (slug: string) => boolean): string {
  const root = base || "untitled";
  if (!exists(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`;
    if (!exists(candidate)) return candidate;
  }
}
