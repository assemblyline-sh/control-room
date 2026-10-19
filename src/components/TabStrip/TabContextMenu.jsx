// @ts-check
"use client";

import { useEffect, useRef } from "react";
import { openInFinder } from "@/lib/tauri-api";
import { resourceToDiskPath, revealInRail } from "@/lib/resource-id";
import { useConfig } from "@/state/config-context";
import { useTabs } from "@/state/tabs-context";
import { useTree } from "@/state/tree-context";

/**
 * @typedef {import("@/state/tabs").Tab} Tab
 */

/**
 * Floating context menu for a tab. Positioned at viewport coordinates.
 * Closes on outside click, Escape, or after running an item action.
 *
 * @param {{
 *   tab: Tab,
 *   x: number,
 *   y: number,
 *   onClose: () => void,
 * }} props
 * @returns {React.JSX.Element}
 */
export default function TabContextMenu({ tab, x, y, onClose }) {
  const { state: tabs_state, dispatch: tabs_dispatch } = useTabs();
  const { dispatch: tree_dispatch } = useTree();
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));

  useEffect(() => {
    /** @param {MouseEvent} e */
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(/** @type {Node} */ (e.target))) {
        onClose();
      }
    };
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const idx = tabs_state.tabs.findIndex((t) => t.id === tab.id);
  const is_only = tabs_state.tabs.length === 1;
  const is_last = idx === tabs_state.tabs.length - 1;
  const { factoryRoot } = useConfig();
  const disk_path = resourceToDiskPath(
    tab.resource,
    "factory" in tab.resource && tab.resource.factory ? factoryRoot(tab.resource.host, tab.resource.factory) : null,
  );

  /** @param {() => void | Promise<void>} action */
  const run = (action) => () => {
    action();
    onClose();
  };

  const items = [
    {
      label: "Close",
      onClick: run(() => tabs_dispatch({ type: "close_tab", id: tab.id })),
    },
    {
      label: "Close Others",
      disabled: is_only,
      onClick: run(() => tabs_dispatch({ type: "close_others", id: tab.id })),
    },
    {
      label: "Close to the Right",
      disabled: is_last,
      onClick: run(() => tabs_dispatch({ type: "close_to_right", id: tab.id })),
    },
    {
      label: "Close All",
      onClick: run(() => tabs_dispatch({ type: "close_all" })),
    },
    { separator: true },
    {
      label: "Reveal in Finder",
      disabled: disk_path === null,
      onClick: run(() => {
        if (disk_path) openInFinder(disk_path);
      }),
    },
    {
      label: "Reveal in Explorer View",
      onClick: run(() => revealInRail(tab.resource, tree_dispatch)),
    },
  ];

  // Clamp position so the menu stays on-screen. Approximate menu size; finer
  // adjustments happen after first render but this avoids a visible jump.
  const menu_w = 220;
  const menu_h = items.length * 28 + 8;
  const clamped_x = Math.min(x, window.innerWidth - menu_w - 4);
  const clamped_y = Math.min(y, window.innerHeight - menu_h - 4);

  return (
    <div
      ref={ref}
      style={{ ...menuStyle, left: clamped_x, top: clamped_y, width: menu_w }}
      role="menu"
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={`sep-${i}`} style={separatorStyle} role="separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={item.onClick}
            style={{ ...itemStyle, ...(item.disabled ? itemDisabledStyle : {}) }}
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
  zIndex: 1000,
  background: "var(--muted)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "4px 0",
  boxShadow: "0 6px 20px rgba(0, 0, 0, 0.4)",
  display: "flex",
  flexDirection: "column",
  minWidth: 200,
};

/** @type {React.CSSProperties} */
const itemStyle = {
  padding: "6px 14px",
  background: "transparent",
  border: "none",
  color: "var(--foreground)",
  fontSize: 13,
  textAlign: "left",
  cursor: "pointer",
  fontFamily: "inherit",
};

/** @type {React.CSSProperties} */
const itemDisabledStyle = {
  color: "var(--muted-foreground)",
  cursor: "not-allowed",
};

/** @type {React.CSSProperties} */
const separatorStyle = {
  height: 1,
  background: "var(--border)",
  margin: "4px 0",
};
