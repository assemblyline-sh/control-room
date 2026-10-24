// @ts-check
"use client";

import { useState } from "react";
import AddHostForm from "@/components/Rail/AddHostForm";
import AddRemoteFactoryForm from "@/components/Rail/AddRemoteFactoryForm";
import CountBinsPicker from "@/components/Rail/CountBinsPicker";
import TreeNode from "@/components/Rail/TreeNode";
import { openHostWindow, showError } from "@/lib/tauri-api";
import { useConfig } from "@/state/config-context";
import { useHostSsh } from "@/state/ssh-context";
import { useTabs } from "@/state/tabs-context";
import { useHostTotals } from "@/state/counts-store";

/**
 * Tree rail: host picker (opens or focuses that host's window — a window
 * never changes host), then this window's host's factories as root
 * TreeNodes that lazy-load their children (lines → stations → bins →
 * workpieces → files) on first expand.
 *
 * @param {{ onAddFactory: () => void }} props
 * @returns {React.JSX.Element}
 */
export default function Rail({ onAddFactory }) {
  const { dispatch } = useTabs();
  const { config, host, reload } = useConfig();
  const ssh = useHostSsh(host.name);
  const [adding, set_adding] = useState(/** @type {'host' | 'factory' | null} */ (null));

  const totals = useHostTotals(host.name);
  /** @param {import("@/lib/resource-id").ResourceId} resource */
  const open = (resource) => dispatch({ type: "open_tab", resource });

  return (
    <aside style={railStyle}>
      <div style={headerRowStyle}>
        <span style={headerStyle}>HOST</span>
        <select
          style={hostSelectStyle}
          value={host.name}
          onFocus={reload}
          onChange={(e) => openHostWindow(e.target.value).catch(showError)}
          title={`${host.is_local ? "This machine" : `ssh ${host.ssh}`} — pick another host to open it in its own window`}
        >
          {config.hosts.map((h) => (
            <option key={h.name} value={h.name}>
              {h.name}
            </option>
          ))}
        </select>
        <span style={{ ...dotStyle, background: dotColor(host.is_local, ssh.state) }} title={dotTitle(host, ssh)} />
        <button type="button" style={iconButtonStyle} title="Add a host" onClick={() => set_adding("host")}>
          +
        </button>
      </div>
      {adding === "host" && (
        <AddHostForm
          onDone={async (name) => {
            set_adding(null);
            if (name) {
              await reload();
              await openHostWindow(name).catch(showError);
            }
          }}
        />
      )}
      <div style={headerRowStyle}>
        <span style={headerStyle}>VIEWS</span>
      </div>
      <div style={viewsStyle}>
        <button type="button" style={viewRowStyle} onClick={() => open({ type: "factories-overview", host: host.name })}>
          <span style={viewIconStyle}>▦</span>
          <span style={viewLabelStyle}>Factories</span>
        </button>
        <button
          type="button"
          style={viewRowStyle}
          onClick={() => open({ type: "failures", host: host.name })}
          title="Failed workpieces on this host, grouped by error (orphaned failed folders included)"
        >
          <span style={{ ...viewIconStyle, color: "#ff7b72" }}>⚠</span>
          <span style={viewLabelStyle}>Failures</span>
          {totals && <span style={totals.failed > 0 ? failedBadgeStyle : badgeStyle}>{totals.failed.toLocaleString()}</span>}
        </button>
        <button
          type="button"
          style={viewRowStyle}
          onClick={() => open({ type: "housekeeping", host: host.name })}
          title="Clear done and finished workpieces. The number is what's in done bins."
        >
          <span style={viewIconStyle}>⌫</span>
          <span style={viewLabelStyle}>Housekeeping</span>
          {totals && <span style={badgeStyle}>{totals.done.toLocaleString()}</span>}
        </button>
      </div>
      <div style={headerRowStyle}>
        <span style={headerStyle}>FACTORIES</span>
        <CountBinsPicker />
      </div>
      <div style={treeStyle}>
        {host.factories.length === 0 && <p style={emptyStyle}>No factories on {host.name}.</p>}
        {host.factories.map((w) => (
          <TreeNode
            key={`${host.name}/${w.name}`}
            resource={{ type: "factory", host: host.name, factory: w.name }}
            depth={0}
          />
        ))}
      </div>
      {adding === "factory" && (
        <AddRemoteFactoryForm
          host={host.name}
          onDone={async (added) => {
            set_adding(null);
            if (added) await reload();
          }}
        />
      )}
      {adding !== "factory" && (
        <button
          type="button"
          style={addStyle}
          onClick={() => (host.is_local ? onAddFactory() : set_adding("factory"))}
        >
          + Add factory {host.is_local ? "repo" : `on ${host.name}`}
        </button>
      )}
    </aside>
  );
}

