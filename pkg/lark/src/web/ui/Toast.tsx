/**
 * Corner toast notifications (replaces window.alert). Provider holds a small
 * stack (newest on top, max 4); each toast auto-dismisses and can be closed.
 * `useToast()` exposes info/success/error. Errors live longer and announce
 * assertively for screen readers.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type ToastVariant = "info" | "success" | "error";

interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
}

interface ToastApi {
  show: (message: string, variant?: ToastVariant) => void;
  info: (message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const DURATION_MS: Record<ToastVariant, number> = { info: 4000, success: 4000, error: 6000 };
const MAX_TOASTS = 4;

const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((cur) => cur.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id = Date.now() + Math.random();
      setToasts((cur) => [{ id, variant, message }, ...cur].slice(0, MAX_TOASTS));
      setTimeout(() => dismiss(id), DURATION_MS[variant]);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      info: (m) => show(m, "info"),
      success: (m) => show(m, "success"),
      error: (m) => show(m, "error"),
    }),
    [show],
  );

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.variant}`} role={t.variant === "error" ? "alert" : "status"}>
            <span className="toast__msg">{t.message}</span>
            <button className="toast__close" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
