// The tool the model is forced to call. Its input schema *is* the SessionDigest
// shape (minus sessionId, which we attach ourselves — the model shouldn't echo it).
//
// Note on JSON Schema limits for structured/tool output: numeric and string
// length constraints (minItems, minLength, etc.) are not enforced by the API, so
// we keep the schema to types + descriptions and validate in parseDigest().

import type { ToolSpec } from "../llm/client.ts";

export const DISTILL_TOOL_NAME = "record_session_digest";

export const distillTool: ToolSpec = {
  name: DISTILL_TOOL_NAME,
  description:
    "Record the distilled, in-world story of this play session as an ordered list " +
    "of beats, plus a short synopsis and samples of the out-of-character table talk " +
    "you discarded. Call this exactly once with the full result.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      synopsis: {
        type: "string",
        description:
          "One or two sentences framing what happened in this session, in-world.",
      },
      beats: {
        type: "array",
        description:
          "The session's in-world events in narrative order. Exclude out-of-character " +
          "table talk (scheduling, technical issues, off-topic banter, rules lookups).",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            order: {
              type: "integer",
              description: "1-based position of this beat in the session.",
            },
            summary: {
              type: "string",
              description: "What happened in this beat, in-world.",
            },
            significance: {
              type: "string",
              description:
                "Why this beat MATTERED: the stakes, tension, or consequences — what " +
                "was at risk, what it changed, why the table leaned in. Give the recap " +
                "hosts something to react to and weigh, not just a fact to restate.",
            },
            details: {
              type: "array",
              items: { type: "string" },
              description:
                "Concrete, vivid texture worth talking about: a clutch or catastrophic " +
                "dice roll, a bold or disastrous decision, a striking image, an emotional " +
                "turn, a memorable in-character line. Short fragments, grounded in what " +
                "actually happened — do not invent color the transcript doesn't support.",
            },
            tone: {
              type: "string",
              description:
                "The emotional register of the beat in a word or two (e.g. \"tense\", " +
                "\"triumphant\", \"grim\", \"comedic\", \"bittersweet\").",
            },
            characters: {
              type: "array",
              items: { type: "string" },
              description:
                "In-world character names involved (as they appear in the transcript).",
            },
            locations: {
              type: "array",
              items: { type: "string" },
              description: "Locations involved in this beat.",
            },
            wikiRefs: {
              type: "array",
              items: { type: "string" },
              description:
                "Proper nouns (factions, places, people, concepts) a setting wiki " +
                "would likely have an entry for, for later grounding.",
            },
          },
          required: [
            "order",
            "summary",
            "significance",
            "details",
            "tone",
            "characters",
            "locations",
            "wikiRefs",
          ],
        },
      },
      discarded: {
        type: "array",
        items: { type: "string" },
        description:
          "A few short verbatim samples of the out-of-character table talk you " +
          "filtered out, so a human can sanity-check the filtering.",
      },
    },
    required: ["synopsis", "beats", "discarded"],
  },
};
