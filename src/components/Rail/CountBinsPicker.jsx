// @ts-check
"use client";

import { useEffect, useRef, useState } from "react";
import { BINS, setCountBin, useCountBins } from "@/state/count-bins";

/**
 * The FACTORIES header's "counts" button: a checkbox per bin, choosing which
 * counts the factory, line and station rows show. Stays open while toggling;
 * closes on outside click or Escape.
 *
 * @returns {React.JSX.Element}
 */
export default function CountBinsPicker() {
  const shown = useCountBins();
  const [open, set_open] = useState(false);
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));

  useEffect(() => {
    if (!open) return;
    /** @param {MouseEvent} e */
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(/** @type {Node} */ (e.target))) set_open(false);
    };
    /** @param {KeyboardEvent} e */
    const onKey = (e) => e.key === "Escape" && set_open(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={wrapStyle}>
      <button
        type="button"
        style={buttonStyle}
        title="Choose which bin counts the rows show"
        aria-expanded={open}
        onClick={() => set_open(!open)}
      >
        {shown.length > 0 ? shown.join("/") : "no counts"} ▾
      </button>
      {open && (
        <div style={menuStyle} role="menu">
          {BINS.map((b) => (
            <label key={b} style={itemStyle}>
              <input type="checkbox" checked={shown.includes(b)} onChange={(e) => setCountBin(b, e.target.checked)} />
              {b}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** @type {React.CSSProperties} */
const wrapStyle = { position: "relative" };

/** @type {React.CSSProperties} */
const buttonStyle = {
  padding: "0 4px",
  background: "transparent",
  border: "none",
  color: "var(--muted-foreground)",
  fontSize: 11,
  whiteSpace: "nowrap",
  cursor: "pointer",
};

/** @type {React.CSSProperties} */
const menuStyle = {
  position: "absolute",
  right: 0,
  top: "100%",
  zIndex: 50,
  minWidth: 120,
  padding: 4,
  background: "var(--muted)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
};

/** @type {React.CSSProperties} */
const itemStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "4px 8px",
  color: "var(--foreground)",
  fontSize: 12,
  cursor: "pointer",
};
