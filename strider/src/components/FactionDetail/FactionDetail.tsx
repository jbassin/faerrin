import type { Faction } from "@/lib/factions";
import FactionSymbol from "@/components/FactionSymbol/FactionSymbol";
import styles from "./FactionDetail.module.css";

interface FactionDetailProps {
  faction: Faction;
}

export default function FactionDetail({ faction }: FactionDetailProps) {
  return (
    <div
      className={styles.root}
      style={{ "--faction-color": faction.color } as React.CSSProperties}
    >
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.orderId}>
            {"+ BERTH "}
            {String(faction.order).padStart(2, "0")}
            {" +"}
          </span>
          <h2 className={styles.name}>{faction.name.toUpperCase()}</h2>
        </div>
        <div className={styles.symbol}>
          <FactionSymbol faction={faction} size={64} />
        </div>
      </div>

      <div className={styles.divider} />

      {faction.description && (
        <section className={styles.section}>
          <h3 className={styles.sectionLabel}>{"++ DOSSIER ++"}</h3>
          <div
            className={styles.description}
            dangerouslySetInnerHTML={{ __html: faction.description }}
          />
        </section>
      )}

      {faction.members.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionLabel}>{"++ KNOWN PERSONNEL ++"}</h3>
          {faction.members.map((member) => (
            <div key={member.name} className={styles.member}>
              <h4 className={styles.memberName}>
                <span className={styles.memberGlyph} aria-hidden="true">
                  +{" "}
                </span>
                {member.name.toUpperCase()}
              </h4>
              <div
                className={styles.memberBio}
                dangerouslySetInnerHTML={{ __html: member.bio }}
              />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
