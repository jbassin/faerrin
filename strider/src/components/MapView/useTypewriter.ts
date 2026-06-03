import { useEffect, useRef, useState } from "react";

interface Args {
  text: string;
  key: string;
  active: boolean;
  dwellMs: number;
}

// Types `text` out character-by-character whenever `key` changes (and `active`
// is true). Returns the number of characters currently visible. When inactive
// the text is shown in full immediately.
export function useTypewriter({ text, key, active, dwellMs }: Args): number {
  const [typedChars, setTypedChars] = useState(text.length);
  const printedKeyRef = useRef<string | null>(key || null);

  useEffect(() => {
    if (printedKeyRef.current === key) return;
    if (!active) {
      printedKeyRef.current = key;
      setTypedChars(text.length);
      return;
    }

    const delay = Math.max(
      12,
      Math.min(40, (dwellMs * 0.6) / Math.max(1, text.length)),
    );
    setTypedChars(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTypedChars(i);
      if (i >= text.length) {
        printedKeyRef.current = key;
        clearInterval(id);
      }
    }, delay);
    return () => clearInterval(id);
  }, [key, text, active, dwellMs]);

  return typedChars;
}
