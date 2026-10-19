// @ts-check
"use client";

import { useFactoriesOverview } from "@/views/factories-overview/useFactoriesOverview";
import ViewLayout from "@/components/ViewLayout";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 */

/**
 * Cross-factory pm2 status table with Start All / Stop All. Refreshes every
 * 2s while open — see useFactoriesOverview for why this view is exempt from
 * the app's usual manual-refresh pattern.
 *
 * @param {{ resource: Extract<ResourceId, { type: 'factories-overview' }> }} props
 * @returns {React.JSX.Element}
 */
export default function ViewFactoriesOverview({ resource }) {
  const { rows, error, startAll, stopAll } = useFactoriesOverview(resource.host);

  return (
    <ViewLayout
      title="Factories"
      sub={`${resource.host === "local" ? "This machine" : resource.host} · live pm2 status, refreshed every 2s`}
      error={error}
      actions={
        <>
          <button type="button" style={actionButtonStyle} onClick={startAll}>
            Start All
          </button>
          <button type="button" style={actionButtonStyle} onClick={stopAll}>
            Stop All
          </button>
        </>
      }
    >
      {rows === null && <p style={emptyStyle}>Loading…</p>}
      {rows && rows.length === 0 && <p style={emptyStyle}>No factories configured.</p>}
      {rows && rows.length > 0 && (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Factory</th>
              <th style={thStyle}>Status</th>
              <th style={thNumStyle}>PID</th>
              <th style={thNumStyle}>CPU</th>
              <th style={thNumStyle}>Memory</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} style={trStyle}>
                <td style={tdStyle}>{row.name}</td>
                <td style={tdStyle}>{displayStatus(row.status)}</td>
                <td style={tdNumStyle}>{row.pid ?? "—"}</td>
                <td style={tdNumStyle}>{row.cpu != null ? `${row.cpu}%` : "—"}</td>
                <td style={tdNumStyle}>{row.memory != null ? formatBytes(row.memory) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewLayout>
  );
}

/** @param {string} status */
function displayStatus(status) {
  return status === "not_found" ? "not started" : status;
}

/** @param {number} bytes */
function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** @type {React.CSSProperties} */
const actionButtonStyle = {
  padding: "5px 12px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--foreground)",
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** @type {React.CSSProperties} */
const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

/** @type {React.CSSProperties} */
const thStyle = {
  textAlign: "left",
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
  fontSize: 11,
  letterSpacing: "0.06em",
  color: "var(--muted-foreground)",
  fontWeight: 500,
};

/** @type {React.CSSProperties} */
const thNumStyle = { ...thStyle, textAlign: "right" };

/** @type {React.CSSProperties} */
const trStyle = {};

/** @type {React.CSSProperties} */
const tdStyle = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
};

/** @type {React.CSSProperties} */
const tdNumStyle = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };

/** @type {React.CSSProperties} */
const emptyStyle = {
  color: "var(--muted-foreground)",
  fontStyle: "italic",
};
