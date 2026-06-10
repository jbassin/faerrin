import type { TickerRoll } from "./ticker";

/** One ticker row. `fresh` triggers the enter animation for the newest roll. */
export function RollRow({ roll, fresh }: { roll: TickerRoll; fresh: boolean }) {
  const tone = roll.isCrit ? "crit" : roll.isFumble ? "fumble" : "normal";
  const classes = ["eerie-row", `eerie-row--${tone}`];
  if (fresh) classes.push("eerie-row--fresh");

  return (
    <li className={classes.join(" ")}>
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
