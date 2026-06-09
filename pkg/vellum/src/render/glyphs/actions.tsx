import type { ReactElement } from "react";

/** PF2e action-economy costs. Purely visual — no rules meaning attached. */
export type ActionCost = "1" | "2" | "3" | "reaction" | "free";

const ALIASES: Record<string, ActionCost> = {
  "1": "1",
  one: "1",
  single: "1",
  "2": "2",
  two: "2",
  double: "2",
  "3": "3",
  three: "3",
  triple: "3",
  r: "reaction",
  reaction: "reaction",
  react: "reaction",
  "0": "free",
  f: "free",
  free: "free",
};

/** Normalize an author token (`:action[2]`, `:action[reaction]`) to a cost, or null. */
export function normalizeActionCost(raw: string): ActionCost | null {
  return ALIASES[raw.trim().toLowerCase()] ?? null;
}

const LABELS: Record<ActionCost, string> = {
  "1": "one action",
  "2": "two actions",
  "3": "three actions",
  reaction: "reaction",
  free: "free action",
};

/** A single filled "action pip" chevron. */
function Pip({ x }: { x: number }): ReactElement {
  return <path d={`M${x} 3 L${x + 7} 8 L${x} 13 Z`} />;
}

/**
 * Inline SVG action glyph (NOT an icon font — AD-7: icon fonts blank out in
 * rasterized PNG export). `fill: currentColor` so theme CSS controls color.
 */
export function ActionGlyph({ cost }: { cost: ActionCost }): ReactElement {
  const label = LABELS[cost];
  const common = {
    role: "img" as const,
    "aria-label": label,
    height: "1em",
    fill: "currentColor",
    style: { verticalAlign: "-0.12em" as const },
  };

  if (cost === "reaction") {
    return (
      <svg {...common} viewBox="0 0 16 16" width="1em">
        <path d="M3 8 a5 5 0 1 1 5 5 H6 l2 2 -4 -1 1 -4 v2 a3 3 0 1 0 -3 -3 Z" />
      </svg>
    );
  }
  if (cost === "free") {
    return (
      <svg {...common} viewBox="0 0 16 16" width="1em">
        <path
          d="M8 2 L13 8 L8 14 L3 8 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    );
  }

  const count = Number(cost);
  const width = count * 9 + 1;
  return (
    <svg {...common} viewBox={`0 0 ${width} 16`} width={`${width / 16}em`}>
      {Array.from({ length: count }, (_, i) => (
        <Pip key={i} x={i * 9 + 1} />
      ))}
    </svg>
  );
}
