// @ts-check
"use client";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 */

/**
 * Per-resource-type visual marker. MVP uses single-letter chips so we don't
 * add a UI dep; can swap to lucide-react icons later without touching callers.
 *
 * @param {{ type: ResourceId['type'] }} props
 * @returns {React.JSX.Element}
 */
export default function TreeIcon({ type }) {
  const { letter, color } = visual(type);
  return (
    <span style={{ ...chipStyle, background: color }} aria-hidden="true">
      {letter}
    </span>
  );
}

/**
 * @param {ResourceId['type']} type
 * @returns {{ letter: string, color: string }}
 */
function visual(type) {
  switch (type) {
    case "factory":
      return { letter: "W", color: "#58a6ff" };
    case "line":
      return { letter: "L", color: "#79c0ff" };
    case "station":
      return { letter: "S", color: "#a5d6ff" };
    case "bin":
      return { letter: "B", color: "#7ee787" };
    case "workpiece":
      return { letter: "P", color: "#ffa657" };
    case "work-record":
      return { letter: "R", color: "#d2a8ff" };
    case "file":
      return { letter: "F", color: "#8b949e" };
    case "factories-overview":
      return { letter: "▦", color: "#58a6ff" };
    case "failures":
      return { letter: "!", color: "#ff7b72" };
    case "housekeeping":
      return { letter: "⌫", color: "#8b949e" };
    default:
      return { letter: "?", color: "#8b949e" };
  }
}

/** @type {React.CSSProperties} */
const chipStyle = {
  width: 18,
  height: 18,
  borderRadius: 4,
  color: "#000",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 10,
  fontWeight: 600,
  flexShrink: 0,
  fontFamily: "ui-monospace, Menlo, monospace",
};
