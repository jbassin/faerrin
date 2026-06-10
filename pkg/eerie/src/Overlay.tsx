import { useEffect, useRef, useState } from "react";
import { connectFeed } from "./feed";
import { RollRow } from "./RollRow";
import { pushRoll, type TickerRoll } from "./ticker";
import type { RollEvent } from "./schema";

/** How many recent rolls stay on screen. */
const MAX_ROWS = 6;

export function Overlay() {
  const [rolls, setRolls] = useState<TickerRoll[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    return connectFeed({
      onRoll: (event: RollEvent) => {
        seq.current += 1;
        const row: TickerRoll = { ...event, id: `${event.ts}-${seq.current}` };
        setRolls((prev) => pushRoll(prev, row, MAX_ROWS));
      },
    });
  }, []);

  return (
    <div className="eerie-overlay">
      <ol className="eerie-ticker">
        {rolls.map((roll, i) => (
          <RollRow key={roll.id} roll={roll} fresh={i === 0} />
        ))}
      </ol>
    </div>
  );
}
