// @ts-check
"use client";

import { useState } from "react";
import { addHost, testHost } from "@/lib/tauri-api";

/**
 * Add a remote host to the central config. "Test connection" runs one probe
 * round trip first, so a typo or a missing `node:` shows before it's saved.
 *
 * @param {{ onDone: (name: string | null) => void }} props - name of the added host, or null on cancel
 * @returns {React.JSX.Element}
 */
export default function AddHostForm({ onDone }) {
  const [ssh, set_ssh] = useState("");
  const [name, set_name] = useState("");
  const [node, set_node] = useState("");
  const [busy, set_busy] = useState(false);
  const [result, set_result] = useState(/** @type {{ ok: boolean, text: string } | null} */ (null));

  async function test() {
    set_busy(true);
    set_result(null);
    try {
      const r = await testHost(ssh.trim(), node.trim());
      set_result(
        r.pm2_found
          ? { ok: true, text: `Connected. pm2 found${r.running.length ? `; running: ${r.running.join(", ")}` : ""}.` }
          : { ok: false, text: "Connected, but pm2 isn't on PATH over ssh. Set node to the node pm2 was installed with (`which node` in a shell there)." },
      );
    } catch (err) {
      set_result({ ok: false, text: String(err) });
    } finally {
      set_busy(false);
    }
  }

  async function save() {
    set_busy(true);
    try {
      const host_name = name.trim() || ssh.trim();
      await addHost(host_name, ssh.trim(), node.trim());
      onDone(host_name);
    } catch (err) {
      set_result({ ok: false, text: String(err) });
      set_busy(false);
    }
  }

  return (
    <div style={formStyle}>
      <input style={inputStyle} placeholder="ssh alias (from ~/.ssh/config)" value={ssh} onChange={(e) => set_ssh(e.target.value)} />
      <input style={inputStyle} placeholder={`name (default: ${ssh || "alias"})`} value={name} onChange={(e) => set_name(e.target.value)} />
      <input style={inputStyle} placeholder="node path on host (optional, for nvm)" value={node} onChange={(e) => set_node(e.target.value)} />
      {result && <p style={{ ...noteStyle, color: result.ok ? "var(--muted-foreground)" : "#ff7b72" }}>{result.text}</p>}
      <div style={rowStyle}>
        <button type="button" style={buttonStyle} disabled={busy} onClick={() => onDone(null)}>
          Cancel
        </button>
        <button type="button" style={buttonStyle} disabled={busy || !ssh.trim()} onClick={test}>
          {busy ? "…" : "Test"}
        </button>
        <button type="button" style={buttonStyle} disabled={busy || !result?.ok} onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}

/** @type {React.CSSProperties} */
export const formStyle = { display: "flex", flexDirection: "column", gap: 6, margin: "4px 16px 8px" };

/** @type {React.CSSProperties} */
export const inputStyle = {
  padding: "4px 6px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--foreground)",
  fontSize: 12,
};

/** @type {React.CSSProperties} */
export const noteStyle = { margin: 0, fontSize: 11, lineHeight: 1.4 };

/** @type {React.CSSProperties} */
export const rowStyle = { display: "flex", justifyContent: "flex-end", gap: 6 };

/** @type {React.CSSProperties} */
export const buttonStyle = {
  padding: "3px 10px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--foreground)",
  fontSize: 11,
  cursor: "pointer",
};
