// @ts-check
"use client";

import { useNodeCounts } from "@/state/counts-store";

/**
 * done / failed / output for a factory, line or station row (sums across
 * the stations below it); the workpiece count for a bin row. Live — see
 * counts-store.js.
 *
 * Colours, when non-zero: failed red (needs attention), output green
 * (work produced), done grey (archive receipts — history, not work).
 *
 * @param {{ resource: import("@/lib/resource-id").ResourceId }} props
 * @returns {React.JSX.Element | null}
 */
export default function CountsBadge({ resource }) {
  const c = useNodeCounts(resource);
  if (c === null) return null;

  if (typeof c === "number") {
    const bin = resource.type === "bin" ? resource.bin : "";
    return <span style={{ ...badgeStyle, ...(c > 0 ? BIN_STYLE[bin] : {}) }}>{compact(c)}</span>;
  }

  const where = resource.type === "station" ? "" : " (sum of its stations)";
  return (
    <span style={badgeStyle} title={`${c.done} done · ${c.failed} failed · ${c.output} in output${where}`}>
      <span style={c.done > 0 ? doneStyle : undefined}>{compact(c.done)}</span>/
      <span style={c.failed > 0 ? failedStyle : undefined}>{compact(c.failed)}</span>/
      <span style={c.output > 0 ? outputStyle : undefined}>{compact(c.output)}</span>
    </span>
  );
}

/** @param {number} n */
function compact(n) {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n / 1000)}k`;
}

/** @type {React.CSSProperties} */
const badgeStyle = {
  marginLeft: "auto",
  paddingLeft: 8,
  fontSize: 11,
  color: "var(--muted-foreground)",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

/** @type {React.CSSProperties} */
const failedStyle = { color: "#ff7b72", fontWeight: 600 };

/** @type {React.CSSProperties} */
const outputStyle = { color: "#3fb950" };

/** @type {React.CSSProperties} */
const doneStyle = { color: "#6e7681" };

/** @type {Object<string, React.CSSProperties>} */
const BIN_STYLE = { failed: failedStyle, output: outputStyle, done: doneStyle };
