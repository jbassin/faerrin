/**
 * Edit a tag's name + color. Uses the shared modal chrome (.modal__backdrop) so
 * it matches the confirm/prompt dialogs, but carries its own fields (a swatch
 * grid + "None"), which the generic promptText helper can't express.
 */
import { useEffect, useRef, useState } from "react";
import { TAG_PALETTE } from "../grouping";
import type { Tag } from "../types";

export function TagEditModal({
  tag,
  onClose,
  onSave,
}: {
  tag: Tag;
  onClose: () => void;
  onSave: (patch: { name: string; color: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<string | null>(tag.color);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), color });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    // biome-ignore lint/a11y: backdrop click-to-dismiss is paired with Esc + a Cancel button.
    <div className="modal__backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit tag ${tag.name}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <h2 className="modal__title">Edit tag</h2>
        <div className="modal__body">
          <label className="modal__label">Name</label>
          <input
            ref={inputRef}
            className="modal__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
          />
          <label className="modal__label">Color</label>
          <div className="swatches">
            <button
              type="button"
              className={`swatch swatch--none${color === null ? " is-active" : ""}`}
              title="No color"
              aria-label="No color"
              onClick={() => setColor(null)}
            >
              ∅
            </button>
            {TAG_PALETTE.map((p) => (
              <button
                key={p.value}
                type="button"
                className={`swatch${color === p.value ? " is-active" : ""}`}
                style={{ background: p.value }}
                title={p.name}
                aria-label={p.name}
                onClick={() => setColor(p.value)}
              />
            ))}
          </div>
        </div>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={!name.trim() || saving} onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
