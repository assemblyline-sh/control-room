// @ts-check
"use client";

import { DataTable } from "@fob/lib-ui/primitives/data-table/data-table";
import { openTerminal, showError } from "@/lib/tauri-api";
import { CLICKABLE_ROWS, clickRowButton } from "@/lib/row-click";
import { newTerminal } from "@/lib/resource-id";
import { useTabs } from "@/state/tabs-context";
import { useFactoryData } from "@/views/factory/useFactoryData";
import { useFactoryProcess } from "@/views/factory/useFactoryProcess";
import ViewLayout from "@/components/ViewLayout";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 * @typedef {import("@/lib/tauri-api").MonitorLineRow} LineRow
 */

/**
 * Floor view for a factory: per-line summary, in the factory's line order until
 * a header is clicked. Clicking a line row opens that line as a new tab.
 *
 * @param {{ resource: Extract<ResourceId, { type: 'factory' }> }} props
 * @returns {React.JSX.Element}
 */
export default function ViewFactory({ resource }) {
  const { data, loading, refreshing, fetched_at, error, refresh } = useFactoryData(resource.host, resource.factory);
  const { status, is_running, is_direct, loading: process_loading, start, stop, restart } = useFactoryProcess(
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
          {is_direct ? (
            <span
              style={mutedStyle}
              title={`pid ${status?.pid}: started outside pm2, so it can't be stopped from here. Stop it on the host.`}
            >
              Running directly
            </span>
          ) : (
            <button
              type="button"
              style={actionButtonStyle}
              onClick={() => (is_running ? stop() : start())}
              disabled={process_loading}
            >
              {is_running ? "■ Stop" : "▶ Start"}
            </button>
          )}
          {is_running && (
            <button type="button" style={actionButtonStyle} onClick={restart} disabled={process_loading}>
              ↻ Restart
            </button>
          )}
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
        <div onClick={clickRowButton}>
          <DataTable columns={columns(openLine)} data={data} className={CLICKABLE_ROWS} size="sm" hidePagination={data.length <= 30} />
        </div>
      )}
    </ViewLayout>
  );
}

const NUMERIC = { headerClassName: "text-right", cellClassName: "text-right tabular-nums" };

/**
 * @param {(line: string) => void} openLine
 * @returns {import("@tanstack/react-table").ColumnDef<LineRow, any>[]}
 */
function columns(openLine) {
  return [
    {
      id: "code",
      accessorKey: "code",
      header: "Line",
      sortingFn: "alphanumeric",
      cell: ({ row }) => (
        <button type="button" style={lineButtonStyle} onClick={() => openLine(row.original.code)}>
          {row.original.code}
        </button>
      ),
    },
    {
      id: "name",
      accessorFn: (row) => row.name ?? "",
      header: "Name",
      cell: ({ row }) => <span title={row.original.description ?? undefined}>{row.original.name ?? ""}</span>,
    },
    { id: "in_flight", accessorFn: (row) => row.summary.in_flight, header: "In-flight", sortingFn: "basic", meta: NUMERIC },
    { id: "stuck", accessorFn: (row) => row.summary.stuck, header: "Stuck", sortingFn: "basic", meta: NUMERIC },
    { id: "finished", accessorFn: (row) => row.summary.finished, header: "Finished", sortingFn: "basic", meta: NUMERIC },
    { id: "health", accessorFn: (row) => health(row.summary), header: "Health" },
  ];
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
const lineButtonStyle = {
  padding: 0,
  background: "transparent",
  border: "none",
  font: "inherit",
  color: "var(--accent)",
  cursor: "pointer",
};

/** @type {React.CSSProperties} */
const emptyStyle = {
  color: "var(--muted-foreground)",
  fontStyle: "italic",
};

/** @type {React.CSSProperties} */
const mutedStyle = { padding: "5px 4px", fontSize: 12, color: "var(--muted-foreground)" };

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
