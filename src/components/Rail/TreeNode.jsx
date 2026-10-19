// @ts-check
"use client";

import { useEffect, useRef, useState } from "react";
import {
  newTerminal,
  resolveChildren,
  resourceIdToString,
  resourceIdToTitle,
} from "@/lib/resource-id";
import { loadChildrenInto } from "@/state/tree";
import { useTabs } from "@/state/tabs-context";
import { useTree } from "@/state/tree-context";
import TreeIcon from "@/components/Rail/TreeIcon";
import CountsBadge from "@/components/Rail/CountsBadge";
import ContextMenu from "@/components/ContextMenu";
import { clearActions } from "@/lib/clear-actions";
import { canRetry, getDragged, isRetryable, retryWorkpieces, setDragged } from "@/lib/retry";
import { useClear } from "@/state/clear-context";
import { useNodeCounts } from "@/state/counts-store";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 */

/**
 * Recursive tree node. Expanding triggers a one-shot lazy fetch of children.
 * Clicking the label opens the resource as a tab. File leaves don't render
 * a chevron (resolveChildren returns []).
 *
 * @param {{ resource: ResourceId, depth: number }} props
 * @returns {React.JSX.Element}
 */
export default function TreeNode({ resource, depth }) {
  const { state: tree, dispatch: tree_dispatch } = useTree();
  const { state: tabs, dispatch: tabs_dispatch } = useTabs();

  const id = resourceIdToString(resource);
  const expanded = tree.expanded.has(id);
  const loading = tree.loading.has(id);
  const error = tree.errors.get(id);
  const children = tree.children.get(id);
  const has_loaded = children !== undefined;
  const is_leaf = resource.type === "file";
  // Tab ids are resourceIdToString(resource) (see tabs reducer open_tab),
  // so the active tab matches the active rail node iff they're the same id.
  const is_active_tab = tabs.active_id === id;
  const open_clear = useClear();
  const [menu, set_menu] = useState(/** @type {{ x: number, y: number } | null} */ (null));
  const [drop_over, set_drop_over] = useState(false);
  // dragenter/dragleave fire for every child the pointer crosses (and
  // dragleave's relatedTarget is null), so count them to know when it's left.
  const drag_depth = useRef(0);
  const retryable = isRetryable(resource);

  /** @type {import("@/components/ContextMenu").MenuItem[]} */
  const menu_items = [];
  if (resource.type === "workpiece" && retryable) {
    const { workpiece, ...rest } = resource;
    const from = { ...rest, type: /** @type {const} */ ("bin") };
    menu_items.push({ label: "Retry", onClick: () => retryWorkpieces(from, [workpiece], tree_dispatch) });
  }
  if (resource.type === "bin" && resource.bin === "failed") {
    menu_items.push({ label: "Retry all failed", onClick: () => retryWorkpieces(resource, null, tree_dispatch) });
  }
  const clear_items = clearActions(resource).map((a) => ({ label: a.label, danger: true, onClick: () => open_clear(a.request) }));
  if (menu_items.length > 0 && clear_items.length > 0) menu_items.push("separator");
  menu_items.push(...clear_items);
  if (resource.type === "factory") {
    const { host, factory } = resource;
    menu_items.push(
      "separator",
      { label: "Failures", onClick: () => tabs_dispatch({ type: "open_tab", resource: { type: "failures", host, factory } }) },
      { label: "Housekeeping", onClick: () => tabs_dispatch({ type: "open_tab", resource: { type: "housekeeping", host, factory } }) },
    );
  }
  if (resource.type === "factory" || resource.type === "station" || resource.type === "bin") {
    const { host, factory } = resource;
    const dir =
      resource.type === "station" ? resource.station : resource.type === "bin" ? `${resource.station}/${resource.bin}` : undefined;
    if (menu_items.length > 0) menu_items.push("separator");
    menu_items.push({ label: "New Terminal", onClick: () => tabs_dispatch({ type: "open_tab", resource: newTerminal(host, factory, dir) }) });
  }

  // Fetch children when expanded and not loaded — first expand, or after an
  // "invalidate" (e.g. a clear emptied this bin) while open.
  useEffect(() => {
    if (!expanded || has_loaded || loading || is_leaf) return;
    loadChildrenInto(resource, tree_dispatch, resolveChildren);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, has_loaded]);

  // An open bin follows the polled count: when it moves, reload the list in
  // place (the old rows stay until the new ones arrive).
  const counts_key = JSON.stringify(useNodeCounts(resource));
  useEffect(() => {
    if (resource.type !== "bin" || !expanded || !has_loaded || loading) return;
    loadChildrenInto(resource, tree_dispatch, resolveChildren);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts_key]);

  return (
    <div>
      <div
        style={{
          ...rowStyle,
          ...(is_active_tab ? activeRowStyle : {}),
          ...(drop_over ? dropTargetStyle : {}),
          paddingLeft: 8 + depth * 14,
        }}
        draggable={retryable}
        onDragStart={(e) => {
          if (resource.type !== "workpiece") return;
          setDragged(resource);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", resource.workpiece);
        }}
        onDragEnd={() => setDragged(null)}
        onDragEnter={(e) => {
          if (!canRetry(getDragged(), resource)) return;
          e.preventDefault();
          drag_depth.current += 1;
          set_drop_over(true);
        }}
        onDragOver={(e) => {
          // Not calling preventDefault leaves the drop refused ("not allowed" cursor).
          if (!canRetry(getDragged(), resource)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDragLeave={() => {
          if (!canRetry(getDragged(), resource)) return;
          drag_depth.current = Math.max(0, drag_depth.current - 1);
          if (drag_depth.current === 0) set_drop_over(false);
        }}
        onDrop={(e) => {
          drag_depth.current = 0;
          set_drop_over(false);
          const source = getDragged();
          setDragged(null);
          if (!source || !canRetry(source, resource)) return;
          e.preventDefault();
          const { workpiece, ...rest } = source;
          retryWorkpieces({ ...rest, type: "bin" }, [workpiece], tree_dispatch);
        }}
        onClick={() =>
          tabs_dispatch({ type: "open_tab", resource })
        }
        onContextMenu={(e) => {
          if (menu_items.length === 0) return;
          e.preventDefault();
          set_menu({ x: e.clientX, y: e.clientY });
        }}
      >
        <button
          type="button"
          style={chevronStyle}
          onClick={(e) => {
            e.stopPropagation();
            if (is_leaf) return;
            tree_dispatch({ type: "toggle", resource });
          }}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {is_leaf ? "" : expanded ? "▼" : "▶"}
        </button>
        <TreeIcon type={resource.type} />
        <span style={labelStyle} title={tooltip(resource)}>
          {resourceIdToTitle(resource)}
        </span>
        {loading && <span style={hintStyle}>…</span>}
        <CountsBadge resource={resource} />
      </div>
      {menu && <ContextMenu items={menu_items} x={menu.x} y={menu.y} onClose={() => set_menu(null)} />}
      {expanded && error && (
        <div style={{ ...errorStyle, paddingLeft: 8 + (depth + 1) * 14 }}>
          {error}
        </div>
      )}
      {expanded && children && children.length === 0 && !loading && (
        <div style={{ ...emptyStyle, paddingLeft: 8 + (depth + 1) * 14 }}>
          (empty)
        </div>
      )}
      {expanded &&
        children &&
        children.map((child) => (
          <TreeNode
            key={resourceIdToString(child)}
            resource={child}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

/**
 * Label tooltip: code, plus the def's name and description for lines and
 * stations.
 *
 * @param {ResourceId} resource
 * @returns {string}
 */
function tooltip(resource) {
  const title = resourceIdToTitle(resource);
  if (resource.type !== "line" && resource.type !== "station") return title;
  return [resource.name ? `${title} — ${resource.name}` : title, resource.description]
    .filter(Boolean)
    .join("\n\n");
}

/** @type {React.CSSProperties} */
const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 8px 3px 0",
  color: "var(--foreground)",
  fontSize: 13,
  cursor: "pointer",
  userSelect: "none",
};

/** @type {React.CSSProperties} */
const activeRowStyle = {
  background: "rgba(88, 166, 255, 0.12)",
  boxShadow: "inset 2px 0 0 var(--accent)",
};

/** @type {React.CSSProperties} */
const dropTargetStyle = {
  background: "rgba(88, 166, 255, 0.2)",
  boxShadow: "inset 0 0 0 1px var(--accent)",
};

/** @type {React.CSSProperties} */
const chevronStyle = {
  width: 14,
  height: 14,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  color: "var(--muted-foreground)",
  fontSize: 9,
  cursor: "pointer",
  padding: 0,
  flexShrink: 0,
};

/** @type {React.CSSProperties} */
const labelStyle = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};

/** @type {React.CSSProperties} */
const hintStyle = {
  color: "var(--muted-foreground)",
  fontSize: 12,
};

/** @type {React.CSSProperties} */
const errorStyle = {
  color: "#ff7b72",
  fontSize: 11,
  padding: "2px 8px",
  whiteSpace: "pre-wrap",
};

/** @type {React.CSSProperties} */
const emptyStyle = {
  color: "var(--muted-foreground)",
  fontSize: 11,
  fontStyle: "italic",
  padding: "2px 8px",
};
