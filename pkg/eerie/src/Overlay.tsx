import { useEffect, useRef, useState } from "react";
import { connectFeed } from "./feed";
import { RollRow } from "./RollRow";
import { pushRoll, type TickerRoll } from "./ticker";
import type { FxStage } from "./fx/stage";
import type { RollEvent } from "./schema";

/** How many recent rolls stay on screen. */
const MAX_ROWS = 6;

export function Overlay() {
  const [rolls, setRolls] = useState<TickerRoll[]>([]);
  const seq = useRef(0);
  const fxMount = useRef<HTMLDivElement>(null);
  const fxStage = useRef<FxStage | null>(null);

  // Lazily spin up the pixi fx canvas (keeps pixi out of the main bundle).
  useEffect(() => {
    let stage: FxStage | null = null;
    let cancelled = false;
    void (async () => {
      const { FxStage } = await import("./fx/stage");
      if (cancelled || !fxMount.current) return;
      stage = new FxStage(fxMount.current);
      await stage.init();
      if (cancelled) {
        stage.destroy();
        return;
      }
      fxStage.current = stage;
    })();
    return () => {
      cancelled = true;
      stage?.destroy();
      fxStage.current = null;
    };
  }, []);

  // Subscribe to the roll feed; update the ticker and fire fx on crit/fumble.
  useEffect(() => {
    return connectFeed({
      onRoll: (event: RollEvent) => {
        seq.current += 1;
        const row: TickerRoll = { ...event, id: `${event.ts}-${seq.current}` };
        setRolls((prev) => pushRoll(prev, row, MAX_ROWS));
        if (event.isCrit) fxStage.current?.play("crit");
        else if (event.isFumble) fxStage.current?.play("fumble");
      },
    });
  }, []);

  return (
    <div className="eerie-overlay">
      <div className="eerie-fx" ref={fxMount} />
      <ol className="eerie-ticker">
        {rolls.map((roll, i) => (
          <RollRow key={roll.id} roll={roll} fresh={i === 0} />
        ))}
      </ol>
    </div>
  );
}
