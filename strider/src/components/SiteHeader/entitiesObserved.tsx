import { createContext, useContext, useState, type ReactNode } from "react";

// Split into two contexts so the publisher (MapView) gets a stable setter
// reference and only the consumer (SiteHeader) re-renders when count changes.
const ValueContext = createContext<number | null>(null);
const SetterContext = createContext<((count: number | null) => void) | null>(
  null,
);

export function EntitiesObservedProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [count, setCount] = useState<number | null>(null);
  return (
    <SetterContext.Provider value={setCount}>
      <ValueContext.Provider value={count}>{children}</ValueContext.Provider>
    </SetterContext.Provider>
  );
}

export function useEntitiesObserved(): number | null {
  return useContext(ValueContext);
}

export function useSetEntitiesObserved(): (count: number | null) => void {
  const setter = useContext(SetterContext);
  return setter ?? (() => {});
}
