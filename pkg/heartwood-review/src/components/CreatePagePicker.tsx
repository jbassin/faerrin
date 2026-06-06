import { useEffect, useMemo, useState } from "react";
import {
  getWikiFolders,
  suggestInboundLinks,
  type InboundSuggestions,
} from "@/server/sessions";

// AC-10 / D-6: the tool proposes a path; the human confirms via a folder picker (never
// auto-files). Plus inbound-link suggestions (existing pages that mention the entity) and
// an orphan flag when nothing points to the new page.

function parseTargetPath(
  tp: string,
  fallbackName: string,
): { folder: string; filename: string } {
  if (!tp) return { folder: "", filename: fallbackName };
  const noExt = tp.replace(/\.md$/, "");
  const i = noExt.lastIndexOf("/");
  return i === -1
    ? { folder: "", filename: noExt }
    : { folder: noExt.slice(0, i), filename: noExt.slice(i + 1) };
}

export function CreatePagePicker({
  canonicalName,
  initialTargetPath,
  onChange,
}: {
  canonicalName: string;
  initialTargetPath: string;
  onChange: (targetPath: string) => void;
}) {
  const init = parseTargetPath(initialTargetPath, canonicalName);
  const [folder, setFolder] = useState(init.folder);
  const [filename, setFilename] = useState(init.filename);
  const [folders, setFolders] = useState<string[]>([]);
  const [inbound, setInbound] = useState<InboundSuggestions | null>(null);

  const targetPath = useMemo(
    () => (folder ? `${folder}/${filename}.md` : `${filename}.md`),
    [folder, filename],
  );

  useEffect(() => {
    void getWikiFolders().then(setFolders);
  }, []);
  useEffect(() => {
    void suggestInboundLinks({ data: { name: canonicalName } }).then(
      setInbound,
    );
  }, [canonicalName]);
  useEffect(() => {
    onChange(filename.trim() ? targetPath : "");
  }, [targetPath, filename, onChange]);

  return (
    <div style={{ marginBottom: "0.6rem", fontSize: "0.85rem" }}>
      <div
        style={{
          display: "flex",
          gap: "0.4rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "#555" }}>New page:</span>
        <select
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          style={{
            font: "inherit",
            fontSize: "0.85rem",
            padding: "0.3rem",
            borderRadius: 6,
            border: "1px solid #ccc",
          }}
        >
          <option value="">(wiki root)</option>
          {folders.filter(Boolean).map((f) => (
            <option key={f} value={f}>
              {f}/
            </option>
          ))}
        </select>
        <input
          type="text"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="page name"
          style={{
            font: "inherit",
            fontSize: "0.85rem",
            padding: "0.3rem",
            borderRadius: 6,
            border: "1px solid #ccc",
            flex: 1,
            minWidth: 140,
          }}
        />
        <span style={{ color: "#999" }}>.md</span>
      </div>
      <div style={{ color: "#777", marginTop: "0.25rem" }}>
        → <code>{targetPath}</code>
      </div>
      {inbound &&
        (inbound.orphan ? (
          <div style={{ color: "#b06000", marginTop: "0.3rem" }}>
            ⚠ No existing page mentions “{canonicalName}” — this page will be an
            orphan. Consider linking it from a related page.
          </div>
        ) : (
          <details style={{ marginTop: "0.3rem" }}>
            <summary style={{ cursor: "pointer", color: "#2b6cb0" }}>
              {inbound.mentions.length} page(s) mention “{canonicalName}”
              (candidate inbound links)
            </summary>
            <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem" }}>
              {inbound.mentions.map((p) => (
                <li key={p}>
                  <code>{p}</code>
                </li>
              ))}
            </ul>
          </details>
        ))}
    </div>
  );
}
