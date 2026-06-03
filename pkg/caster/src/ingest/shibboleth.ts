import type {
  ResolvedSpeaker,
  Shibboleth,
  SpeakerIndex,
} from "../types.ts";
import { slugify } from "./slug.ts";

export const GAMEMASTER_LABEL = "Gamemaster";

/**
 * Invert the shibboleth roster into an arc-scoped speaker lookup.
 *
 * Source shape : arcTitle -> { isMain, roles: player -> [{ name, desc }] }
 * Result shape : arcSlug  -> ( characterName -> { player, role, desc } )
 *
 * Role is "gm" when the character label is exactly "Gamemaster" (which arc the
 * GM belongs to varies — e.g. arc 106's GM is a different player), else "player".
 *
 * Lookups are arc-scoped on purpose: the same character name ("Archie") maps to
 * different players in different arcs, so a global table would collide.
 */
export function buildSpeakerIndex(shibboleth: Shibboleth): SpeakerIndex {
  const index: SpeakerIndex = new Map();

  for (const [arcTitle, arc] of Object.entries(shibboleth)) {
    const arcSlug = slugify(arcTitle);
    const byCharacter = new Map<string, ResolvedSpeaker>();

    for (const [player, characters] of Object.entries(arc.roles)) {
      for (const character of characters) {
        const role = character.name === GAMEMASTER_LABEL ? "gm" : "player";
        byCharacter.set(character.name, {
          player,
          role,
          desc: character.desc,
        });
      }
    }

    index.set(arcSlug, byCharacter);
  }

  return index;
}

/** Map of arcSlug -> arc prose title, for annotating sessions. */
export function buildArcTitles(shibboleth: Shibboleth): Map<string, string> {
  const titles = new Map<string, string>();
  for (const arcTitle of Object.keys(shibboleth)) {
    titles.set(slugify(arcTitle), arcTitle);
  }
  return titles;
}

/** Set of arcSlugs flagged isMain in the shibboleth. */
export function buildMainArcs(shibboleth: Shibboleth): Set<string> {
  const main = new Set<string>();
  for (const [arcTitle, arc] of Object.entries(shibboleth)) {
    if (arc.isMain) main.add(slugify(arcTitle));
  }
  return main;
}

/** Load and parse content/shibboleth.json. */
export async function loadShibboleth(path: string): Promise<Shibboleth> {
  return (await Bun.file(path).json()) as Shibboleth;
}
