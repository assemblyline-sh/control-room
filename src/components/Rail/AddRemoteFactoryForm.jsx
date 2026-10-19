// @ts-check
"use client";

import { useState } from "react";
import { addFactory, checkFactoryPath } from "@/lib/tauri-api";
import { buttonStyle, formStyle, inputStyle, noteStyle, rowStyle } from "@/components/Rail/AddHostForm";

/**
 * Add a factory on a remote host: a path on that host, checked over ssh
 * (exists, and is a factory) before it's saved.
 *
 * @param {{ host: string, onDone: (added: boolean) => void }} props
 * @returns {React.JSX.Element}
 */
export default function AddRemoteFactoryForm({ host, onDone }) {
  const [path, set_path] = useState("");
  const [busy, set_busy] = useState(false);
  const [note, set_note] = useState(/** @type {{ ok: boolean, text: string } | null} */ (null));

  async function save() {
    set_busy(true);
    set_note(null);
    try {
      const c = await checkFactoryPath(host, path.trim());
      if (!c.exists) {
        set_note({ ok: false, text: `${c.root} doesn't exist on ${host}.` });
        return;
      }
      if (!c.main) {
        set_note({ ok: false, text: `${c.root} isn't a factory (no @assemblyline/lib-factory + main in package.json).` });
        return;
      }
      await addFactory(host, path.trim());
      onDone(true);
    } catch (err) {
      set_note({ ok: false, text: String(err) });
    } finally {
      set_busy(false);
    }
  }

  return (
    <div style={formStyle}>
      <input
        style={inputStyle}
        placeholder={`path on ${host}, e.g. ~/factories/factory-x`}
        value={path}
        onChange={(e) => set_path(e.target.value)}
      />
      {note && <p style={{ ...noteStyle, color: note.ok ? "var(--muted-foreground)" : "#ff7b72" }}>{note.text}</p>}
      <div style={rowStyle}>
        <button type="button" style={buttonStyle} disabled={busy} onClick={() => onDone(false)}>
          Cancel
        </button>
        <button type="button" style={buttonStyle} disabled={busy || !path.trim()} onClick={save}>
          {busy ? "Checking…" : "Add"}
        </button>
      </div>
    </div>
  );
}
