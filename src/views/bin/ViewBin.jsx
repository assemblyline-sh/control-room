// @ts-check
"use client";

import { useState } from "react";
import { clearActions } from "@/lib/clear-actions";
import { plural } from "@/lib/format";
import { useClear } from "@/state/clear-context";
import { useTabs } from "@/state/tabs-context";
import { useBinData, useBinFailures, useIsTerminal } from "@/views/bin/useBinData";
import ViewLayout from "@/components/ViewLayout";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 * @typedef {"id" | "error" | "event" | "at"} SortCol
 */

/**
 * Bin view: workpiece list with their last log event. Each row click opens
 * the workpiece as a tab; the headers sort, newest first by default. A
 * failed bin adds each workpiece's error key and lists orphaned folders,
 * which open their error file. A done bin or a terminal output gets Clear….
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
  const [sort, set_sort] = useState(/** @type {{ col: SortCol, desc: boolean }} */ ({ col: "at", desc: true }));

  /** @type {Map<string, import("@/lib/tauri-api").Failure>} */
  const by_id = new Map((failures.data ?? []).filter((f) => !f.orphan).map((f) => [f.id, f]));
  const orphans = (failures.data ?? []).filter((f) => f.orphan);
  const is_failed = bin === "failed";
  /** @type {Record<SortCol, (row: import("@/lib/tauri-api").MonitorWorkpieceRow) => string>} */
  const sort_value = {
    id: (row) => row.id,
    error: (row) => by_id.get(row.id)?.key ?? "",
    event: (row) => row.last_event?.event ?? "",
    at: (row) => row.last_event?.ts ?? "",
  };
  const value = sort_value[sort.col];
  // The viewer's zone, which At is shown in — e.g. "IST" or "GMT+5:30".
  const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts().find((p) => p.type === "timeZoneName")?.value ?? "local";
  // Blanks (no log yet, no error) sort last either way.
  const rows = [...(data ?? [])].sort((a, b) => {
    const [x, y] = [value(a), value(b)];
    if (!x || !y) return x ? -1 : y ? 1 : 0;
    return sort.desc ? y.localeCompare(x, undefined, { numeric: true }) : x.localeCompare(y, undefined, { numeric: true });
  });

  /**
   * @param {SortCol} col
   * @param {string} label
   */
  const header = (col, label) => (
    <th
      style={{ ...thStyle, cursor: "pointer" }}
      onClick={() => set_sort({ col, desc: sort.col === col ? !sort.desc : col === "at" })}
      title={`Sort by ${col === "at" ? "time" : label.toLowerCase()}`}
    >
      {label} {sort.col === col ? (sort.desc ? "▾" : "▴") : ""}
    </th>
  );

  /** @param {string} workpiece */
  const openWp = (workpiece) =>
    dispatch({ type: "open_tab", resource: { type: "workpiece", host, factory, line, station, bin, workpiece } });

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
      {data && count > 0 && (
        <table style={tableStyle}>
          <thead>
            <tr>
              {header("id", "Workpiece")}
              {is_failed && header("error", "Error")}
              {header("event", "Last event")}
              {header("at", `At (${zone})`)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={trStyle} onClick={() => openWp(row.id)}>
                <td style={tdMonoStyle}>{row.id}</td>
                {is_failed && (
                  <td style={tdErrorStyle} title={by_id.get(row.id)?.message ?? undefined}>
                    {by_id.get(row.id)?.key ?? <span style={mutedStyle}>…</span>}
                  </td>
                )}
                <td style={tdStyle}>
                  {row.last_event?.event ?? <span style={mutedStyle}>—</span>}
                </td>
                <td style={tdStyle} title={row.last_event ? utc(row.last_event.ts) : undefined}>
                  {row.last_event ? (
                    `${row.last_event.station} · ${formatTs(row.last_event.ts)}`
                  ) : (
                    <span style={mutedStyle}>—</span>
                  )}
                </td>
              </tr>
            ))}
            {orphans.map((f) => (
              <tr
                key={f.dir}
                style={trStyle}
                title="No pointer.json: not a workpiece, so it can't be opened or cleared. Opens its error file."
                onClick={() =>
                  dispatch({
                    type: "open_tab",
                    resource: { type: "file", host, factory, file_path: `temp/stations/${f.dir}/${f.message === null ? "error.txt" : "error.json"}` },
                  })
                }
              >
                <td style={tdMonoStyle}>
                  {f.id} <span style={orphanStyle}>⚠ orphaned</span>
                </td>
                <td style={tdErrorStyle} title={f.message ?? undefined}>
                  {f.key}
                </td>
                <td style={tdStyle}>
                  <span style={mutedStyle}>—</span>
                </td>
                <td style={tdStyle} title={f.failed_at ? utc(f.failed_at) : undefined}>{f.failed_at ? formatTs(f.failed_at) : <span style={mutedStyle}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewLayout>
  );
}

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
const trStyle = { cursor: "pointer" };

/** @type {React.CSSProperties} */
const tdStyle = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
};

/** @type {React.CSSProperties} */
const tdMonoStyle = {
  ...tdStyle,
  fontFamily: "ui-monospace, Menlo, monospace",
  color: "var(--accent)",
};

/** @type {React.CSSProperties} */
const mutedStyle = { color: "var(--muted-foreground)" };

/** @type {React.CSSProperties} */
const emptyStyle = {
  color: "var(--muted-foreground)",
  fontStyle: "italic",
};

/** @type {React.CSSProperties} */
const tdErrorStyle = {
  ...tdStyle,
  maxWidth: 360,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontFamily: "ui-monospace, Menlo, monospace",
  fontSize: 12,
  color: "#ff7b72",
};

/** @type {React.CSSProperties} */
const orphanStyle = { marginLeft: 6, color: "#e3b341", fontFamily: "inherit", fontSize: 11 };

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
