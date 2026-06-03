import { useRef } from "react";
import type { Faction } from "@/lib/factions";
import FactionDetail from "@/components/FactionDetail/FactionDetail";
import { useFocusTrap } from "@/lib/useFocusTrap";
import styles from "./Modal.module.css";

interface ModalProps {
  faction: Faction | null;
  onClose: () => void;
}

export default function Modal({ faction, onClose }: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusTrap(cardRef, faction !== null, onClose);

  if (!faction) return null;

  return (
    <div
      className={styles.backdrop}
      data-testid="modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={cardRef}
        className={styles.card}
        style={{ "--faction-color": faction.color } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${faction.name} details`}
        tabIndex={-1}
      >
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
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
        <FactionDetail faction={faction} />
      </div>
    </div>
  );
}
