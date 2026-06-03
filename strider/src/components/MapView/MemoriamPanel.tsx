import FactionSymbol from "@/components/FactionSymbol/FactionSymbol";
import type { Faction } from "@/lib/factions";
import type { FallenEntry } from "@/lib/memoriam";
import { imperialDate } from "@/lib/timeline";
import styles from "./MemoriamPanel.module.css";

interface MemoriamPanelProps {
  entries: FallenEntry[];
  onFactionClick: (faction: Faction) => void;
}

export default function MemoriamPanel({
  entries,
  onFactionClick,
}: MemoriamPanelProps) {
  return (
    <section className={styles.strip} aria-label="Fallen factions">
      <span className={styles.cornerTL} aria-hidden="true">
        +
      </span>
      <span className={styles.cornerTR} aria-hidden="true">
        +
      </span>
      <span className={styles.cornerBL} aria-hidden="true">
        +
      </span>
      <span className={styles.cornerBR} aria-hidden="true">
        +
      </span>

      <header className={styles.headerRibbon}>
        <span className={styles.headerHair} aria-hidden="true" />
        <h2 className={styles.headerTitle}>‡ FALLEN STANDARDS ‡</h2>
        <span className={styles.headerHair} aria-hidden="true" />
      </header>

      {entries.length === 0 ? (
        <p className={styles.emptyState}>++ no fallen standards ++</p>
      ) : (
        <ul className={styles.list}>
          {entries.map(({ faction, fallTimestamp }, i) => (
            <li key={faction.slug}>
              <button
                type="button"
                className={styles.entry}
                style={
                  {
                    "--faction-color": faction.color,
                    "--entry-i": i,
                  } as React.CSSProperties
                }
                onClick={() => onFactionClick(faction)}
              >
                <span className={styles.tab} aria-hidden="true" />
                <span className={styles.symbol}>
                  <FactionSymbol faction={faction} size={28} />
                </span>
                <span className={styles.dagger} aria-hidden="true">
                  †
                </span>
                <span className={styles.name}>
                  {faction.name.toUpperCase()}
                </span>
                <span className={styles.rule} aria-hidden="true" />
                <time className={styles.fallDate} dateTime={fallTimestamp}>
                  {imperialDate(fallTimestamp)}
                </time>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
