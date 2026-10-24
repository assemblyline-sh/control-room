// @ts-check
"use client";

import { useNodeCounts } from "@/state/counts-store";
import { useCountBins } from "@/state/count-bins";

/**
 * The chosen bins' counts (count-bins.js; input / failed / output by default)
 * for a factory, line or station row (sums across the stations below it);
 * the workpiece count for a bin row. Live — see counts-store.js.
 *
 * Colours, when non-zero: doing amber (being worked on), failed red (needs
 * attention), output green (work produced), done grey (archive receipts —
 * history, not work).
 *
 * @param {{ resource: import("@/lib/resource-id").ResourceId }} props
 * @returns {React.JSX.Element | null}
 */
export default function CountsBadge({ resource }) {
  const c = useNodeCounts(resource);
  const bins = useCountBins();
  if (c === null) return null;

  if (typeof c === "number") {
    const bin = resource.type === "bin" ? resource.bin : "";
    return <span style={{ ...badgeStyle, ...(c > 0 ? BIN_STYLE[bin] : {}) }}>{compact(c)}</span>;
  }

  if (bins.length === 0) return null;
  const where = resource.type === "station" ? "" : " (sum of its stations)";
  return (
    <span style={badgeStyle} title={`${bins.map((b) => `${c[b]} ${b}`).join(" · ")}${where}`}>
      {bins.map((b, i) => (
        <span key={b}>
          {i > 0 && "/"}
          <span style={c[b] > 0 ? BIN_STYLE[b] : undefined}>{compact(c[b])}</span>
        </span>
      ))}
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
const doingStyle = { color: "#e3b341" };

/** @type {React.CSSProperties} */
const doneStyle = { color: "#6e7681" };

/** @type {Object<string, React.CSSProperties>} */
const BIN_STYLE = { doing: doingStyle, failed: failedStyle, output: outputStyle, done: doneStyle };