/**
 * @param {boolean} is_local
 * @param {import("@/state/ssh-context").HostSsh["state"]} state
 */
function dotColor(is_local, state) {
  if (is_local) return "var(--muted-foreground)";
  return { idle: "var(--muted-foreground)", busy: "#e3b341", ok: "#3fb950", error: "#ff7b72" }[state];
}

/**
 * @param {import("@/lib/tauri-api").ConfigHost} host
 * @param {import("@/state/ssh-context").HostSsh} ssh
 */
function dotTitle(host, ssh) {
  if (host.is_local) return "This machine";
  if (ssh.state === "busy") return `Waiting on ssh ${host.ssh}…`;
  if (ssh.state === "error") return ssh.message ?? "Last call failed";
  if (ssh.state === "ok") return `Connected (ssh ${host.ssh})`;
  return `ssh ${host.ssh} — not contacted yet`;
}

/** @type {React.CSSProperties} */
const viewsStyle = { display: "flex", flexDirection: "column", padding: "0 0 6px" };

/** @type {React.CSSProperties} */
const viewRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "3px 16px 3px 22px",
  background: "transparent",
  border: "none",
  color: "var(--foreground)",
  fontSize: 13,
  textAlign: "left",
  cursor: "pointer",
};

/** @type {React.CSSProperties} */
const viewIconStyle = { width: 16, textAlign: "center", color: "var(--muted-foreground)" };

/** @type {React.CSSProperties} */
const viewLabelStyle = { flex: 1 };

/** @type {React.CSSProperties} */
const badgeStyle = { fontSize: 12, color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" };

/** @type {React.CSSProperties} */
const failedBadgeStyle = { ...badgeStyle, color: "#ff7b72", fontWeight: 600 };

/** @type {React.CSSProperties} */
const dotStyle = { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 };

/** @type {React.CSSProperties} */
const iconButtonStyle = {
  padding: "0 6px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--muted-foreground)",
  fontSize: 12,
  cursor: "pointer",
};

/** @type {React.CSSProperties} */
const hostSelectStyle = {
  maxWidth: 160,
  padding: "2px 6px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--foreground)",
  fontSize: 12,
};

/** @type {React.CSSProperties} */
const emptyStyle = {
  margin: "4px 16px",
  fontSize: 12,
  color: "var(--muted-foreground)",
  fontStyle: "italic",
};

/** @type {React.CSSProperties} */
const railStyle = {
  display: "flex",
  flexDirection: "column",
  padding: "12px 0",
  overflow: "auto",
  background: "var(--muted)",
};

/** @type {React.CSSProperties} */
const headerRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 6,
  padding: "4px 16px 8px",
};

/** @type {React.CSSProperties} */
const headerStyle = {
  fontSize: 11,
  letterSpacing: "0.08em",
  color: "var(--muted-foreground)",
};

/** @type {React.CSSProperties} */
const treeStyle = {
  flex: 1,
  overflow: "auto",
  paddingRight: 8,
};

/** @type {React.CSSProperties} */
const addStyle = {
  margin: "12px 16px 0",
  padding: "6px 10px",
  background: "transparent",
  border: "1px dashed var(--border)",
  borderRadius: 6,
  color: "var(--muted-foreground)",
  fontSize: 12,
  cursor: "pointer",
};
