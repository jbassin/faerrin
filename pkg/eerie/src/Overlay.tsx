import { useEffect, useRef, useState } from "react";
import { connectFeed } from "./feed";
import { RollRow } from "./RollRow";
import { pushRoll, type TickerRoll } from "./ticker";
import type { FxStage } from "./fx/stage";
import type { RollEvent } from "./schema";

/** Safety cap on simultaneously-visible rolls (they also auto-expire below). */
const MAX_ROWS = 6;
/** How long a roll stays on screen before it fades out and is removed. */
const ROLL_TTL_MS = 12_000;

export function Overlay() {
  const [rolls, setRolls] = useState<TickerRoll[]>([]);
  const seq = useRef(0);
  const fxMount = useRef<HTMLDivElement>(null);
  const fxStage = useRef<FxStage | null>(null);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

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

  // Subscribe to the roll feed; update the ticker, fire fx, and schedule expiry.
  useEffect(() => {
    const pending = timers.current;
    const disconnect = connectFeed({
      onRoll: (event: RollEvent) => {
        seq.current += 1;
        const id = `${event.ts}-${seq.current}`;
        const row: TickerRoll = { ...event, id };
        setRolls((prev) => pushRoll(prev, row, MAX_ROWS));
        if (event.isCrit) fxStage.current?.play("crit");
        else if (event.isFumble) fxStage.current?.play("fumble");

        const timer = setTimeout(() => {
          setRolls((prev) => prev.filter((r) => r.id !== id));
          pending.delete(timer);
        }, ROLL_TTL_MS);
        pending.add(timer);
      },
    });
    return () => {
      disconnect();
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return (
    <div className="eerie-overlay">
      <div className="eerie-fx" ref={fxMount} />
      <ol className="eerie-ticker">
        {rolls.map((roll) => (
          <RollRow key={roll.id} roll={roll} ttlMs={ROLL_TTL_MS} />
        ))}
      </ol>
    </div>
  );
}
