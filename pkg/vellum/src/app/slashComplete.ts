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
      ':::statblock[Name]{level="Creature 1" traits=""}\nDescription.\n\n## Actions\nStrike :action[1] — a weapon.\n:::\n',
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
      ':::spell[Name]{rank="Spell 1" traits=""}\n**Cast** :action[2]\nThe effect.\n:::\n',
  },
  {
    label: "/handout",
    detail: "in-world handout",
    insert:
      ':::handout[Title]\nBody text. Hide secrets with :redact[like this].\n:::\n',
  },
  {
    label: "/edict",
    detail: "proclamation",
    insert: ":::edict[Proclamation]\nBy order of the authority…\n:::\n",
  },
  { label: "/action", detail: "action glyph", insert: ":action[2]" },
  { label: "/trait", detail: "trait pill", insert: ":trait[fire]" },
  { label: "/redact", detail: "redaction bar", insert: ":redact[secret]" },
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
