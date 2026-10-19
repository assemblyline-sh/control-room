// @ts-check
"use client";

import { useEffect, useState } from "react";
import { clearWorkpieces, planClear } from "@/lib/tauri-api";
import { skipReason } from "@/lib/clear-actions";
import { formatDay, plural } from "@/lib/format";
import { bumpDataEpoch } from "@/state/data-epoch";
import { useTree } from "@/state/tree-context";

/**
 * @typedef {import("@/state/clear-context").ClearRequest} ClearRequest
 * @typedef {import("@/lib/tauri-api").ClearPlan} ClearPlan
 * @typedef {import("@/lib/tauri-api").ClearGroup} ClearGroup
 */

const AGES = [null, 7, 30, 90];

/**
 * The dry run and the confirm, as a modal. Opening it plans from fresh disk
 * state; Delete removes exactly that plan's folders, one factory at a time,
 * stopping at the first refusal. The host is in the title and on the button,
 * and every row names its factory.
 *
 * @param {{ request: ClearRequest, onClose: () => void }} props
 */
export default function ClearDialog({ request, onClose }) {
  const { dispatch: tree_dispatch } = useTree();
  const [older_than, set_older_than] = useState(request.filter.older_than_days);
  const [plan, set_plan] = useState(/** @type {ClearPlan | null} */ (null));
  const [plan_error, set_plan_error] = useState(/** @type {string | null} */ (null));
  const [running, set_running] = useState(false);
  const [outcome, set_outcome] = useState(/** @type {{ ok: boolean, text: string } | null} */ (null));
  const one_workpiece = request.scopes.length === 1 && request.scopes[0].kind === "workpiece";

  useEffect(() => {
    let cancelled = false;
    set_plan(null);
    set_plan_error(null);
    planClear(request.host, request.scopes, { ...request.filter, older_than_days: older_than })
      .then((p) => !cancelled && set_plan(p))
      .catch((e) => !cancelled && set_plan_error(String(e)));
    return () => {
      cancelled = true;
    };
  }, [request, older_than]);

  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key === "Escape" && !running) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, onClose]);

  const rows = (plan?.factories ?? []).flatMap((w) =>
    w.groups.filter((g) => !g.skip && g.count > 0).map((g) => ({ factory: w.factory, g })),
  );
  const skipped = (plan?.factories ?? []).flatMap((w) =>
    w.groups.filter((g) => g.skip).map((g) => ({ factory: w.factory, g })),
  );
  const newer = (plan?.factories ?? [])
    .flatMap((w) => w.groups)
    .filter((g) => !g.skip)
    .reduce((n, g) => n + g.newer, 0);
  const failed_factories = (plan?.factories ?? []).filter((w) => w.error);
  const total = rows.reduce((n, r) => n + r.g.count, 0);

  async function runClear() {
    if (!plan) return;
    set_running(true);
    /** @type {string[]} */
    const done = [];
    let removed_total = 0;
    try {
      for (const w of plan.factories) {
        const dirs = w.groups.flatMap((g) => g.dirs);
        if (dirs.length === 0) continue;
        try {
          const { removed } = await clearWorkpieces(request.host, w.factory, dirs);
          removed_total += removed;
          done.push(`${plural(removed, "workpiece")} in ${w.factory}`);
        } catch (e) {
          const before = done.length ? `Deleted ${done.join(", ")}; ` : "Nothing deleted; ";
          set_outcome({ ok: false, text: `${before}${w.factory} refused: ${String(e)}. Stopped there.` });
          return;
        }
      }
      set_outcome({ ok: true, text: `Deleted ${plural(removed_total, "workpiece")} on ${request.host}.` });
    } finally {
      set_running(false);
      bumpDataEpoch();
      // Expanded bins in the rail reload their workpiece lists.
      for (const w of plan.factories) {
        for (const g of w.groups) {
          tree_dispatch({
            type: "invalidate",
            resource: { type: "bin", host: request.host, factory: w.factory, line: g.line, station: g.station, bin: g.bin },
          });
        }
      }
    }
  }

  const title = outcome
    ? outcome.ok
      ? "Cleared"
      : "Clear stopped"
    : !plan
      ? `Planning a clear on ${request.host}…`
      : total === 0
        ? `Nothing to delete on ${request.host}`
        : `Delete ${plural(total, "workpiece")} on ${request.host}?`;

  return (
    <div style={overlayStyle} onMouseDown={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div style={dialogStyle} role="dialog" aria-modal="true" aria-label={title}>
        <h2 style={titleStyle}>{title}</h2>
        {request.label && <p style={mutedStyle}>{request.label}</p>}

        {plan_error && <p style={errorStyle}>{plan_error}</p>}

        {outcome && <p style={outcome.ok ? okStyle : errorStyle}>{outcome.text}</p>}

        {plan && !outcome && (
          <>
            {rows.length > 0 && (
              <div style={listStyle}>
                <table style={tableStyle}>
                  <tbody>
                    {rows.map(({ factory, g }) => (
                      <tr key={`${factory}/${g.station}/${g.bin}`}>
                        <td style={tdStyle}>{factory}</td>
                        <td style={tdMonoStyle}>
                          {g.station}/{g.bin}
                          {g.bin === "output" && <span style={mutedStyle}> (finished)</span>}
                        </td>
                        <td style={tdNumStyle}>{g.count.toLocaleString()}</td>
                        <td style={tdMutedStyle}>{g.oldest ? `oldest ${formatDay(g.oldest)}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {request.expected !== undefined && request.expected !== total && (
              <p style={warnStyle}>
                The list showed {request.expected.toLocaleString()}; it&apos;s {total.toLocaleString()} now.
              </p>
            )}
            <div style={filterRowStyle}>
              <span>Filter: {describeFilter(request)}</span>
              {!one_workpiece && (
                <label style={labelStyle}>
                  Older than{" "}
                  <select
                    style={selectStyle}
                    value={older_than ?? ""}
                    onChange={(e) => set_older_than(e.target.value ? Number(e.target.value) : null)}
                  >
                    {AGES.map((a) => (
                      <option key={a ?? "any"} value={a ?? ""}>
                        {a ? `${a} days` : "any age"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {newer > 0 && <p style={mutedStyle}>Kept: {plural(newer, "workpiece")} newer than that.</p>}
            {skipped.length > 0 && (
              <div style={mutedStyle}>
                Skipped:
                <ul style={ulStyle}>
                  {skipped.map(({ factory, g }) => (
                    <li key={`${factory}/${g.station}/${g.bin}`}>
                      {factory} {g.station}/{g.bin} ({g.count.toLocaleString()}) — {skipReason(g)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {failed_factories.map((w) => (
              <p key={w.factory} style={errorStyle}>
                {w.factory}: {w.error}
              </p>
            ))}
            <p style={mutedStyle}>
              Folders are deleted permanently. Input, doing and failed bins are never touched.
            </p>
          </>
        )}

        <div style={buttonRowStyle}>
          <button type="button" style={secondaryStyle} onClick={onClose} disabled={running}>
            {outcome || (plan && total === 0) ? "Close" : "Cancel"}
          </button>
          {plan && !outcome && total > 0 && (
            <button type="button" style={dangerStyle} onClick={runClear} disabled={running}>
              {running ? "Deleting…" : `Delete ${total.toLocaleString()} on ${request.host}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** @param {ClearRequest} r */
function describeFilter(r) {
  const named = r.scopes.every((s) => s.kind === "bin" || s.kind === "workpiece");
  if (named) return r.scopes.length === 1 && r.scopes[0].kind === "workpiece" ? "this workpiece" : "the bins named";
  const { done, finished } = r.filter;
  return done && finished ? "done + finished" : done ? "done" : "finished";
}


/** @type {React.CSSProperties} */
const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
  padding: 24,
};

/** @type {React.CSSProperties} */
const dialogStyle = {
  width: "100%",
  maxWidth: 620,
  maxHeight: "90vh",
  overflow: "auto",
  padding: 20,
  background: "var(--muted)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--foreground)",
  fontSize: 13,
};

/** @type {React.CSSProperties} */
const titleStyle = { margin: "0 0 4px", fontSize: 16, fontWeight: 600 };

/** @type {React.CSSProperties} */
const mutedStyle = { margin: "6px 0", color: "var(--muted-foreground)", fontSize: 12 };

/** @type {React.CSSProperties} */
const errorStyle = { margin: "8px 0", color: "#ff7b72", fontSize: 12, whiteSpace: "pre-wrap" };

/** @type {React.CSSProperties} */
const okStyle = { margin: "8px 0", color: "#3fb950", fontSize: 13 };

/** @type {React.CSSProperties} */
const warnStyle = { margin: "6px 0", color: "#e3b341", fontSize: 12 };

/** @type {React.CSSProperties} */
const listStyle = { maxHeight: 260, overflow: "auto", margin: "12px 0 8px", border: "1px solid var(--border)", borderRadius: 6 };

/** @type {React.CSSProperties} */
const tableStyle = { width: "100%", borderCollapse: "collapse" };

/** @type {React.CSSProperties} */
const tdStyle = { padding: "5px 10px", borderBottom: "1px solid var(--border)" };

/** @type {React.CSSProperties} */
const tdMonoStyle = { ...tdStyle, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 };

/** @type {React.CSSProperties} */
const tdNumStyle = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };

/** @type {React.CSSProperties} */
const tdMutedStyle = { ...tdStyle, color: "var(--muted-foreground)", fontSize: 12, whiteSpace: "nowrap" };

/** @type {React.CSSProperties} */
const filterRowStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, margin: "8px 0", fontSize: 12 };

/** @type {React.CSSProperties} */
const labelStyle = { color: "var(--muted-foreground)" };

/** @type {React.CSSProperties} */
const selectStyle = {
  padding: "2px 6px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--foreground)",
  fontSize: 12,
};

/** @type {React.CSSProperties} */
const ulStyle = { margin: "4px 0", paddingLeft: 18 };

/** @type {React.CSSProperties} */
const buttonRowStyle = { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 };

/** @type {React.CSSProperties} */
const secondaryStyle = {
  padding: "6px 14px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--foreground)",
  fontSize: 13,
  cursor: "pointer",
};

/** @type {React.CSSProperties} */
const dangerStyle = {
  padding: "6px 14px",
  background: "#da3633",
  border: "none",
  borderRadius: 6,
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
