import { useEffect, useState, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

// Defers rendering of `children` until after mount. Used to keep DOM-dependent
// libraries (PixiJS) out of the SSR pass — replaces Next's
// `dynamic(..., { ssr: false })`.
export default function ClientOnly({ children, fallback = null }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <>{mounted ? children : fallback}</>;
}
