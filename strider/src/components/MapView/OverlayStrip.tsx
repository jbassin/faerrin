import type { CSSProperties } from "react";
import type { OverlayId, OverlaySpec } from "@/lib/overlays";
import styles from "./OverlayStrip.module.css";

interface OverlayStripProps {
  overlays: readonly OverlaySpec[];
  visible: Set<OverlayId>;
  onToggle: (id: OverlayId) => void;
}

export default function OverlayStrip({
  overlays,
  visible,
  onToggle,
}: OverlayStripProps) {
  return (
    <div className={styles.strip} role="group" aria-label="Map overlays">
      <div className={styles.headerRibbon}>
        <span className={styles.headerHair} aria-hidden="true" />
        <span className={styles.headerTitle}>++ AUSPEX CHANNELS ++</span>
        <span className={styles.headerHair} aria-hidden="true" />
      </div>

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

      <div className={styles.chips}>
        {overlays.map((overlay, idx) => {
          const isActive = visible.has(overlay.id);
          return (
            <button
              key={overlay.id}
              type="button"
              className={`${styles.chip} ${isActive ? styles.chipActive : ""}`}
              aria-pressed={isActive}
              onClick={() => onToggle(overlay.id)}
              style={{ "--i": idx } as CSSProperties}
            >
              <span className={styles.glyph} aria-hidden="true">
                {isActive ? "⬢" : "⬡"}
              </span>
              <span className={styles.label}>{overlay.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
