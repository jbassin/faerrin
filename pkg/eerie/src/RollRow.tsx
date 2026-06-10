import type { TickerRoll } from "./ticker";

/**
 * One ticker row. The `eerie-life` CSS animation runs for the whole `ttlMs`:
 * fade/slide in, hold, then fade out — kept in sync with Overlay's removal timer.
 */
export function RollRow({ roll, ttlMs }: { roll: TickerRoll; ttlMs: number }) {
  const tone = roll.isCrit ? "crit" : roll.isFumble ? "fumble" : "normal";

  return (
    <li
      className={`eerie-row eerie-row--${tone}`}
      style={{ animationDuration: `${ttlMs}ms` }}
    >
      <span className="eerie-row__user">{roll.user}</span>
      {roll.expression && <span className="eerie-row__expr">{roll.expression}</span>}
      {roll.dice && roll.dice.length > 0 && (
        <span className="eerie-row__dice">{roll.dice.join(" · ")}</span>
      )}
      <span className="eerie-row__total">{roll.total}</span>
      {tone !== "normal" && (
        <span className="eerie-row__badge">{roll.isCrit ? "CRIT" : "FUMBLE"}</span>
      )}
    </li>
  );
}
