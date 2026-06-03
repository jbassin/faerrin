import { useMemo } from "react";
import type { Layer } from "@/lib/regions";
import {
  dotIndices,
  slotInk,
  slotOpacity,
  visibleEntries,
} from "@/lib/timeline";
import { useTypewriter } from "./useTypewriter";
import styles from "./TimelineStrip.module.css";

interface TimelineStripProps {
  layers: Layer[];
  index: number; // 0 .. layers.length
  isPlaying: boolean;
  dwellMs: number;
  onIndexChange: (next: number) => void;
}

export default function TimelineStrip({
  layers,
  index,
  isPlaying,
  dwellMs,
  onIndexChange,
}: TimelineStripProps) {
  const total = layers.length;
  const atStart = index <= 0;
  const atEnd = index >= total;
  const arrowsLocked = isPlaying;

  const entries = useMemo(() => visibleEntries(layers, index), [layers, index]);
  const dots = useMemo(() => dotIndices(total + 1, index), [total, index]);

  const topEntry = entries[0] ?? null;
  const topMessage = topEntry?.message ?? "";
  const topKey = topEntry?.key ?? "";

  const typedChars = useTypewriter({
    text: topMessage,
    key: topKey,
    active: topEntry?.kind === "layer",
    dwellMs,
  });

  const stillTyping =
    topEntry?.kind === "layer" && typedChars < topMessage.length;
  const cursorVisible =
    topEntry?.kind === "null" || stillTyping || (isPlaying && !atEnd);

  return (
    <div className={styles.strip} role="group" aria-label="Vox-log timeline">
      <div className={styles.headerRibbon}>
        <span className={styles.headerHair} aria-hidden="true" />
        <span className={styles.headerTitle}>++ VOX-LOG OF THE STRIDER ++</span>
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

      <div className={styles.log}>
        {entries.map((entry, slot) => {
          const display =
            entry === topEntry && entry.kind === "layer"
              ? entry.message.slice(0, typedChars)
              : entry.message;
          const showCursor = slot === 0 && cursorVisible;
          return (
            <div
              key={entry.key}
              className={styles.entry}
              data-slot={slot}
              style={{
                transform: `translateY(${slot * 1.35}rem)`,
                opacity: slotOpacity(slot),
                color: slotInk(slot),
              }}
            >
              <span className={styles.lead}>+</span>
              <span className={styles.date}>{entry.date}</span>
              <span className={styles.sep}>+</span>
              <span className={styles.message}>
                {display}
                {showCursor && <span className={styles.cursor}>+</span>}
              </span>
            </div>
          );
        })}
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.arrow}
          onClick={() => onIndexChange(index - 1)}
          disabled={arrowsLocked || atStart}
          aria-label="Previous layer"
        >
          ◀
        </button>

        <span className={styles.dots} aria-hidden="true">
          {dots.map((d, i) =>
            d.kind === "ellipsis" ? (
              <span key={`e-${i}`} className={styles.ellipsis}>
                …
              </span>
            ) : (
              <span
                key={d.idx}
                className={
                  d.idx === index
                    ? styles.glyphActive
                    : d.idx < index
                      ? styles.glyphPast
                      : styles.glyphFuture
                }
              >
                {d.idx === index ? "◈" : d.idx < index ? "✠" : "·"}
              </span>
            ),
          )}
          <span className={styles.count}>
            {index}/{total}
          </span>
        </span>

        <button
          type="button"
          className={styles.arrow}
          onClick={() => onIndexChange(index + 1)}
          disabled={arrowsLocked || atEnd}
          aria-label="Next layer"
        >
          ▶
        </button>
      </div>
    </div>
  );
}
