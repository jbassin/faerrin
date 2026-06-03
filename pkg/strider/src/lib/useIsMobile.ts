import { useCallback, useSyncExternalStore } from "react";

export function useIsMobile(breakpoint = 768): boolean {
  const query = `(max-width: ${breakpoint - 1}px)`;

  const subscribe = useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    [query],
  );

  const getSnapshot = useCallback(
    () => window.matchMedia(query).matches,
    [query],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
