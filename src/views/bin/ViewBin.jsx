// @ts-check
"use client";

import { DataTable } from "@fob/lib-ui/primitives/data-table/data-table";
import { clearActions } from "@/lib/clear-actions";
import { plural } from "@/lib/format";
import { CLICKABLE_ROWS, clickRowButton } from "@/lib/row-click";
import { useClear } from "@/state/clear-context";
import { useTabs } from "@/state/tabs-context";
import { useBinData, useBinFailures, useIsTerminal } from "@/views/bin/useBinData";
import ViewLayout from "@/components/ViewLayout";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 * @typedef {import("@/lib/tauri-api").MonitorWorkpieceRow} Row
 * @typedef {import("@/lib/tauri-api").Failure} Failure
 */

/**
 * Bin view: workpiece list with their last log event. Each row opens the
 * workpiece as a tab; the headers sort, newest first by default, blanks last.
 * A failed bin adds each workpiece's error key and lists orphaned folders in
 * their own table below, which open their error file. A done bin or a
 * terminal output gets Clear….
 *
 * @param {{ resource: Extract<ResourceId, { type: 'bin' }> }} props
 * @returns {React.JSX.Element}
 */
export default function ViewBin({ resource }) {
  const { host, factory, line, station, bin } = resource;
  const { data, loading, refreshing, fetched_at, error, refresh } = useBinData(host, factory, station, bin);
  const failures = useBinFailures(host, factory, station, bin);
  const is_terminal = useIsTerminal(host, factory, line, station, bin, resource.is_terminal);
  const { dispatch } = useTabs();
  const open_clear = useClear();

  /** @type {Map<string, Failure>} */
  const by_id = new Map((failures.data ?? []).filter((f) => !f.orphan).map((f) => [f.id, f]));
  const orphans = (failures.data ?? []).filter((f) => f.orphan);
  const is_failed = bin === "failed";
  // The viewer's zone, which At is shown in — e.g. "IST" or "GMT+5:30".
  const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts().find((p) => p.type === "timeZoneName")?.value ?? "local";

  /** @param {string} workpiece */
  const openWp = (workpiece) =>
    dispatch({ type: "open_tab", resource: { type: "workpiece", host, factory, line, station, bin, workpiece } });

  /** @param {Failure} f */
  const openOrphan = (f) =>
    dispatch({
      type: "open_tab",
      resource: { type: "file", host, factory, file_path: `temp/stations/${f.dir}/${f.message === null ? "error.txt" : "error.json"}` },
    });

  // Blanks (no log yet, no error) are undefined, which sorts them last either way.
  /** @type {import("@tanstack/react-table").ColumnDef<Row, any>[]} */
  const columns = [
    {
      id: "id",
      accessorFn: (row) => row.id,
      header: "Workpiece",
      sortingFn: "alphanumeric",
      cell: ({ row }) => (
        <button type="button" style={idButtonStyle} onClick={() => openWp(row.original.id)}>
          {row.original.id}
        </button>
      ),
    },
    ...(is_failed
      ? [
          /** @type {import("@tanstack/react-table").ColumnDef<Row, any>} */ ({
            id: "error",
            accessorFn: (row) => by_id.get(row.id)?.key || undefined,
            header: "Error",
            sortingFn: "alphanumeric",
            sortUndefined: "last",
            cell: ({ row }) => {
              const f = by_id.get(row.original.id);
              return f ? (
                <span style={errorStyle} title={f.message ?? undefined}>
                  {f.key}
                </span>
              ) : (
                <span style={mutedStyle}>…</span>
              );
            },
          }),
        ]
      : []),
    {
      id: "event",
      accessorFn: (row) => row.last_event?.event || undefined,
      header: "Last event",
      sortingFn: "alphanumeric",
      sortUndefined: "last",
      cell: ({ row }) => row.original.last_event?.event ?? <span style={mutedStyle}>—</span>,
    },
    {
      id: "at",
      accessorFn: (row) => row.last_event?.ts || undefined,
      header: `At (${zone})`,
      sortingFn: "text",
      sortUndefined: "last",
      cell: ({ row }) => {
        const ev = row.original.last_event;
        return ev ? <span title={utc(ev.ts)}>{`${ev.station} · ${formatTs(ev.ts)}`}</span> : <span style={mutedStyle}>—</span>;
      },
    },
  ];

  /** @type {import("@tanstack/react-table").ColumnDef<Failure, any>[]} */
  const orphan_columns = [
    {
      id: "id",
      accessorKey: "id",
      header: "Folder",
      sortingFn: "alphanumeric",
      cell: ({ row }) => (
        <button type="button" style={idButtonStyle} onClick={() => openOrphan(row.original)}>
          {row.original.id}
        </button>
      ),
    },
    {
      id: "error",
      accessorKey: "key",
      header: "Error",
      sortingFn: "alphanumeric",
      cell: ({ row }) => (
        <span style={errorStyle} title={row.original.message ?? undefined}>
          {row.original.key}
        </span>
      ),
    },
    {
      id: "at",
      accessorFn: (f) => f.failed_at || undefined,
      header: `Failed at (${zone})`,
      sortingFn: "text",
      sortUndefined: "last",
      cell: ({ row }) => {
        const at = row.original.failed_at;
        return at ? <span title={utc(at)}>{formatTs(at)}</span> : <span style={mutedStyle}>—</span>;
      },
    },
  ];

  const count = data ? data.length + orphans.length : 0;

  return (
    <ViewLayout
      title={`${station}/${bin}`}
      sub={data ? `${plural(data.length, "workpiece")}${orphans.length ? ` · ${orphans.length} orphaned` : ""}` : undefined}
      loading={loading}
      refreshing={refreshing}
      fetched_at={fetched_at}
      error={error ?? failures.error}
      onRefresh={() => {
        refresh();
        failures.refresh();
      }}
      actions={clearActions({ ...resource, is_terminal }).map((a) => (
        <button key={a.label} type="button" style={actionButtonStyle} onClick={() => open_clear({ ...a.request, expected: data?.length })}>
          {a.label}
        </button>
      ))}
    >
      {data && count === 0 && <p style={emptyStyle}>(empty)</p>}
      {data && data.length > 0 && (
        <div onClick={clickRowButton}>
          <DataTable
            columns={columns}
            data={data}
            className={CLICKABLE_ROWS}
            initialState={{ sorting: [{ id: "at", desc: true }] }}
            hidePagination={data.length <= PAGE_SIZE}
            pageSize={PAGE_SIZE}
            size="sm"
          />
        </div>
      )}
      {orphans.length > 0 && (
        <>
          <h3 style={sectionTitleStyle}>Orphaned</h3>
          <p style={sectionHintStyle}>{"No pointer.json: not a workpiece, so it can't be opened or cleared. A row opens its error file."}</p>
          <div onClick={clickRowButton}>
            <DataTable
              columns={orphan_columns}
              data={orphans}
              className={CLICKABLE_ROWS}
              initialState={{ sorting: [{ id: "at", desc: true }] }}
              hidePagination={orphans.length <= PAGE_SIZE}
              pageSize={PAGE_SIZE}
            size="sm"
            />
          </div>
        </>
      )}
    </ViewLayout>
  );
}

const PAGE_SIZE = 30;

/**
 * @param {string} ts
 */
function utc(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/**
 * @param {string} ts
 */
function formatTs(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

/** @type {React.CSSProperties} */
const idButtonStyle = {
  padding: 0,
  background: "transparent",
  border: "none",
  font: "inherit",
  fontFamily: "ui-monospace, Menlo, monospace",
  color: "var(--accent)",
  cursor: "pointer",
  textAlign: "left",
};

/** @type {React.CSSProperties} */
const mutedStyle = { color: "var(--muted-foreground)" };

/** @type {React.CSSProperties} */
const emptyStyle = {
  color: "var(--muted-foreground)",
  fontStyle: "italic",
};

/** @type {React.CSSProperties} */
const errorStyle = {
  display: "block",
  maxWidth: 360,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontFamily: "ui-monospace, Menlo, monospace",
  fontSize: 12,
  color: "#ff7b72",
};

/** @type {React.CSSProperties} */
const sectionTitleStyle = {
  margin: "24px 0 4px",
  fontSize: 12,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#e3b341",
  fontWeight: 500,
};

/** @type {React.CSSProperties} */
const sectionHintStyle = { margin: "0 0 8px", fontSize: 12, color: "var(--muted-foreground)" };

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
