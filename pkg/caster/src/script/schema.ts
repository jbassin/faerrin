import type { ToolSpec } from "@faerrin/llm";

export const SCRIPT_TOOL_NAME = "record_script";

export const scriptTool: ToolSpec = {
  name: SCRIPT_TOOL_NAME,
  description:
    "Record the finished three-host podcast script as an episode title plus an " +
    "ordered list of spoken turns shared across the three hosts (a roundtable, not " +
    "a fixed rotation). Call this exactly once with the full script.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: {
        type: "string",
        description:
          "A short, evocative title for THIS episode that the hosts could announce. " +
          "Give the episode's own title ONLY — do NOT prefix or suffix it with the " +
          "campaign/arc name or the session date; those are stored and displayed " +
          "separately. Good: \"The Canary in the Ballroom\". Bad: \"Through a Song, " +
          "Darkly — The Canary in the Ballroom\".",
      },
      turns: {
        type: "array",
        description:
          "The dialogue in spoken order. Each turn is one host speaking. Write " +
          "natural, conversational lines — not narration or stage directions. The " +
          "three hosts should genuinely share the floor, unevenly and overlapping; " +
          "avoid a fixed A-B-C rotation. Vary turn length hard (long riffs next to " +
          "one-word reactions); most lines are plain talk, not a punchline per turn.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            speaker: {
              type: "string",
              enum: ["A", "B", "C"],
              description:
                "A = Host A (the Recapper), B = Host B (the Lorekeeper), " +
                "C = Host C (the Instigator).",
            },
            text: {
              type: "string",
              description:
                "What this host says, as it should be spoken aloud. Punctuate for prosody: " +
                "an ellipsis for a trailing-off or hesitation, an em-dash for an abrupt cut, " +
                "ALL-CAPS on a word for emphasis. You may embed inline ElevenLabs v3 audio " +
                "tags in square brackets to direct delivery — these are a non-exhaustive " +
                "guide, infer similar ones: direction ([happy], [excited], [annoyed], " +
                "[thoughtful], [whisper], [deadpan]), non-verbal ([laughing], [chuckles], " +
                "[sighs], [exhales sharply], [inhales deeply], [clears throat], [short pause], " +
                "[long pause]), and overlap/turn-timing ([jumping in], [overlapping], " +
                "[interrupts]). Place a tag right where the delivery shifts; use them " +
                "sparingly. Everything outside the brackets must be plain speakable words.",
            },
          },
          required: ["speaker", "text"],
        },
      },
    },
    required: ["title", "turns"],
  },
};
