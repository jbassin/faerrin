import { useEntitiesObserved } from "./entitiesObserved";
import styles from "./SiteHeader.module.css";

const FALLBACK_COUNT = 19;

export default function SiteHeader() {
  const count = useEntitiesObserved();
  const displayCount = count ?? FALLBACK_COUNT;
  const label = displayCount === 1 ? "ENTITY" : "ENTITIES";

  return (
    <header className={styles.root}>
      <span className={styles.brand}>
        <span className={styles.markGlyph} aria-hidden="true">
          +
        </span>
        <span className={styles.brandName}>STRIDER</span>
        <span className={styles.dot} aria-hidden="true">
          ·
        </span>
        <span className={styles.brandSub}>FACTIONS</span>
        <span className={styles.markGlyph} aria-hidden="true">
          +
        </span>
      </span>
      <span className={styles.meta} aria-live="polite">
        {`++ ${displayCount} ${label} OBSERVED ++`}
      </span>
    </header>
  );
}
