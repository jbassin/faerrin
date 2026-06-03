import type { Script, ScriptTurn } from "../types.ts";

/**
 * Render a readable Markdown transcript from a script. Delivery is shown the way
 * it's sent to ElevenLabs v3 — as inline audio tags in the text. A legacy
 * one-word `emotion` is promoted to a leading "[tag]" so older scripts read the
 * same way.
 */
export function renderTranscript(script: Script): string {
  const nameOf = (s: ScriptTurn["speaker"]) => script.hosts[s].name;

  const lines: string[] = [
    `# ${script.title}`,
    "",
    `*Hosts: ${script.hosts.A.name} (the Recapper) · ${script.hosts.B.name} (the Lorekeeper) · ${script.hosts.C.name} (the Instigator)*`,
    "",
  ];

  for (const turn of script.turns) {
    const text = turn.emotion ? `[${turn.emotion}] ${turn.text}` : turn.text;
    lines.push(`**${nameOf(turn.speaker)}:** ${text}`, "");
  }

  return lines.join("\n");
}
