import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "./api";
import { useDialog } from "./ui/Dialog";
import { useToast } from "./ui/Toast";

interface KeyRow {
  id: number;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
}

/** Stream Deck API-key management (B26): generate (shown once), list, revoke. */
export function Keys() {
  const toast = useToast();
  const { confirm, promptText } = useDialog();
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => setKeys(await apiGet<KeyRow[]>("/api/v1/keys")), []);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function generate() {
    const name = await promptText({ title: "New API key", label: "Name this key (e.g. 'Stream Deck')", defaultValue: "Stream Deck" });
    if (name === null) return;
    try {
      const created = await apiSend<KeyRow & { key: string }>("POST", "/api/v1/keys", { name });
      setFresh(created.key);
      await load();
    } catch (err) {
      toast.error(`Could not create key: ${(err as Error).message}`);
    }
  }

  async function revoke(id: number) {
    const ok = await confirm({
      title: "Revoke key",
      body: "Revoke this key? Any Stream Deck using it stops working.",
      confirmLabel: "Revoke",
      danger: true,
    });
    if (!ok) return;
    try {
      await apiSend("DELETE", `/api/v1/keys/${id}`);
      await load();
    } catch (err) {
      toast.error(`Could not revoke key: ${(err as Error).message}`);
    }
  }

  return (
    <section className="keys card">
      <button className="keys__toggle btn btn--ghost" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} Stream Deck API keys
      </button>
      {open && (
        <div className="keys__body">
          {fresh && (
            <div className="keys__fresh">
              <p className="muted">Copy this now — it won't be shown again:</p>
              <code className="keys__raw">{fresh}</code>
              <button className="btn btn--ghost" onClick={() => setFresh(null)}>
                Done
              </button>
            </div>
          )}
          <button className="btn" onClick={() => void generate()}>
            New key
          </button>
          <ul className="keys__list">
            {keys.map((k) => (
              <li key={k.id} className={k.revoked ? "is-revoked" : ""}>
                <span>
                  <strong>{k.name}</strong> <code className="muted">{k.prefix}…</code>
                </span>
                <span className="muted">{k.last_used_at ? `used ${k.last_used_at}` : "never used"}</span>
                {k.revoked ? (
                  <span className="muted">revoked</span>
                ) : (
                  <button className="btn btn--ghost" onClick={() => void revoke(k.id)}>
                    Revoke
                  </button>
                )}
              </li>
            ))}
            {keys.length === 0 && <li className="muted">No keys yet.</li>}
          </ul>
          <p className="muted">
            See <code>docs/stream-deck.md</code> for the endpoint reference.
          </p>
        </div>
      )}
    </section>
  );
}
