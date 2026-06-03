import type { HostConfig } from "../types.ts";

/**
 * Default hosts. Override per run via generateScript({ hosts }). Changing these
 * changes the (otherwise static) system prompt, so keep one config per show to
 * preserve prompt caching across sessions.
 *
 * Three voices on purpose: a roundtable needs an odd number to break ties and
 * keep the conversation from settling into call-and-response. Reed pushes the
 * action, Quill grounds it, Charlotte pokes holes in both.
 */
export const DEFAULT_HOSTS: HostConfig = {
  A: {
    name: "Reed",
    persona:
      "warm and enthusiastic; drives the play-by-play with genuine delight and keeps the energy up",
  },
  B: {
    name: "Quill",
    persona:
      "dry, thoughtful, a little bookish; the lorekeeper who grounds events in the setting, surfaces context, and asks the questions a listener would",
  },
  C: {
    name: "Charlotte",
    persona:
      "quick, opinionated, and emotionally invested; the instigator who fixates on the characters' choices, relationships, and stakes, plays devil's advocate, and needles the others to defend their takes",
  },
};
