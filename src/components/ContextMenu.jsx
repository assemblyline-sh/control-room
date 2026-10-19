// @ts-check
"use client";

import { useEffect, useRef } from "react";

/**
 * @typedef {{ label: string, onClick: () => void, danger?: boolean } | 'separator'} MenuItem
 */

/**
 * Floating menu at viewport coordinates. Closes on outside click, Escape, or
 * after an item runs.
 *
 * @param {{ items: MenuItem[], x: number, y: number, onClose: () => void }} props
 */
export default function ContextMenu({ items, x, y, onClose }) {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));

  useEffect(() => {
    /** @param {MouseEvent} e */
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(/** @type {Node} */ (e.target))) onClose();
    };
    /** @param {KeyboardEvent} e */
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} style={{ ...menuStyle, left: x, top: y }} role="menu">
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={i} style={separatorStyle} />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            style={{ ...itemStyle, ...(item.danger ? dangerStyle : {}) }}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

/** @type {React.CSSProperties} */
const menuStyle = {
  position: "fixed",
  zIndex: 50,
  minWidth: 180,
  padding: 4,
  background: "var(--muted)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
};

/** @type {React.CSSProperties} */
const itemStyle = {
  display: "block",
  width: "100%",
  padding: "6px 10px",
  background: "transparent",
  border: "none",
  borderRadius: 4,
  color: "var(--foreground)",
  fontSize: 12,
  textAlign: "left",
  cursor: "pointer",
};

/** @type {React.CSSProperties} */
const dangerStyle = { color: "#ff7b72" };

/** @type {React.CSSProperties} */
const separatorStyle = { height: 1, margin: "4px 0", background: "var(--border)" };
