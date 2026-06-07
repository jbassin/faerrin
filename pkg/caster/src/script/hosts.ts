import type { HostConfig } from "../types.ts";

/**
 * Default hosts. Override per run via generateScript({ hosts }). Changing these
 * changes the (otherwise static) system prompt, so keep one config per show to
 * preserve prompt caching across sessions.
 *
 * Three voices on purpose: a roundtable needs an odd number to break ties and
 * keep the conversation from settling into call-and-response. Bram relives it,
 * Maeve keeps it honest to the world, Pip won't let anyone off easy.
 */
export const DEFAULT_HOSTS: HostConfig = {
  A: {
    name: "Bram",
    persona:
      "warm and boisterous; the storyteller who relives the session's best moments with relish, leans into the bravado and the big swings, and can't wait to get to the good part — driving the recap forward and happily embellishing",
  },
  B: {
    name: "Maeve",
    persona:
      "warm, unhurried, and quietly sharp; the long-time regular whose knowledge of the setting is lived rather than studied — she remembers every name, debt, and old grudge, grounds events in how the world actually works, and gently reins Bram in when he embellishes",
  },
  C: {
    name: "Pip",
    persona:
      "quick, fond, and incorrigible; the needler who cares more about why the characters did the thing than what they did — second-guesses the table's heroics, pokes at sentiment with a wink, and goads the others into defending their takes",
  },
};
