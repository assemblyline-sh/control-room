// @ts-check
"use client";

import { useEffect, useState } from "react";
import OrchestratorLink from "@/components/OrchestratorLink";

/**
 * Shared scaffold for tab content. Header (title + an orchestrator link when
 * given + sub + data age + refresh) and a
 * scrollable body. View components pass their own body via children and
 * route loading/error/refresh through the standard slots.
 * `fetched_at` is when the shown data was read from the host: data comes
 * from a cache (lib/use-fetcher.js), so the header says how old it is.
 *
 * @param {{
 *   title: string,
 *   link?: string | null,
 *   sub?: string,
 *   loading?: boolean,
 *   refreshing?: boolean,
 *   fetched_at?: number | null,
 *   error?: string | null,
 *   onRefresh?: () => void,
 *   actions?: React.ReactNode,
 *   children: React.ReactNode,
 * }} props
 * @returns {React.JSX.Element}
 */
export default function ViewLayout({ title, link, sub, loading, refreshing, fetched_at, error, onRefresh, actions, children }) {
  return (
    <div style={rootStyle}>
      <header style={headerStyle}>
        <div style={{ minWidth: 0 }}>
          <h2 style={titleStyle}>
            {title}
            {link && <OrchestratorLink href={link} label={title} />}
          </h2>
          {sub && <p style={subStyle}>{sub}</p>}
        </div>
        <div style={headerRightStyle}>
          <div style={actionsStyle}>
            {actions}
            {onRefresh && (
              <button
                type="button"
                style={refreshStyle}
                onClick={onRefresh}
                disabled={loading || refreshing}
              >
                {loading || refreshing ? "…" : "Refresh"}
              </button>
            )}
          </div>
          {fetched_at != null && <DataAge fetched_at={fetched_at} refreshing={refreshing} failed={Boolean(error)} />}
        </div>
      </header>
      {error && <div style={errorStyle}>{error}</div>}
      <div style={bodyStyle}>{children}</div>
    </div>
  );
}

/**
 * "Updated 12s ago" — says when the data was read, not that nothing has
 * changed since. Ticks on its own so the view doesn't re-render.
 *
 * @param {{ fetched_at: number, refreshing?: boolean, failed: boolean }} props
 * @returns {React.JSX.Element}
 */
function DataAge({ fetched_at, refreshing, failed }) {
  const [now, set_now] = useState(() => Date.now());
  useEffect(() => {
    set_now(Date.now());
    const id = setInterval(() => set_now(Date.now()), 5000);
    return () => clearInterval(id);
  }, [fetched_at]);

  const secs = Math.max(0, Math.floor((now - fetched_at) / 1000));
  const age =
    secs < 10 ? "just now" : secs < 60 ? `${secs}s ago` : secs < 3600 ? `${Math.floor(secs / 60)}m ago` : `${Math.floor(secs / 3600)}h ago`;
  const text = refreshing ? "Refreshing…" : `${failed ? "Refresh failed · u" : "U"}pdated ${age}`;

  return (
    <span style={failed && !refreshing ? { ...ageStyle, color: "#ff7b72" } : ageStyle} title={`Read from the host at ${new Date(fetched_at).toLocaleString()}`}>
      {text}
    </span>
  );
}

/** @type {React.CSSProperties} */
const ageStyle = {
  fontSize: 11,
  color: "var(--muted-foreground)",
  whiteSpace: "nowrap",
};

/** @type {React.CSSProperties} */
const rootStyle = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

/** @type {React.CSSProperties} */
const headerStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  padding: "16px 20px 12px",
  borderBottom: "1px solid var(--border)",
};

/** @type {React.CSSProperties} */
const titleStyle = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
};

/** @type {React.CSSProperties} */
const subStyle = {
  margin: "4px 0 0",
  fontSize: 12,
  color: "var(--muted-foreground)",
};

/** @type {React.CSSProperties} */
const headerRightStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: 4,
  flexShrink: 0,
};

/** @type {React.CSSProperties} */
const actionsStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexShrink: 0,
};

/** @type {React.CSSProperties} */
const refreshStyle = {
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
const errorStyle = {
  padding: "8px 20px",
  background: "rgba(255, 123, 114, 0.1)",
  color: "#ff7b72",
  fontSize: 12,
  borderBottom: "1px solid var(--border)",
};

/** @type {React.CSSProperties} */
const bodyStyle = {
  flex: 1,
  overflow: "auto",
  padding: "16px 20px",
};
