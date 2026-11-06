// @ts-check
"use client";

import { explainError } from "@/lib/explain-error";

/**
 * What failed and what to do about it, with the original text one click away.
 *
 * @param {{ error: unknown, computer: string, onRetry?: () => void }} props
 * @returns {React.JSX.Element}
 */
export default function ErrorNote({ error, computer, onRetry }) {
  const { title, hint, details } = explainError(error, computer);
  return (
    <div style={boxStyle}>
      <div style={titleStyle}>{title}</div>
      <div style={hintStyle}>{hint}</div>
      <details style={detailsStyle}>
        <summary style={{ cursor: "pointer" }}>Details</summary>
        <pre style={preStyle}>{details}</pre>
      </details>
      {onRetry && (
        <button type="button" style={retryStyle} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** @type {React.CSSProperties} */
const boxStyle = {
  marginTop: 12,
  padding: 12,
  borderRadius: 6,
  border: "1px solid rgba(255, 123, 114, 0.4)",
  background: "rgba(255, 123, 114, 0.08)",
};

/** @type {React.CSSProperties} */
const titleStyle = { fontSize: 14, fontWeight: 600, color: "#ff7b72" };

/** @type {React.CSSProperties} */
const hintStyle = { marginTop: 4, fontSize: 13, lineHeight: 1.5 };

/** @type {React.CSSProperties} */
const detailsStyle = { marginTop: 8, fontSize: 12, color: "var(--muted-foreground)" };

/** @type {React.CSSProperties} */
const preStyle = { margin: "6px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 11 };

/** @type {React.CSSProperties} */
const retryStyle = {
  marginTop: 10,
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--foreground)",
  padding: "4px 10px",
  borderRadius: 4,
  fontSize: 12,
  cursor: "pointer",
};
