// @ts-check
"use client";

import { useState } from "react";
import { useTabs } from "@/state/tabs-context";
import Tab from "@/components/TabStrip/Tab";
import TabContextMenu from "@/components/TabStrip/TabContextMenu";

/**
 * @typedef {import("@/state/tabs").Tab} TabType
 */

const DRAG_MIME = "application/x-control-room-tab-index";

/**
 * @returns {React.JSX.Element}
 */
export default function TabStrip() {
  const { state, dispatch } = useTabs();
  const [menu, set_menu] = useState(
    /** @type {{ tab_id: string, x: number, y: number } | null} */ (null),
  );
  const [drop_index, set_drop_index] = useState(
    /** @type {number | null} */ (null),
  );

  /** @param {React.MouseEvent} e @param {TabType} tab */
  const onContextMenu = (e, tab) => {
    e.preventDefault();
    set_menu({ tab_id: tab.id, x: e.clientX, y: e.clientY });
  };

  /** @param {React.DragEvent} e @param {number} index */
  const onDragStart = (e, index) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(DRAG_MIME, String(index));
  };

  /** @param {React.DragEvent} e @param {number} index */
  const onDragOver = (e, index) => {
    // Must preventDefault so the browser allows the drop.
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (drop_index !== index) set_drop_index(index);
  };

  /** @param {React.DragEvent} _e @param {number} index */
  const onDragLeave = (_e, index) => {
    if (drop_index === index) set_drop_index(null);
  };

  /** @param {React.DragEvent} e @param {number} index */
  const onDrop = (e, index) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    const from = Number(e.dataTransfer.getData(DRAG_MIME));
    set_drop_index(null);
    if (Number.isNaN(from) || from === index) return;
    dispatch({ type: "reorder", from, to: index });
  };

  /** @param {React.DragEvent} _e */
  const onDragEnd = (_e) => {
    set_drop_index(null);
  };

  const menu_tab = menu
    ? state.tabs.find((t) => t.id === menu.tab_id)
    : null;

  return (
    <>
      <div style={stripStyle}>
        {state.tabs.map((t, i) => (
          <Tab
            key={t.id}
            tab={t}
            index={i}
            active={t.id === state.active_id}
            drop_target={drop_index === i}
            on_context_menu={onContextMenu}
            on_drag_start={onDragStart}
            on_drag_over={onDragOver}
            on_drag_leave={onDragLeave}
            on_drop={onDrop}
            on_drag_end={onDragEnd}
          />
        ))}
      </div>
      {menu && menu_tab && (
        <TabContextMenu
          tab={menu_tab}
          x={menu.x}
          y={menu.y}
          onClose={() => set_menu(null)}
        />
      )}
    </>
  );
}

/** @type {React.CSSProperties} */
const stripStyle = {
  display: "flex",
  alignItems: "stretch",
  minHeight: 36,
  borderBottom: "1px solid var(--border)",
  background: "var(--muted)",
  overflowX: "auto",
};
