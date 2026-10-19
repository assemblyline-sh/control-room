// @ts-check
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDay, plural } from "@/lib/format";
import { useClear } from "@/state/clear-context";
import { useConfig } from "@/state/config-context";
import { useTabs } from "@/state/tabs-context";
import { useHousekeepingData } from "@/views/housekeeping/useHousekeepingData";
import ViewLayout from "@/components/ViewLayout";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 * @typedef {import("@/lib/tauri-api").ClearGroup} ClearGroup
 * @typedef {import("@/lib/tauri-api").ClearFilter} ClearFilter
 * @typedef {{ code: string, groups: ClearGroup[] }} LineNode
 * @typedef {{ factory: string, error: string | null, has_keep_list: boolean, lines: LineNode[] }} FactoryNode
 */

const AGES = [null, 1, 7, 14, 30, 60, 90, 180, 365];

/**
 * Done and finished workpieces as a factory → line → bin tree, with a Clear…
 * on every row, checkboxes for a mixed selection, and Clear all. Every clear
 * goes through the shared dialog (state/clear-context.jsx), which re-plans
 * before deleting. Kept and conveyor-drained bins stay visible, unselectable.
 *
 * @param {{ resource: Extract<ResourceId, { type: 'housekeeping' }> }} props
 */
export default function ViewHousekeeping({ resource }) {
  const { host } = useConfig();
  const { dispatch } = useTabs();
  const open_clear = useClear();
  const [factory, set_factory] = useState(resource.factory ?? "");
  const [done, set_done] = useState(true);
  const [finished, set_finished] = useState(true);
  const [older_than, set_older_than] = useState(/** @type {number | null} */ (null));
  /** @type {ClearFilter} */
  const filter = { done, finished, older_than_days: older_than };
  const { data, loading, refreshing, fetched_at, error, refresh } = useHousekeepingData(resource.host, factory, filter);

  // Keys: factory, factory\0line, factory\0station\0bin.
  const [toggled, set_toggled] = useState(() => new Set());
  const [selected, set_selected] = useState(() => new Set());
  useEffect(() => set_selected(new Set()), [data]);

  /** @type {FactoryNode[]} */
  const tree = useMemo(
    () =>
      (data?.factories ?? []).map((w) => {
        /** @type {Map<string, ClearGroup[]>} */
        const by_line = new Map();
        for (const g of w.groups) {
          if (!by_line.has(g.line)) by_line.set(g.line, []);
          /** @type {ClearGroup[]} */ (by_line.get(g.line)).push(g);
        }
        return { factory: w.factory, error: w.error, has_keep_list: w.has_keep_list, lines: [...by_line].map(([code, groups]) => ({ code, groups })) };
      }),
    [data],
  );

  const groups = tree.flatMap((w) => w.lines.flatMap((l) => l.groups.map((g) => ({ factory: w.factory, g }))));
  const clearable = groups.filter(({ g }) => !g.skip && g.count > 0);
  const sum = (/** @type {ClearGroup[]} */ gs) => gs.filter((g) => !g.skip).reduce((n, g) => n + g.count, 0);
  const in_done = clearable.filter(({ g }) => g.bin === "done").reduce((n, { g }) => n + g.count, 0);
  const in_finished = clearable.filter(({ g }) => g.bin === "output").reduce((n, { g }) => n + g.count, 0);
  const newer = groups.filter(({ g }) => !g.skip).reduce((n, { g }) => n + g.newer, 0);
  const total = in_done + in_finished;

  /** @param {string} factory_name @param {ClearGroup} g */
  const binKey = (factory_name, g) => `${factory_name}\0${g.station}\0${g.bin}`;
  /** @param {string} factory_name @param {ClearGroup[]} gs */
  const keysOf = (factory_name, gs) => gs.filter((g) => !g.skip && g.count > 0).map((g) => binKey(factory_name, g));

  /** @param {string[]} keys */
  const checkState = (keys) => {
    const n = keys.filter((k) => selected.has(k)).length;
    return n === 0 ? "none" : n === keys.length ? "all" : "some";
  };
  /** @param {string[]} keys */
  const toggleKeys = (keys) => {
    const next = new Set(selected);
    const on = checkState(keys) !== "all";
    keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
    set_selected(next);
  };

  const selected_groups = groups.filter(({ factory: w, g }) => selected.has(binKey(w, g)));
  const selected_count = selected_groups.reduce((n, { g }) => n + g.count, 0);

  /** @param {string} key @param {boolean} default_open */
  const isOpen = (key, default_open) => default_open !== toggled.has(key);
  /** @param {string} key */
  const flip = (key) => {
    const next = new Set(toggled);
    next.has(key) ? next.delete(key) : next.add(key);
    set_toggled(next);
  };

  const age_label = older_than ? `older than ${plural(older_than, "day")}` : "any age";

  /** @param {string} factory_name @param {ClearGroup} g */
  const openBin = (factory_name, g) =>
    dispatch({
      type: "open_tab",
      resource: { type: "bin", host: resource.host, factory: factory_name, line: g.line, station: g.station, bin: g.bin, is_terminal: g.bin === "output" },
    });

  return (
    <ViewLayout
      title={`Housekeeping · ${resource.host}`}
      sub={
        data
          ? `${in_done.toLocaleString()} in done · ${in_finished.toLocaleString()} finished · ${age_label}${newer ? ` · ${newer.toLocaleString()} newer kept` : ""}`
          : undefined
      }
      loading={loading}
      refreshing={refreshing}
      fetched_at={fetched_at}
      error={error}
      onRefresh={refresh}
    >
      <div style={filterBarStyle}>
        <span style={filterLabelStyle}>Show</span>
        <label style={checkLabelStyle}>
          <input type="checkbox" checked={done} onChange={(e) => set_done(e.target.checked)} /> Done
        </label>
        <label style={checkLabelStyle}>
          <input type="checkbox" checked={finished} onChange={(e) => set_finished(e.target.checked)} /> Finished
        </label>
        <span style={filterLabelStyle}>Older than</span>
        <select style={selectStyle} value={older_than ?? ""} onChange={(e) => set_older_than(e.target.value ? Number(e.target.value) : null)}>
          {AGES.map((a) => (
            <option key={a ?? "any"} value={a ?? ""}>
              {a ? plural(a, "day") : "any"}
            </option>
          ))}
        </select>
        <span style={filterLabelStyle}>Factory</span>
        <select style={selectStyle} value={factory} onChange={(e) => set_factory(e.target.value)}>
          <option value="">All</option>
          {host.factories.map((w) => (
            <option key={w.name} value={w.name}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      {!done && !finished && <p style={mutedStyle}>Pick done, finished, or both.</p>}

      {data && (done || finished) && (
        <table style={tableStyle}>
          <tbody>
            {tree.map((w) => {
              const w_open = isOpen(w.factory, true);
              const w_groups = w.lines.flatMap((l) => l.groups);
              const w_keys = keysOf(w.factory, w_groups);
              return [
                <tr key={w.factory} style={factoryRowStyle}>
                  <td style={checkCellStyle}>
                    <TriCheck state={checkState(w_keys)} disabled={w_keys.length === 0} onChange={() => toggleKeys(w_keys)} />
                  </td>
                  <td style={nameCellStyle}>
                    <button type="button" style={chevronStyle} onClick={() => flip(w.factory)} aria-label={w_open ? "Collapse" : "Expand"}>
                      {w_open ? "▼" : "▶"}
                    </button>
                    <button type="button" style={nameLinkStyle} onClick={() => dispatch({ type: "open_tab", resource: { type: "factory", host: resource.host, factory: w.factory } })}>
                      {w.factory}
                    </button>
                    {!w.has_keep_list && <span style={noteStyle} title="This factory has no keep list in the config. Every done bin and terminal output is clearable.">no keep list</span>}
                    {w.error && <span style={errorNoteStyle}>{w.error}</span>}
                  </td>
                  <td style={countCellStyle}>{sum(w_groups).toLocaleString()}</td>
                  <td style={oldestCellStyle}>{oldestOf(w_groups)}</td>
                  <td style={actionCellStyle}>
                    {sum(w_groups) > 0 && (
                      <button
                        type="button"
                        style={clearButtonStyle}
                        onClick={() => open_clear({ host: resource.host, scopes: [{ kind: "factory", factory: w.factory }], filter, label: w.factory, expected: sum(w_groups) })}
                      >
                        Clear…
                      </button>
                    )}
                  </td>
                </tr>,
                ...(w_open
                  ? w.lines.flatMap((l) => {
                      const l_key = `${w.factory}\0${l.code}`;
                      const l_open = isOpen(l_key, l.groups.some((g) => g.skip));
                      const l_keys = keysOf(w.factory, l.groups);
                      const l_sum = sum(l.groups);
                      return [
                        <tr key={l_key}>
                          <td style={checkCellStyle}>
                            <TriCheck state={checkState(l_keys)} disabled={l_keys.length === 0} onChange={() => toggleKeys(l_keys)} />
                          </td>
                          <td style={{ ...nameCellStyle, paddingLeft: 26 }}>
                            <button type="button" style={chevronStyle} onClick={() => flip(l_key)} aria-label={l_open ? "Collapse" : "Expand"}>
                              {l_open ? "▼" : "▶"}
                            </button>
                            <button type="button" style={nameLinkStyle} onClick={() => dispatch({ type: "open_tab", resource: { type: "line", host: resource.host, factory: w.factory, line: l.code } })}>
                              {l.code}
                            </button>
                          </td>
                          <td style={countCellStyle}>{l_sum.toLocaleString()}</td>
                          <td style={oldestCellStyle}>{oldestOf(l.groups)}</td>
                          <td style={actionCellStyle}>
                            {l_sum > 0 && (
                              <button
                                type="button"
                                style={clearButtonStyle}
                                onClick={() =>
                                  open_clear({
                                    host: resource.host,
                                    scopes: [{ kind: "line", factory: w.factory, line: l.code }],
                                    filter,
                                    label: `${w.factory} · line ${l.code}`,
                                    expected: l_sum,
                                  })
                                }
                              >
                                Clear…
                              </button>
                            )}
                          </td>
                        </tr>,
                        ...(l_open
                          ? l.groups.map((g) => {
                              const k = binKey(w.factory, g);
                              const selectable = !g.skip && g.count > 0;
                              return (
                                <tr key={k} style={g.skip ? skippedRowStyle : undefined}>
                                  <td style={checkCellStyle}>
                                    {selectable ? (
                                      <input type="checkbox" checked={selected.has(k)} onChange={() => toggleKeys([k])} />
                                    ) : (
                                      <span style={mutedStyle}>—</span>
                                    )}
                                  </td>
                                  <td style={{ ...nameCellStyle, paddingLeft: 66 }}>
                                    <button type="button" style={nameLinkStyle} onClick={() => openBin(w.factory, g)}>
                                      <span style={monoStyle}>{g.station}</span>{" "}
                                      <span style={g.bin === "output" ? finishedBinStyle : doneBinStyle}>{g.bin === "output" ? "output · finished" : "done"}</span>
                                    </button>
                                    {g.skip && (
                                      <span style={skipStyle} title={g.skip.kind === "kept" ? `Keep list in ${g.skip.config}` : `A move_files step on ${g.skip.by} reads this bin`}>
                                        {g.skip.kind === "kept" ? "🔒 kept" : `⇢ ${g.skip.target}`}
                                      </span>
                                    )}
                                    {!g.skip && g.newer > 0 && <span style={noteStyle}>+{g.newer.toLocaleString()} newer kept</span>}
                                  </td>
                                  <td style={countCellStyle}>{g.count.toLocaleString()}</td>
                                  <td style={oldestCellStyle}>{g.oldest ? `oldest ${formatDay(g.oldest)}` : ""}</td>
                                  <td style={actionCellStyle}>
                                    {selectable && (
                                      <button
                                        type="button"
                                        style={clearButtonStyle}
                                        onClick={() =>
                                          open_clear({
                                            host: resource.host,
                                            scopes: [{ kind: "bin", factory: w.factory, station: g.station, bin: g.bin }],
                                            filter: { ...filter, done: true, finished: true },
                                            label: `${w.factory} · ${g.station}/${g.bin}`,
                                            expected: g.count,
                                          })
                                        }
                                      >
                                        Clear…
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          : []),
                      ];
                    })
                  : []),
              ];
            })}
          </tbody>
        </table>
      )}
      {data && (done || finished) && groups.length === 0 && <p style={mutedStyle}>Nothing in done bins or terminal outputs ({age_label}).</p>}

      {data && total > 0 && (
        <div style={footerStyle}>
          <span style={mutedStyle}>
            {selected_groups.length > 0 ? `${plural(selected_groups.length, "bin")} selected · ${plural(selected_count, "workpiece")}` : "Nothing selected"}
          </span>
          <button
            type="button"
            style={clearButtonStyle}
            disabled={selected_groups.length === 0}
            onClick={() =>
              open_clear({
                host: resource.host,
                scopes: selected_groups.map(({ factory: w, g }) => ({ kind: "bin", factory: w, station: g.station, bin: g.bin })),
                filter: { ...filter, done: true, finished: true },
                label: `${plural(selected_groups.length, "selected bin")}`,
                expected: selected_count,
              })
            }
          >
            Clear selected…
          </button>
          <button
            type="button"
            style={dangerButtonStyle}
            onClick={() =>
              open_clear({
                host: resource.host,
                scopes: [factory ? { kind: "factory", factory } : { kind: "host" }],
                filter,
                label: factory ? `everything clearable in ${factory}` : `everything clearable on ${resource.host}`,
                expected: total,
              })
            }
          >
            {factory ? `Clear all in ${factory}…` : "Clear all on host…"}
          </button>
        </div>
      )}
    </ViewLayout>
  );
}

/** @param {ClearGroup[]} gs */
function oldestOf(gs) {
  const ts = gs.filter((g) => !g.skip && g.oldest).map((g) => /** @type {number} */ (g.oldest));
  return ts.length ? `oldest ${formatDay(Math.min(...ts))}` : "";
}

/**
 * @param {{ state: 'none' | 'some' | 'all', disabled: boolean, onChange: () => void }} props
 */
function TriCheck({ state, disabled, onChange }) {
  const ref = useRef(/** @type {HTMLInputElement | null} */ (null));
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return <input ref={ref} type="checkbox" checked={state === "all"} disabled={disabled} onChange={onChange} />;
}

/** @type {React.CSSProperties} */
const filterBarStyle = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 14, fontSize: 12 };

/** @type {React.CSSProperties} */
const filterLabelStyle = { color: "var(--muted-foreground)", marginLeft: 6 };

/** @type {React.CSSProperties} */
const checkLabelStyle = { display: "inline-flex", alignItems: "center", gap: 4 };

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
const mutedStyle = { color: "var(--muted-foreground)", fontSize: 12 };

/** @type {React.CSSProperties} */
const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: 13 };

/** @type {React.CSSProperties} */
const factoryRowStyle = { background: "rgba(255, 255, 255, 0.02)" };

/** @type {React.CSSProperties} */
const skippedRowStyle = { opacity: 0.7 };

const cell = { padding: "5px 8px", borderBottom: "1px solid var(--border)" };

/** @type {React.CSSProperties} */
const checkCellStyle = { ...cell, width: 24 };

/** @type {React.CSSProperties} */
const nameCellStyle = { ...cell, whiteSpace: "nowrap" };

/** @type {React.CSSProperties} */
const countCellStyle = { ...cell, width: 90, textAlign: "right", fontVariantNumeric: "tabular-nums" };

/** @type {React.CSSProperties} */
const oldestCellStyle = { ...cell, width: 150, color: "var(--muted-foreground)", fontSize: 12, whiteSpace: "nowrap" };

/** @type {React.CSSProperties} */
const actionCellStyle = { ...cell, width: 80, textAlign: "right" };

/** @type {React.CSSProperties} */
const chevronStyle = {
  width: 16,
  padding: 0,
  background: "transparent",
  border: "none",
  color: "var(--muted-foreground)",
  fontSize: 9,
  cursor: "pointer",
};

/** @type {React.CSSProperties} */
const nameLinkStyle = {
  padding: 0,
  background: "transparent",
  border: "none",
  color: "var(--foreground)",
  fontSize: 13,
  cursor: "pointer",
};

/** @type {React.CSSProperties} */
const monoStyle = { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 };

/** @type {React.CSSProperties} */
const doneBinStyle = { color: "#8b949e", fontSize: 12 };

/** @type {React.CSSProperties} */
const finishedBinStyle = { color: "#3fb950", fontSize: 12 };

/** @type {React.CSSProperties} */
const noteStyle = { marginLeft: 10, color: "var(--muted-foreground)", fontSize: 11 };

/** @type {React.CSSProperties} */
const errorNoteStyle = { marginLeft: 10, color: "#ff7b72", fontSize: 11 };

/** @type {React.CSSProperties} */
const skipStyle = { marginLeft: 10, color: "#e3b341", fontSize: 11 };

/** @type {React.CSSProperties} */
const clearButtonStyle = {
  padding: "3px 10px",
  background: "transparent",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
  borderRadius: 5,
  color: "var(--foreground)",
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** @type {React.CSSProperties} */
const dangerButtonStyle = { ...clearButtonStyle, borderColor: "#da3633", color: "#ff7b72" };

/** @type {React.CSSProperties} */
const footerStyle = {
  position: "sticky",
  bottom: -16,
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 12,
  padding: "10px 0",
  background: "var(--background)",
  borderTop: "1px solid var(--border)",
};
