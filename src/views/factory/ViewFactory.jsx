// @ts-check
"use client";

import { openTerminal, showError } from "@/lib/tauri-api";
import { newTerminal } from "@/lib/resource-id";
import { useTabs } from "@/state/tabs-context";
import { useFactoryData } from "@/views/factory/useFactoryData";
import { useFactoryProcess } from "@/views/factory/useFactoryProcess";
import ViewLayout from "@/components/ViewLayout";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 */

/**
 * Floor view for a factory: per-line summary. Clicking a line row opens that
 * line as a new tab.
 *
 * @param {{ resource: Extract<ResourceId, { type: 'factory' }> }} props
 * @returns {React.JSX.Element}
 */
export default function ViewFactory({ resource }) {
  const { data, loading, refreshing, fetched_at, error, refresh } = useFactoryData(resource.host, resource.factory);
  const { is_running, loading: process_loading, start, stop } = useFactoryProcess(
    resource.host,
    resource.factory,
  );
  const { dispatch } = useTabs();

  /** @param {string} line */
  const openLine = (line) =>
    dispatch({
      type: "open_tab",
      resource: { type: "line", host: resource.host, factory: resource.factory, line },
    });

  const openLogs = () =>
    dispatch({
      type: "open_tab",
      resource: { type: "factory-logs", host: resource.host, factory: resource.factory },
    });

  return (
    <ViewLayout
      title={resource.factory}
      sub={resource.host === "local" ? undefined : `on ${resource.host}`}
      loading={loading}
      refreshing={refreshing}
      fetched_at={fetched_at}
      error={error}
      onRefresh={refresh}
      actions={
        <>
          <button
            type="button"
            style={actionButtonStyle}
            onClick={() => (is_running ? stop() : start())}
            disabled={process_loading}
          >
            {is_running ? "■ Stop" : "▶ Start"}
          </button>
          <button type="button" style={actionButtonStyle} onClick={openLogs}>
            Logs
          </button>
          <button
            type="button"
            style={actionButtonStyle}
            onClick={() => dispatch({ type: "open_tab", resource: { type: "failures", host: resource.host, factory: resource.factory } })}
          >
            Failures
          </button>
          <button
            type="button"
            style={actionButtonStyle}
            onClick={() => dispatch({ type: "open_tab", resource: { type: "housekeeping", host: resource.host, factory: resource.factory } })}
          >
            Housekeeping
          </button>
          <button
            type="button"
            style={actionButtonStyle}
            onClick={() => dispatch({ type: "open_tab", resource: newTerminal(resource.host, resource.factory) })}
          >
            Terminal
          </button>
          <button
            type="button"
            style={actionButtonStyle}
            title="Open in the OS terminal app"
            onClick={() => openTerminal(resource.host, resource.factory).catch(showError)}
          >
            Terminal app ↗
          </button>
        </>
      }
    >
      {data && data.length === 0 && <Empty hint="No lines on this factory yet." />}
      {data && data.length > 0 && (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Line</th>
              <th style={thStyle}>Name</th>
              <th style={thNumStyle}>In-flight</th>
              <th style={thNumStyle}>Stuck</th>
              <th style={thNumStyle}>Finished</th>
              <th style={thStyle}>Health</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.code} style={trStyle} onClick={() => openLine(row.code)}>
                <td style={tdLinkStyle}>{row.code}</td>
                <td style={tdStyle} title={row.description ?? undefined}>
                  {row.name ?? ""}
                </td>
                <td style={tdNumStyle}>{row.summary.in_flight}</td>
                <td style={tdNumStyle}>{row.summary.stuck}</td>
                <td style={tdNumStyle}>{row.summary.finished}</td>
                <td style={tdStyle}>{health(row.summary)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewLayout>
  );
}

/**
 * @param {import("@/lib/tauri-api").MonitorLineSummary} s
 * @returns {string}
 */
function health(s) {
  if (s.stuck > 0) return `⚠ ${s.stuck_locations.join(", ")}`;
  if (s.in_flight > 0 && s.biggest_flow.at) {
    return `flowing, biggest at ${s.biggest_flow.at}`;
  }
  if (s.finished > 0) return `${s.finished} finished, drained`;
  return "idle";
}

/**
 * @param {{ hint: string }} props
 * @returns {React.JSX.Element}
 */
function Empty({ hint }) {
  return <p style={emptyStyle}>{hint}</p>;
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
const trStyle = { cursor: "pointer" };

/** @type {React.CSSProperties} */
const tdStyle = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
};

/** @type {React.CSSProperties} */
const tdNumStyle = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };

/** @type {React.CSSProperties} */
const tdLinkStyle = { ...tdStyle, color: "var(--accent)" };

/** @type {React.CSSProperties} */
const emptyStyle = {
  color: "var(--muted-foreground)",
  fontStyle: "italic",
};

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
