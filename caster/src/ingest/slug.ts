/**
 * Slugify an arc prose title to match transcript filename slugs.
 *
 * Rule (see docs §1.3): lowercase, drop apostrophes/commas (and any other
 * punctuation), collapse runs of non-alphanumeric characters to a single
 * hyphen, trim leading/trailing hyphens.
 *
 *   "Observatory, Slipped"     -> "observatory-slipped"
 *   "Through a Song, Darkly"   -> "through-a-song-darkly"
 *   "A Hunt of Metal and Vine" -> "a-hunt-of-metal-and-vine"
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, "") // drop apostrophes without inserting a separator
    .replace(/[^a-z0-9]+/g, "-") // any other run (commas, spaces, etc.) -> hyphen
    .replace(/^-+|-+$/g, "");
}
