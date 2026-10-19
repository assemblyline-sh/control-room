// @ts-check
"use client";

import { useState } from "react";
import { fetchFile, openInFinder, openTerminal, openUrl, showError } from "@/lib/tauri-api";
import { workpieceRequest } from "@/lib/clear-actions";
import { newTerminal } from "@/lib/resource-id";
import { formatBytes, formatDateTime, plural } from "@/lib/format";
import { useClear } from "@/state/clear-context";
import { useTabs } from "@/state/tabs-context";
import { useSameErrorCount, useWorkpieceData } from "@/views/workpiece/useWorkpieceData";
import ViewLayout from "@/components/ViewLayout";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 */

/**
 * Workpiece detail: resolved live position, its error (when error.json
 * exists), every file in the folder, and the event journey. In a done bin or
 * a terminal output it can be deleted. When position is null (not in any
 * live bin or done archive), surface that as a not-found state.
 *
 * @param {{ resource: Extract<ResourceId, { type: 'workpiece' }> }} props
 * @returns {React.JSX.Element}
 */
export default function ViewWorkpiece({ resource }) {
  const { data, loading, refreshing, fetched_at, error, refresh } = useWorkpieceData(
    resource.host,
    resource.factory,
    resource.workpiece,
  );
  const { dispatch } = useTabs();
  const open_clear = useClear();
  const others = useSameErrorCount(resource.host, resource.factory, data?.error_key);
  const pos = data?.position ?? null;
  const deletable = !!pos && (pos.bin === "done" || (pos.bin === "output" && pos.terminal));

  /** @param {string} file_path */
  const openFile = (file_path) =>
    dispatch({ type: "open_tab", resource: { type: "file", host: resource.host, factory: resource.factory, file_path } });

  return (
    <ViewLayout
      title={resource.workpiece}
      sub={data?.position ? positionLabel(data.position) : undefined}
      loading={loading}
      refreshing={refreshing}
      fetched_at={fetched_at}
      error={error}
      onRefresh={refresh}
      actions={
        deletable && pos ? (
          <button
            type="button"
            style={dangerButtonStyle}
            onClick={() => open_clear(workpieceRequest(resource.host, resource.factory, pos.station, pos.bin, resource.workpiece))}
          >
            Delete workpiece…
          </button>
        ) : undefined
      }
    >
      {data && !data.position && (
        <p style={emptyStyle}>Workpiece not found in any bin on this factory.</p>
      )}
      {data?.position && (
        <>
          <div style={buttonRowStyle}>
            {data.link && (
              <button
                type="button"
                style={openLinkStyle}
                onClick={() => data.link && openInFinder(data.link)}
              >
                Open folder in Finder
              </button>
            )}
            <button
              type="button"
              style={openLinkStyle}
              onClick={() => {
                const p = /** @type {import("@/lib/tauri-api").MonitorPosition} */ (data.position);
                dispatch({ type: "open_tab", resource: newTerminal(resource.host, resource.factory, `${p.station}/${p.bin}/${p.subpath || resource.workpiece}`) });
              }}
            >
              Terminal here
            </button>
            <button
              type="button"
              style={openLinkStyle}
              onClick={() => {
                const p = /** @type {import("@/lib/tauri-api").MonitorPosition} */ (data.position);
                openTerminal(resource.host, resource.factory, `${p.station}/${p.bin}/${p.subpath || resource.workpiece}`).catch(showError);
              }}
            >
              Open in Terminal app
            </button>
          </div>
          {data.error && (
            <ErrorPanel
              error={data.error}
              error_key={data.error_key}
              others={others.data}
              files={data.files.map((f) => f.name)}
              onOpenFile={(name) => openFile(`temp/stations/${pos?.station}/${pos?.bin}/${pos?.subpath || resource.workpiece}/${name}`)}
              onOpenOthers={() =>
                dispatch({
                  type: "open_tab",
                  resource: { type: "failures", host: resource.host, factory: resource.factory, error_key: data.error_key ?? undefined },
                })
              }
            />
          )}
          <h3 style={sectionTitleStyle}>Files</h3>
          <table style={{ ...tableStyle, marginBottom: 20 }}>
            <tbody>
              {data.files.map((f) => (
                <tr key={f.path}>
                  <td style={tdStyle}>
                    <button type="button" style={fileLinkStyle} onClick={() => openFile(f.path)}>
                      {f.name}
                    </button>
                  </td>
                  <td style={tdSizeStyle}>{f.size === null ? "" : formatBytes(f.size)}</td>
                  <td style={tdOpenStyle}>
                    {!TEXT_FILE.test(f.name) && (
                      <button
                        type="button"
                        style={fileLinkStyle}
                        title="Open in the default app"
                        onClick={() => fetchFile(resource.host, resource.factory, f.path).then(openInFinder).catch(showError)}
                      >
                        ↗ open
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={sectionTitleStyle}>Journey</h3>
          {data.events.length === 0 ? (
            <p style={emptyStyle}>(no log.jsonl events)</p>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Time</th>
                  <th style={thStyle}>Station</th>
                  <th style={thStyle}>Event</th>
                  <th style={thStyle}>Work record</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((ev, i) => (
                  <tr key={`${ev.ts}-${i}`}>
                    <td style={tdStyle}>{formatTs(ev.ts)}</td>
                    <td style={tdMonoStyle}>{ev.station}</td>
                    <td style={tdStyle}>{ev.event}</td>
                    <td style={tdMonoStyle}>
                      {!ev.wr ? (
                        <span style={mutedStyle}>—</span>
                      ) : ev.wr.startsWith("local-") ? (
                        <span style={mutedStyle} title="A local run — not recorded on the orchestrator">
                          {ev.wr}
                        </span>
                      ) : data.orchestrator ? (
                        <button
                          type="button"
                          style={{ ...fileLinkStyle, fontFamily: "inherit" }}
                          title={`Open ${data.orchestrator}/work-records/${ev.wr}`}
                          onClick={() => openUrl(`${data.orchestrator}/work-records/${encodeURIComponent(ev.wr ?? "")}`).catch(showError)}
                        >
                          {ev.wr} ↗
                        </button>
                      ) : (
                        <span title={'Add .orchestrator/factory.json — { "orchestrator_url": …, "org": … } — to link work records'}>{ev.wr}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </ViewLayout>
  );
}

const TEXT_FILE = /\.(json|jsonl|txt|md|csv|log|ya?ml|xml|html?)$/i;
const MESSAGE_LINES = 3;
const LINE_CHARS = 300;
const OWN_SKIP = new Set(["message", "stack", "name", "failed_at"]);

/**
 * error.json, readable: the message capped (one real error carries a 16 KB
 * HTML page), other own fields as `key: value`, the stack folded.
 *
 * @param {{
 *   error: Object<string, any>,
 *   error_key: string | null,
 *   others: number | null,
 *   files: string[],
 *   onOpenFile: (name: string) => void,
 *   onOpenOthers: () => void,
 * }} props
 */
function ErrorPanel({ error, error_key, others, files, onOpenFile, onOpenOthers }) {
  const [full, set_full] = useState(false);
  const message = String(error.message ?? "");
  const lines = message.split("\n");
  const capped = lines.length > MESSAGE_LINES || lines.some((l) => l.length > LINE_CHARS);
  const shown = full ? message : lines.slice(0, MESSAGE_LINES).map((l) => (l.length > LINE_CHARS ? `${l.slice(0, LINE_CHARS)}…` : l)).join("\n");
  const fields = Object.entries(error).filter(([k]) => !OWN_SKIP.has(k));
  const stack = typeof error.stack === "string" ? error.stack : null;

  return (
    <div style={errorPanelStyle}>
      <div style={errorHeadStyle}>
        <span style={errorTitleStyle}>Error</span>
        {error.failed_at && <span style={mutedStyle}> — failed {formatDateTime(error.failed_at)}</span>}
      </div>
      {error_key && (
        <div style={errorKeyRowStyle}>
          <code style={errorKeyStyle}>{error_key}</code>
          {others !== null && others > 0 && (
            <button type="button" style={fileLinkStyle} onClick={onOpenOthers}>
              {plural(others, "other")} with this
            </button>
          )}
        </div>
      )}
      <pre style={errorMessageStyle}>
        {error.name && !message.startsWith(error.name) ? `${error.name}: ` : ""}
        {shown}
      </pre>
      {capped && (
        <button type="button" style={fileLinkStyle} onClick={() => set_full(!full)}>
          {full ? "Show less" : `Show full message (${message.length.toLocaleString()} chars)`}
        </button>
      )}
      {fields.map(([k, v]) => {
        const text = typeof v === "string" ? v : JSON.stringify(v);
        return (
          <div key={k} style={fieldStyle}>
            <span style={mutedStyle}>{k}:</span> {text.length > LINE_CHARS ? `${text.slice(0, LINE_CHARS)}…` : text}
          </div>
        );
      })}
      {stack && (
        <details style={{ marginTop: 6 }}>
          <summary style={summaryStyle}>Stack ({stack.split("\n").length} lines)</summary>
          <pre style={stackStyle}>{stack}</pre>
        </details>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        {["error.txt", "error.json"]
          .filter((f) => files.includes(f))
          .map((f) => (
            <button key={f} type="button" style={fileLinkStyle} onClick={() => onOpenFile(f)}>
              {f}
            </button>
          ))}
      </div>
    </div>
  );
}

/**
 * @param {import("@/lib/tauri-api").MonitorPosition} p
 */
function positionLabel(p) {
  const base = `${p.line} · ${p.station}/${p.bin}`;
  if (p.anomaly) return `${base} (anomaly — only in done, no live bin)`;
  if (p.terminal && p.bin === "output") return `${base} · finished`;
  return base;
}

/**
 * @param {string} ts
 */
function formatTs(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

/** @type {React.CSSProperties} */
const buttonRowStyle = { display: "flex", gap: 8 };

/** @type {React.CSSProperties} */
const openLinkStyle = {
  padding: "6px 12px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--accent)",
  fontSize: 12,
  cursor: "pointer",
  marginBottom: 16,
};

/** @type {React.CSSProperties} */
const sectionTitleStyle = {
  margin: "0 0 8px",
  fontSize: 12,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--muted-foreground)",
  fontWeight: 500,
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
const tdStyle = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
};

/** @type {React.CSSProperties} */
const tdMonoStyle = {
  ...tdStyle,
  fontFamily: "ui-monospace, Menlo, monospace",
};

/** @type {React.CSSProperties} */
const emptyStyle = {
  color: "var(--muted-foreground)",
  fontStyle: "italic",
};

/** @type {React.CSSProperties} */
const dangerButtonStyle = {
  padding: "5px 12px",
  background: "transparent",
  border: "1px solid #da3633",
  borderRadius: 6,
  color: "#ff7b72",
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** @type {React.CSSProperties} */
const mutedStyle = { color: "var(--muted-foreground)", fontSize: 12 };

/** @type {React.CSSProperties} */
const fileLinkStyle = {
  padding: 0,
  background: "transparent",
  border: "none",
  color: "var(--accent)",
  fontSize: 12,
  cursor: "pointer",
  textAlign: "left",
};

/** @type {React.CSSProperties} */
const tdSizeStyle = { ...tdStyle, width: 90, textAlign: "right", color: "var(--muted-foreground)", fontSize: 12, fontVariantNumeric: "tabular-nums" };

/** @type {React.CSSProperties} */
const tdOpenStyle = { ...tdStyle, width: 70, textAlign: "right" };

/** @type {React.CSSProperties} */
const errorPanelStyle = {
  margin: "0 0 20px",
  padding: "10px 14px",
  borderLeft: "3px solid #ff7b72",
  background: "rgba(255, 123, 114, 0.06)",
  borderRadius: 4,
};

/** @type {React.CSSProperties} */
const errorHeadStyle = { marginBottom: 6 };

/** @type {React.CSSProperties} */
const errorTitleStyle = { fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: "#ff7b72", fontWeight: 600 };

/** @type {React.CSSProperties} */
const errorKeyRowStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 6 };

/** @type {React.CSSProperties} */
const errorKeyStyle = { fontSize: 12, color: "var(--foreground)" };

/** @type {React.CSSProperties} */
const errorMessageStyle = { margin: "0 0 4px", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace" };

/** @type {React.CSSProperties} */
const fieldStyle = { fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace", wordBreak: "break-word" };

/** @type {React.CSSProperties} */
const summaryStyle = { fontSize: 12, color: "var(--muted-foreground)", cursor: "pointer" };

/** @type {React.CSSProperties} */
const stackStyle = { margin: "6px 0 0", fontSize: 11, whiteSpace: "pre-wrap", color: "var(--muted-foreground)" };
