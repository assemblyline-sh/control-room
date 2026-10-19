// @ts-check
"use client";

import { useMemo } from "react";
import { factoryOrchestrator, listLines, openUrl } from "@/lib/tauri-api";
import { useFetcher } from "@/lib/use-fetcher";
import { useTabs } from "@/state/tabs-context";

/**
 * Specialized renderer for `log.jsonl` files. Parses each line as a
 * `{ts, station, wr, event}` event and shows a 4-column table where:
 *   - `station` opens that station as a new tab (looked up by walking the
 *     line list to find which line owns the station)
 *   - `wr` opens the orchestrator's work-record page in the OS browser, using
 *     the factory's `.orchestrator/factory.json`; a `local-` run has no page
 *
 * When line or orchestrator info is unavailable the corresponding column
 * renders as plain text instead of a link — the view never breaks if the
 * factory repo is misconfigured.
 *
 * @param {{ host: string, factory: string, content: string }} props
 * @returns {React.JSX.Element}
 */
export default function LogJsonlTable({ host, factory, content }) {
  const { dispatch } = useTabs();
  const events = useMemo(() => parseEvents(content), [content]);

  const lines = useFetcher(["listLines", host, factory], () => listLines(host, factory));
  const orchestrator = useFetcher(["factoryOrchestrator", host, factory], () => factoryOrchestrator(host, factory));

  // station → line map built from the floor data.
  const station_to_line = useMemo(() => {
    /** @type {Map<string, string>} */
    const m = new Map();
    for (const row of lines.data ?? []) {
      for (const s of row.stations) m.set(s, row.code);
    }
    return m;
  }, [lines.data]);

  const orchestrator_base = orchestrator.data ?? null;

  /** @param {string} station */
  const openStation = (station) => {
    const line = station_to_line.get(station);
    if (!line) return;
    dispatch({
      type: "open_tab",
      resource: { type: "station", host, factory, line, station },
    });
  };

  /** @param {string} wr */
  const openWorkRecord = (wr) => {
    if (!orchestrator_base) return;
    openUrl(`${orchestrator_base}/work-records/${encodeURIComponent(wr)}`).catch(() => {});
  };

  if (events.length === 0) {
    return <p style={emptyStyle}>(no events)</p>;
  }

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>Timestamp</th>
          <th style={thStyle}>Station</th>
          <th style={thStyle}>Work record</th>
          <th style={thStyle}>Event</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e, i) => (
          <tr key={`${e.ts}-${i}`}>
            <td style={tdTsStyle}>{formatTs(e.ts)}</td>
            <td style={tdMonoStyle}>
              {e.station ? (
                station_to_line.has(e.station) ? (
                  <button
                    type="button"
                    style={linkStyle}
                    onClick={() => openStation(e.station)}
                  >
                    {e.station}
                  </button>
                ) : (
                  e.station
                )
              ) : (
                <span style={mutedStyle}>—</span>
              )}
            </td>
            <td style={tdMonoStyle}>
              {e.wr ? (
                orchestrator_base && !e.wr.startsWith("local-") ? (
                  <button
                    type="button"
                    style={linkStyle}
                    onClick={() => openWorkRecord(e.wr)}
                    title={`Open in orchestrator`}
                  >
                    {e.wr}
                  </button>
                ) : (
                  e.wr
                )
              ) : (
                <span style={mutedStyle}>—</span>
              )}
            </td>
            <td style={tdStyle}>{e.event ?? <span style={mutedStyle}>—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * @param {string} content
 * @returns {Array<{ ts: string, station: string, wr: string, event: string }>}
 */
function parseEvents(content) {
  /** @type {Array<{ ts: string, station: string, wr: string, event: string }>} */
  const out = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      out.push({
        ts: String(obj.ts ?? ""),
        station: String(obj.station ?? ""),
        wr: String(obj.wr ?? ""),
        event: String(obj.event ?? ""),
      });
    } catch {
      // skip malformed lines silently — matches readWorkpieceLog
    }
  }
  return out;
}

/**
 * @param {string} ts
 */
function formatTs(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
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
const tdStyle = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "top",
};

/** @type {React.CSSProperties} */
const tdMonoStyle = {
  ...tdStyle,
  fontFamily: "ui-monospace, Menlo, monospace",
};

/** @type {React.CSSProperties} */
const tdTsStyle = {
  ...tdStyle,
  whiteSpace: "nowrap",
  color: "var(--muted-foreground)",
  fontVariantNumeric: "tabular-nums",
};

/** @type {React.CSSProperties} */
const linkStyle = {
  background: "transparent",
  border: "none",
  padding: 0,
  color: "var(--accent)",
  fontFamily: "inherit",
  fontSize: "inherit",
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
