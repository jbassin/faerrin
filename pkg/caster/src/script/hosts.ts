import type { HostConfig } from "../types.ts";

/**
 * Default hosts. Override per run via generateScript({ hosts }). Changing these
 * changes the (otherwise static) system prompt, so keep one config per show to
 * preserve prompt caching across sessions.
 *
 * Three voices on purpose: a roundtable needs an odd number to break ties and
 * keep the conversation from settling into call-and-response. Bram relives it,
 * Maeve keeps it honest to the world, Pip won't let anyone off easy.
 *
 * The personas describe how each host TALKS and how each one FAILS, not just
 * their attitude — the three are deliberately unequal at language so no single
 * line could have come from one omniscient writer. Bram is fluent but
 * imprecise, Maeve is precise but terse, Pip is fast but scattered. That
 * asymmetry is the point; don't smooth it into three equally articulate voices.
 */
export const DEFAULT_HOSTS: HostConfig = {
  A: {
    name: "Bram",
    persona:
      "warm, boisterous, fluent but imprecise; the storyteller who relives the best moments with relish and happily embellishes. Talks in long, rolling run-on sentences that pile clause on clause; makes big sweeping claims he then has to walk back; reliably gets a name, number, or detail wrong and gets corrected (usually by Maeve); now and then runs clean out of sentence and lands on a shrug like \"you... you had to be there.\" Drives the recap forward and overshoots",
  },
  B: {
    name: "Maeve",
    persona:
      "warm, unhurried, precise but terse; the long-time regular whose knowledge of the setting is lived rather than studied. Speaks the least and lands the exact word, name, or date the others fumble for; her power is the deadpan beat and the flat one-line correction, NOT the paragraph — she finishes her sentences and finishes them short. The only one reliably right, so let her be plainly wrong exactly once so she isn't an oracle. Grounds events in how the world actually works and reins Bram in when he embellishes",
  },
  C: {
    name: "Pip",
    persona:
      "quick, fond, incorrigible, fast but scattered; the needler who cares more about WHY the characters did the thing than what they did. Talks in fragments and questions, interrupts himself, free-associates sideways into tangents that go nowhere and deflate, and rarely sticks the landing on a thought; right about people, wrong about facts, and won't fully admit either. Second-guesses the table's heroics, pokes at sentiment with a wink, and goads the others into defending their takes — without waiting for his own point to finish",
  },
};
