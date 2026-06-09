import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";

/** R-13: `/` snippets that scaffold the field order nobody memorizes. */
interface Snippet {
  label: string;
  detail: string;
  insert: string;
}

// Block + column snippets emit VSS (one recommended structural surface): the
// author never counts colons, and brace nesting computes fence depth. Canonical
// `:::` still parses — it's just no longer the snippet default (MARKDOWN.md §5).
const SNIPPETS: Snippet[] = [
  {
    label: "/statblock",
    detail: "creature / NPC",
    insert:
      '@statblock "Name"\n| level: Creature 1\n| traits: \n{\nDescription.\n\n## Actions\nStrike @1 — a weapon.\n}\n',
  },
  {
    label: "/hazard",
    detail: "trap / hazard",
    insert:
      '@hazard "Name"\n| level: Hazard 1\n| traits: \n{\n**Stealth** +0\nThe trigger and effect.\n}\n',
  },
  {
    label: "/item",
    detail: "item",
    insert:
      '@item "Name"\n| level: Item 1\n| traits: \n{\n**Price** 1 gp\nWhat it is and does.\n}\n',
  },
  {
    label: "/spell",
    detail: "spell",
    insert:
      '@spell "Name"\n| level: 1\n| traits: \n{\n**Cast** @2\nThe effect.\n}\n',
  },
  {
    label: "/handout",
    detail: "in-world handout",
    insert: '@handout "Title"\n{\nBody text. Hide secrets with ||like this||.\n}\n',
  },
  {
    label: "/edict",
    detail: "proclamation",
    insert: '@edict "Proclamation"\n{\nBy order of the authority…\n}\n',
  },
  {
    label: "/columns",
    detail: "side-by-side layout (one { … } per column)",
    // `@columns [ {…} {…} ]` — each `{ }` is a column; VSS computes the fence
    // depth, so multiple cards per column just work (MARKDOWN.md §5).
    insert: "@columns [\n  {\n  }\n  {\n  }\n]\n",
  },
  { label: "/action", detail: "action glyph (@2)", insert: "@2" },
  { label: "/trait", detail: "trait pill (#fire)", insert: "#fire" },
  { label: "/redact", detail: "redaction bar (||…||)", insert: "||secret||" },
];

function slashSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/\/\w*/);
  if (!word) return null;
  if (word.from === word.to && !context.explicit) return null;
  return {
    from: word.from,
    options: SNIPPETS.map((snippet) => ({
      label: snippet.label,
      detail: snippet.detail,
      apply: snippet.insert,
    })),
  };
}

export const slashComplete = autocompletion({ override: [slashSource] });
