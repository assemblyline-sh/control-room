// @ts-check
"use client";

import { useEffect } from "react";
import { useTabs } from "@/state/tabs-context";
import { setTabAttention, useTabAttention } from "@/state/tab-attention";

/**
 * @typedef {import("@/state/tabs").Tab} TabType
 */

/**
 * @param {{
 *   tab: TabType,
 *   active: boolean,
 *   index: number,
 *   drop_target?: boolean,
 *   on_context_menu: (e: React.MouseEvent, tab: TabType) => void,
 *   on_drag_start: (e: React.DragEvent, index: number) => void,
 *   on_drag_over: (e: React.DragEvent, index: number) => void,
 *   on_drag_leave: (e: React.DragEvent, index: number) => void,
 *   on_drop: (e: React.DragEvent, index: number) => void,
 *   on_drag_end: (e: React.DragEvent) => void,
 * }} props
 * @returns {React.JSX.Element}
 */
export default function Tab({
  tab,
  active,
  index,
  drop_target,
  on_context_menu,
  on_drag_start,
  on_drag_over,
  on_drag_leave,
  on_drop,
  on_drag_end,
}) {
  const { dispatch } = useTabs();
  // Every tab is on the window's host — the window title names it.
  const title = tab.title;
  const attention = useTabAttention(tab.id);

  useEffect(() => {
    if (active && attention) setTabAttention(tab.id, false);
  }, [active, attention, tab.id]);

  return (
    <div
      style={{
        ...tabStyle,
        ...(active ? activeStyle : {}),
        ...(drop_target ? dropTargetStyle : {}),
      }}
      draggable
      onDragStart={(e) => on_drag_start(e, index)}
      onDragOver={(e) => on_drag_over(e, index)}
      onDragLeave={(e) => on_drag_leave(e, index)}
      onDrop={(e) => on_drop(e, index)}
      onDragEnd={(e) => on_drag_end(e)}
      onClick={() => dispatch({ type: "set_active", id: tab.id })}
      onContextMenu={(e) => on_context_menu(e, tab)}
    >
      {attention && (
        <span style={attentionStyle} aria-label="needs attention" />
      )}
      <span style={titleStyle}>{title}</span>
      <button
        type="button"
        style={closeStyle}
        onClick={(e) => {
          e.stopPropagation();
          dispatch({ type: "close_tab", id: tab.id });
        }}
        aria-label={`Close ${title}`}
      >
        ×
      </button>
    </div>
  );
}

/** @type {React.CSSProperties} */
const tabStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 12px",
  borderRight: "1px solid var(--border)",
  color: "var(--muted-foreground)",
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** @type {React.CSSProperties} */
const activeStyle = {
  background: "var(--background)",
  color: "var(--foreground)",
};

/** @type {React.CSSProperties} */
const dropTargetStyle = {
  boxShadow: "inset 2px 0 0 var(--accent)",
};

/** @type {React.CSSProperties} */
const attentionStyle = {
  width: 6,
  height: 6,
  borderRadius: 3,
  background: "var(--accent)",
  flexShrink: 0,
};

/** @type {React.CSSProperties} */
const titleStyle = {
  maxWidth: 200,
  overflow: "hidden",
  textOverflow: "ellipsis",
};

/** @type {React.CSSProperties} */
const closeStyle = {
  background: "transparent",
  border: "none",
  color: "inherit",
  fontSize: 16,
  lineHeight: 1,
  cursor: "pointer",
  padding: "2px 4px",
  borderRadius: 3,
};
