// @ts-check
"use client";

import { useState } from "react";
import { clearActions } from "@/lib/clear-actions";
import { useClear } from "@/state/clear-context";
import { useTabs } from "@/state/tabs-context";
import { useLineData } from "@/views/line/useLineData";
import ContextMenu from "@/components/ContextMenu";
import OrchestratorLink from "@/components/OrchestratorLink";
import ViewLayout from "@/components/ViewLayout";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 */

const LIVE_BINS = /** @type {const} */ (["input", "doing", "output", "failed", "done"]);

/**
 * Line view: station × bin grid. Each cell click opens the bin (or station)
 * as a new tab. Done counts shown in parentheses since they're archive
 * receipts, not positions. Right-click a done or terminal-output cell to
 * clear it; the header clears the whole line.
 *
 * @param {{ resource: Extract<ResourceId, { type: 'line' }> }} props
 * @returns {React.JSX.Element}
 */
export default function ViewLine({ resource }) {
  const { data, loading, refreshing, fetched_at, error, refresh } = useLineData(
    resource.host,
    resource.factory,
    resource.line,
  );
  const { dispatch } = useTabs();
  const open_clear = useClear();
  const [menu, set_menu] = useState(/** @type {{ x: number, y: number, items: import("@/components/ContextMenu").MenuItem[] } | null} */ (null));

  /**
   * @param {string} station
   * @param {string} bin
   */
  const openBin = (station, bin) =>
    dispatch({
      type: "open_tab",
      resource: {
        type: "bin",
        host: resource.host,
        factory: resource.factory,
        line: resource.line,
        station,
        bin,
      },
    });

  /** @param {string} station */
  const openStation = (station) =>
    dispatch({
      type: "open_tab",
      resource: {
        type: "station",
        host: resource.host,
        factory: resource.factory,
        line: resource.line,
        station,
      },
    });

  return (
    <ViewLayout
      title={data?.name ? `Line ${resource.line} — ${data.name}` : `Line ${resource.line}`}
      link={data?.orchestrator && `${data.orchestrator}/lines/${encodeURIComponent(resource.line)}`}
      sub={
        data
          ? `terminal: ${data.terminal} • in-flight ${data.summary.in_flight} • stuck ${data.summary.stuck} • finished ${data.summary.finished}`
          : undefined
      }
      loading={loading}
      refreshing={refreshing}
      fetched_at={fetched_at}
      error={error}
      onRefresh={refresh}
      actions={clearActions(resource).map((a) => (
        <button key={a.label} type="button" style={actionButtonStyle} onClick={() => open_clear(a.request)}>
          {a.label}
        </button>
      ))}
    >
      {menu && <ContextMenu items={menu.items} x={menu.x} y={menu.y} onClose={() => set_menu(null)} />}
      {data && (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Station</th>
              <th style={thStyle}>Name</th>
              {LIVE_BINS.map((b) => (
                <th key={b} style={thNumStyle}>
                  {b}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.stations.map((row) => (
              <tr key={row.station}>
                <td style={tdLinkStyle} onClick={() => openStation(row.station)}>
                  {row.station}
                  {data.orchestrator && (
                    <OrchestratorLink href={`${data.orchestrator}/stations/${encodeURIComponent(row.station)}`} label={row.station} />
                  )}
                  {row.is_terminal && <span style={terminalBadgeStyle}>terminal</span>}
                </td>
                <td style={tdStyle} title={row.description ?? undefined}>
                  {row.name ?? ""}
                </td>
                {LIVE_BINS.map((b) => {
                  const v = row[b];
                  if (v === null || v === undefined) {
                    return (
                      <td key={b} style={tdMutedStyle}>
                        —
                      </td>
                    );
                  }
                  const actions = clearActions({
                    type: "bin",
                    host: resource.host,
                    factory: resource.factory,
                    line: resource.line,
                    station: row.station,
                    bin: b,
                    is_terminal: row.is_terminal,
                  });
                  return (
                    <td
                      key={b}
                      style={b === "failed" && v > 0 ? tdFailedStyle : tdNumLinkStyle}
                      onClick={() => openBin(row.station, b)}
                      onContextMenu={(e) => {
                        if (actions.length === 0 || v === 0) return;
                        e.preventDefault();
                        set_menu({
                          x: e.clientX,
                          y: e.clientY,
                          items: actions.map((a) => ({ label: a.label, danger: true, onClick: () => open_clear(a.request) })),
                        });
                      }}
                    >
                      {b === "done" ? `(${v})` : v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewLayout>
  );
}

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
const tdStyle = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
};

/** @type {React.CSSProperties} */
const tdLinkStyle = { ...tdStyle, color: "var(--accent)", cursor: "pointer" };

/** @type {React.CSSProperties} */
const tdNumLinkStyle = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  cursor: "pointer",
  color: "var(--accent)",
};

/** @type {React.CSSProperties} */
const tdFailedStyle = { ...tdNumLinkStyle, color: "#ff7b72", fontWeight: 600 };

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
const tdNumStyle = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

/** @type {React.CSSProperties} */
const tdMutedStyle = {
  ...tdNumStyle,
  color: "var(--muted-foreground)",
};

/** @type {React.CSSProperties} */
const terminalBadgeStyle = {
  marginLeft: 8,
  padding: "1px 6px",
  background: "var(--muted)",
  color: "var(--muted-foreground)",
  fontSize: 10,
  borderRadius: 3,
  fontVariantNumeric: "tabular-nums",
};
