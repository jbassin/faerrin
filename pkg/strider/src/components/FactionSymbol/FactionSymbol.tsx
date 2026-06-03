import type { Faction } from "@/lib/factions";
import styles from "./FactionSymbol.module.css";

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

interface FactionSymbolProps {
  faction: Faction;
  size: number;
}

export default function FactionSymbol({ faction, size }: FactionSymbolProps) {
  if (faction.symbol) {
    return (
      <img
        className={styles.symbol}
        src={`/${faction.symbol}`}
        alt={`${faction.name} symbol`}
        width={size}
        height={size}
      />
    );
  }
  return (
    <div
      className={styles.placeholder}
      style={
        {
          width: size,
          height: size,
          background: faction.color,
          fontSize: `${Math.max(8, Math.round(size * 0.36))}px`,
        } as React.CSSProperties
      }
      aria-label={`${faction.name} symbol placeholder`}
    >
      {initials(faction.name)}
    </div>
  );
}
