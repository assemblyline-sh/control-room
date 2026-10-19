// @ts-check
"use client";

import { openUrl, showError } from "@/lib/tauri-api";

/**
 * A small ↗ that opens `href` on the orchestrator in the browser. Stops the
 * click there, so it can sit inside a clickable row or cell.
 *
 * @param {{ href: string, label?: string }} props
 * @returns {React.JSX.Element}
 */
export default function OrchestratorLink({ href, label }) {
  return (
    <button
      type="button"
      style={linkStyle}
      title={`Open on the orchestrator — ${href}`}
      aria-label={`Open ${label ?? href} on the orchestrator`}
      onClick={(e) => {
        e.stopPropagation();
        openUrl(href).catch(showError);
      }}
    >
      ↗
    </button>
  );
}

/** @type {React.CSSProperties} */
const linkStyle = {
  marginLeft: 6,
  padding: "0 3px",
  background: "transparent",
  border: "none",
  color: "var(--muted-foreground)",
  fontSize: "0.85em",
  lineHeight: 1,
  cursor: "pointer",
  verticalAlign: "baseline",
};
