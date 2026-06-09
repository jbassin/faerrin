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

const SNIPPETS: Snippet[] = [
  {
    label: "/statblock",
    detail: "creature / NPC",
    insert:
      ':::statblock[Name]{level="Creature 1" traits=""}\nDescription.\n\n## Actions\nStrike @1 — a weapon.\n:::\n',
  },
  {
    label: "/hazard",
    detail: "trap / hazard",
    insert:
      ':::hazard[Name]{level="Hazard 1" traits=""}\n**Stealth** +0\nThe trigger and effect.\n:::\n',
  },
  {
    label: "/item",
    detail: "item",
    insert:
      ':::item[Name]{level="Item 1" traits=""}\n**Price** 1 gp\nWhat it is and does.\n:::\n',
  },
  {
    label: "/spell",
    detail: "spell",
    insert:
      ':::spell[Name]{level="1" traits=""}\n**Cast** @2\nThe effect.\n:::\n',
  },
  {
    label: "/handout",
    detail: "in-world handout",
    insert:
      ':::handout[Title]\nBody text. Hide secrets with ||like this||.\n:::\n',
  },
  {
    label: "/edict",
    detail: "proclamation",
    insert: ":::edict[Proclamation]\nBy order of the authority…\n:::\n",
  },
  {
    label: "/columns",
    detail: "side-by-side layout (--- splits columns)",
    // `::::columns` out-colons the blocks inside; `---` separates columns so
    // multiple blocks per column work without more colons (MARKDOWN.md §4.1).
    insert:
      "::::columns\nLeft column.\n\n---\n\nRight column.\n::::\n",
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
