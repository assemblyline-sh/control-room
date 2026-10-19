// @ts-check
"use client";

import { useMemo, useState } from "react";
import { useFailuresData } from "@/views/failures/useFailuresData";
import { formatDateTime, plural } from "@/lib/format";
import { useConfig } from "@/state/config-context";
import { useTabs } from "@/state/tabs-context";
import ViewLayout from "@/components/ViewLayout";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 * @typedef {import("@/lib/tauri-api").Failure} Failure
 * @typedef {Failure & { factory: string }} Row
 * @typedef {{ key: string, orphan: boolean, rows: Row[], last: string | null }} Group
 */

const ORPHAN_KEY = "Orphaned — no pointer.json";
const FIRST_ROWS = 5;
const LEVELS = /** @type {const} */ (["factory", "line", "station"]);

/**
 * Failed workpieces on a host (or one factory): WHERE they are, rolled up by
 * factory / line / station, and ERRORS grouped by al-control's error key.
 * Orphaned failed folders (no pointer.json) are one group of their own.
 *
 * @param {{ resource: Extract<ResourceId, { type: 'failures' }> }} props
 */
export default function ViewFailures({ resource }) {
  const { host } = useConfig();
  const { dispatch } = useTabs();
  const [factory, set_factory] = useState(resource.factory ?? "");
  const [level, set_level] = useState(/** @type {typeof LEVELS[number]} */ ("factory"));
  const [where_filter, set_where_filter] = useState(/** @type {string | null} */ (null));
  const [open_groups, set_open_groups] = useState(() => new Set(resource.error_key ? [resource.error_key] : []));
  const [show_all, set_show_all] = useState(() => new Set());

  const { data, loading, refreshing, fetched_at, error, refresh } = useFailuresData(resource.host, factory);

  /** @type {Row[]} */
  const all_rows = useMemo(
    () => (data ?? []).flatMap((w) => w.failures.map((f) => ({ ...f, factory: w.factory }))),
    [data],
  );

  /** @param {Row} r */
  const placeOf = (r) =>
    level === "factory" ? r.factory : level === "line" ? `${r.factory} / ${r.line}` : `${r.factory} / ${r.station}`;

  const where = useMemo(() => {
    /** @type {Map<string, number>} */
    const m = new Map();
    for (const r of all_rows) m.set(placeOf(r), (m.get(placeOf(r)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all_rows, level]);

  const rows = where_filter ? all_rows.filter((r) => placeOf(r) === where_filter) : all_rows;
  const groups = useMemo(() => {
    /** @type {Map<string, Group>} */
    const m = new Map();
    for (const r of rows) {
      const key = r.orphan ? ORPHAN_KEY : r.key;
      if (!m.has(key)) m.set(key, { key, orphan: r.orphan, rows: [], last: null });
      const g = /** @type {Group} */ (m.get(key));
      g.rows.push(r);
      if (r.failed_at && (!g.last || r.failed_at > g.last)) g.last = r.failed_at;
    }
    for (const g of m.values()) g.rows.sort((a, b) => (b.failed_at ?? "").localeCompare(a.failed_at ?? ""));
    return [...m.values()]
      .filter((g) => !resource.error_key || g.key === resource.error_key)
      .sort((a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key));
  }, [rows, resource.error_key]);

  const total = all_rows.length;
  const orphans = all_rows.filter((r) => r.orphan).length;
  const last = all_rows.reduce((t, r) => (r.failed_at && (!t || r.failed_at > t) ? r.failed_at : t), /** @type {string | null} */ (null));
  const distinct = new Set(all_rows.map((r) => (r.orphan ? ORPHAN_KEY : r.key))).size;
  const max_where = where[0]?.[1] ?? 1;

  /** @param {Row} r */
  const openRow = (r) => {
    if (r.orphan) {
      // No pointer.json, so no workpiece to open — its error file instead.
      const file = r.message === null ? "error.txt" : "error.json";
      dispatch({ type: "open_tab", resource: { type: "file", host: resource.host, factory: r.factory, file_path: `temp/stations/${r.dir}/${file}` } });
      return;
    }
    dispatch({
      type: "open_tab",
      resource: { type: "workpiece", host: resource.host, factory: r.factory, line: r.line, station: r.station, bin: "failed", workpiece: r.id },
    });
  };

  /** @param {Row} r */
  const openBin = (r) =>
    dispatch({
      type: "open_tab",
      resource: { type: "bin", host: resource.host, factory: r.factory, line: r.line, station: r.station, bin: "failed" },
    });

  /** @param {Set<string>} set @param {(s: Set<string>) => void} setter @param {string} key */
  const toggle = (set, setter, key) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    setter(next);
  };

  const factories_read = (data ?? []).filter((w) => !w.error).length;

  return (
    <ViewLayout
      title={`Failures · ${resource.host}`}
      sub={
        data
          ? total === 0
            ? undefined
            : `${plural(total, "failed workpiece")} · ${plural(distinct, "distinct error")}${orphans ? ` · ${orphans} orphaned` : ""} · last failure ${formatDateTime(last)}`
          : undefined
      }
      loading={loading}
      refreshing={refreshing}
      fetched_at={fetched_at}
      error={error}
      onRefresh={refresh}
      actions={
        <label style={labelStyle}>
          Factory{" "}
          <select style={selectStyle} value={factory} onChange={(e) => set_factory(e.target.value)}>
            <option value="">All</option>
            {host.factories.map((w) => (
              <option key={w.name} value={w.name}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      }
    >
      {(data ?? [])
        .filter((w) => w.error)
        .map((w) => (
          <p key={w.factory} style={warnStyle}>
            {w.factory}: {w.error} — skipped
          </p>
        ))}
      {resource.error_key && (
        <p style={mutedStyle}>
          Only <code>{resource.error_key}</code>.{" "}
          <button type="button" style={linkStyle} onClick={() => dispatch({ type: "open_tab", resource: { type: "failures", host: resource.host, factory: resource.factory } })}>
            Show every error
          </button>
        </p>
      )}
      {data && total === 0 && <p style={mutedStyle}>No failed workpieces on {plural(factories_read, "factory")}.</p>}

      {total > 0 && (
        <>
          <div style={sectionHeadStyle}>
            <h3 style={sectionTitleStyle}>Where</h3>
            <span style={segmentedStyle}>
              group by
              {LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  style={{ ...segmentStyle, ...(level === l ? segmentOnStyle : {}) }}
                  onClick={() => {
                    set_level(l);
                    set_where_filter(null);
                  }}
                >
                  {l}
                </button>
              ))}
            </span>
          </div>
          <div style={{ marginBottom: 20 }}>
            {where.map(([place, n]) => (
              <div
                key={place}
                style={{ ...whereRowStyle, ...(where_filter === place ? whereOnStyle : {}) }}
                onClick={() => set_where_filter(where_filter === place ? null : place)}
                title="Show only these below"
              >
                <span style={wherePlaceStyle}>{place}</span>
                <span style={whereCountStyle}>{n.toLocaleString()}</span>
                <span style={barTrackStyle}>
                  <span style={{ ...barStyle, width: `${Math.max(1, (n / max_where) * 100)}%` }} />
                </span>
              </div>
            ))}
          </div>

          <div style={sectionHeadStyle}>
            <h3 style={sectionTitleStyle}>Errors</h3>
            <span style={mutedStyle}>
              filter:{" "}
              {where_filter ? (
                <button type="button" style={chipStyle} onClick={() => set_where_filter(null)} title="Clear the filter">
                  {where_filter} ✕
                </button>
              ) : (
                "none"
              )}
            </span>
          </div>
          {groups.map((g) => {
            const is_open = open_groups.has(g.key);
            const places = summarizePlaces(g.rows, !factory);
            const shown = show_all.has(g.key) ? g.rows : g.rows.slice(0, FIRST_ROWS);
            return (
              <div key={g.key} style={groupStyle}>
                <div style={groupHeadStyle} onClick={() => toggle(open_groups, set_open_groups, g.key)}>
                  <span style={chevronStyle}>{is_open ? "▼" : "▶"}</span>
                  <span style={groupCountStyle}>{g.rows.length.toLocaleString()}</span>
                  <span style={{ ...groupKeyStyle, ...(g.orphan ? orphanKeyStyle : {}) }} title={g.key}>
                    {g.orphan ? `⚠ ${g.key}` : g.key}
                  </span>
                  <span style={groupWhereStyle} title={places}>
                    {places}
                  </span>
                  <span style={groupWhenStyle}>{formatDateTime(g.last)}</span>
                </div>
                {is_open && (
                  <div style={{ paddingLeft: 22 }}>
                    {g.orphan && (
                      <p style={mutedStyle}>
                        Failed folders with no pointer.json — not workpieces, so nothing else lists them and Clear
                        can&apos;t remove them. Inspect or remove them on the host.
                      </p>
                    )}
                    <table style={tableStyle}>
                      <tbody>
                        {shown.map((r) => (
                          <tr key={`${r.factory}/${r.dir}`}>
                            <td style={tdIdStyle}>
                              <button type="button" style={linkStyle} onClick={() => openRow(r)} title={r.orphan ? "Open its error file" : "Open the workpiece"}>
                                {r.id}
                              </button>
                            </td>
                            <td style={tdStyle}>
                              <button type="button" style={linkStyle} onClick={() => openBin(r)} title="Open the failed bin">
                                {factory ? r.station : `${r.factory}/${r.station}`}
                              </button>
                            </td>
                            <td style={tdWhenStyle}>{formatDateTime(r.failed_at)}</td>
                            <td style={tdMessageStyle} title={r.message ?? "(no error.json)"}>
                              {g.orphan ? `${r.key} — ` : ""}
                              {(r.message ?? "(no error.json)").split("\n")[0]}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {g.rows.length > FIRST_ROWS && !show_all.has(g.key) && (
                      <button type="button" style={linkStyle} onClick={() => toggle(show_all, set_show_all, g.key)}>
                        … {plural(g.rows.length - FIRST_ROWS, "more")} — show all
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </ViewLayout>
  );
}

/**
 * "factory-alex/EM2" or "factory-actual/TU1 ×4, TA1 ×1".
 * @param {Row[]} rows
 * @param {boolean} with_factory
 */
function summarizePlaces(rows, with_factory) {
  /** @type {Map<string, number>} */
  const m = new Map();
  for (const r of rows) {
    const p = with_factory ? `${r.factory}/${r.station}` : r.station;
    m.set(p, (m.get(p) ?? 0) + 1);
  }
  if (m.size === 1) return [...m.keys()][0];
  return [...m]
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${p} ×${n}`)
    .join(", ");
}

/** @type {React.CSSProperties} */
const labelStyle = { fontSize: 12, color: "var(--muted-foreground)" };

/** @type {React.CSSProperties} */
const selectStyle = {
  padding: "3px 6px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--foreground)",
  fontSize: 12,
};

/** @type {React.CSSProperties} */
const mutedStyle = { margin: "4px 0", color: "var(--muted-foreground)", fontSize: 12 };

/** @type {React.CSSProperties} */
const warnStyle = { margin: "0 0 8px", color: "#e3b341", fontSize: 12 };

/** @type {React.CSSProperties} */
const linkStyle = {
  padding: 0,
  background: "transparent",
  border: "none",
  color: "var(--accent)",
  fontSize: "inherit",
  fontFamily: "inherit",
  cursor: "pointer",
  textAlign: "left",
};

/** @type {React.CSSProperties} */
const sectionHeadStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", margin: "4px 0 8px" };

/** @type {React.CSSProperties} */
const sectionTitleStyle = {
  margin: 0,
  fontSize: 12,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--muted-foreground)",
  fontWeight: 500,
};

/** @type {React.CSSProperties} */
const segmentedStyle = { display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--muted-foreground)" };

/** @type {React.CSSProperties} */
const segmentStyle = {
  padding: "2px 8px",
  background: "transparent",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
  borderRadius: 4,
  color: "var(--muted-foreground)",
  fontSize: 12,
  cursor: "pointer",
};

/** @type {React.CSSProperties} */
const segmentOnStyle = { color: "var(--foreground)", borderColor: "var(--accent)" };

/** @type {React.CSSProperties} */
const whereRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(140px, 260px) 60px 1fr",
  alignItems: "center",
  gap: 12,
  padding: "3px 6px",
  borderRadius: 4,
  fontSize: 13,
  cursor: "pointer",
};

/** @type {React.CSSProperties} */
const whereOnStyle = { background: "rgba(88, 166, 255, 0.12)" };

/** @type {React.CSSProperties} */
const wherePlaceStyle = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

/** @type {React.CSSProperties} */
const whereCountStyle = { textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#ff7b72", fontWeight: 600 };

/** @type {React.CSSProperties} */
const barTrackStyle = { display: "block", height: 8 };

/** @type {React.CSSProperties} */
const barStyle = { display: "block", height: 8, background: "rgba(255, 123, 114, 0.6)", borderRadius: 2 };

/** @type {React.CSSProperties} */
const chipStyle = {
  padding: "1px 8px",
  background: "rgba(88, 166, 255, 0.12)",
  border: "1px solid var(--accent)",
  borderRadius: 10,
  color: "var(--foreground)",
  fontSize: 12,
  cursor: "pointer",
};

/** @type {React.CSSProperties} */
const groupStyle = { borderBottom: "1px solid var(--border)" };

/** @type {React.CSSProperties} */
const groupHeadStyle = {
  display: "grid",
  gridTemplateColumns: "14px 52px minmax(0, 2fr) minmax(0, 1.4fr) 150px",
  alignItems: "center",
  gap: 10,
  padding: "8px 4px",
  fontSize: 13,
  cursor: "pointer",
};

/** @type {React.CSSProperties} */
const chevronStyle = { color: "var(--muted-foreground)", fontSize: 9 };

/** @type {React.CSSProperties} */
const groupCountStyle = { textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 };

/** @type {React.CSSProperties} */
const groupKeyStyle = { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

/** @type {React.CSSProperties} */
const orphanKeyStyle = { color: "#e3b341", fontFamily: "inherit", fontSize: 13 };

/** @type {React.CSSProperties} */
const groupWhereStyle = { color: "var(--muted-foreground)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

/** @type {React.CSSProperties} */
const groupWhenStyle = { color: "var(--muted-foreground)", fontSize: 12, textAlign: "right", whiteSpace: "nowrap" };

/** @type {React.CSSProperties} */
const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: 12, margin: "0 0 8px", tableLayout: "fixed" };

/** @type {React.CSSProperties} */
const tdStyle = { padding: "4px 8px", borderTop: "1px solid var(--border)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

/** @type {React.CSSProperties} */
const tdIdStyle = { ...tdStyle, width: "28%", fontFamily: "ui-monospace, Menlo, monospace" };

/** @type {React.CSSProperties} */
const tdWhenStyle = { ...tdStyle, width: 150, color: "var(--muted-foreground)" };

/** @type {React.CSSProperties} */
const tdMessageStyle = { ...tdStyle, width: "40%", color: "var(--muted-foreground)" };
