/**
 * Modal dialogs (replaces window.confirm / window.prompt). The provider renders
 * one modal at a time and exposes promise-returning helpers so call sites stay
 * one-liners:
 *
 *   if (await confirm({ title, body, danger: true })) { … }
 *   const name = await promptText({ title: "Rename", defaultValue: cur });
 *
 * a11y: role=dialog + aria-modal, Esc / backdrop cancels, Enter accepts, focus
 * moves into the modal on open and is restored to the trigger on close.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

export interface ConfirmOpts {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOpts {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
}

interface DialogApi {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  promptText: (opts: PromptOpts) => Promise<string | null>;
}

type Active =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void };

const DialogCtx = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const ctx = useContext(DialogCtx);
  if (!ctx) throw new Error("useDialog must be used within <DialogProvider>");
  return ctx;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<Active | null>(null);
  const [value, setValue] = useState("");
  const restoreFocus = useRef<HTMLElement | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        restoreFocus.current = document.activeElement as HTMLElement | null;
        setActive({ kind: "confirm", opts, resolve });
      }),
    [],
  );

  const promptText = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) => {
        restoreFocus.current = document.activeElement as HTMLElement | null;
        setValue(opts.defaultValue ?? "");
        setActive({ kind: "prompt", opts, resolve });
      }),
    [],
  );

  const api = useMemo<DialogApi>(() => ({ confirm, promptText }), [confirm, promptText]);

  const finish = useCallback(
    (accepted: boolean) => {
      setActive((cur) => {
        if (cur) {
          if (cur.kind === "confirm") cur.resolve(accepted);
          else cur.resolve(accepted ? value : null);
        }
        return null;
      });
      restoreFocus.current?.focus?.();
    },
    [value],
  );

  return (
    <DialogCtx.Provider value={api}>
      {children}
      {active && (
        <ModalShell
          opts={active.opts}
          kind={active.kind}
          value={value}
          onValue={setValue}
          onCancel={() => finish(false)}
          onAccept={() => finish(true)}
        />
      )}
    </DialogCtx.Provider>
  );
}

function ModalShell({
  opts,
  kind,
  value,
  onValue,
  onCancel,
  onAccept,
}: {
  opts: ConfirmOpts | PromptOpts;
  kind: Active["kind"];
  value: string;
  onValue: (v: string) => void;
  onCancel: () => void;
  onAccept: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement | HTMLButtonElement>(null);
  const danger = kind === "confirm" && (opts as ConfirmOpts).danger;
  const confirmLabel = opts.confirmLabel ?? (kind === "confirm" ? "Confirm" : "OK");
  const cancelLabel = (kind === "confirm" && (opts as ConfirmOpts).cancelLabel) || "Cancel";

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  // Esc cancels; Tab is trapped inside the dialog.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Tab") {
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    // biome-ignore lint/a11y: backdrop click-to-dismiss is paired with Esc + a Cancel button.
    <div className="modal__backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={opts.title}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 className="modal__title">{opts.title}</h2>
        {kind === "prompt" ? (
          <div className="modal__body">
            {(opts as PromptOpts).label && <label className="modal__label">{(opts as PromptOpts).label}</label>}
            <input
              ref={firstFieldRef as RefObject<HTMLInputElement>}
              className="modal__input"
              value={value}
              placeholder={(opts as PromptOpts).placeholder}
              onChange={(e) => onValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onAccept();
                }
              }}
            />
          </div>
        ) : (
          (opts as ConfirmOpts).body && <div className="modal__body">{(opts as ConfirmOpts).body}</div>
        )}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={kind === "confirm" ? (firstFieldRef as RefObject<HTMLButtonElement>) : undefined}
            className={`btn${danger ? " btn--danger-solid" : ""}`}
            onClick={onAccept}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
