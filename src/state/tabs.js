// @ts-check

import { resourceIdToString, resourceIdToTitle } from "@/lib/resource-id";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 */

/**
 * @typedef {Object} Tab
 * @property {string} id          - resourceIdToString(resource)
 * @property {ResourceId} resource
 * @property {string} title
 * @property {boolean} pinned     - reserved for future preview-vs-pinned UX
 */

/**
 * @typedef {Object} TabsState
 * @property {Tab[]} tabs
 * @property {string | null} active_id
 */

/** @type {TabsState} */
export const tabs_initial_state = {
  tabs: [],
  active_id: null,
};

/**
 * @typedef {(
 *   | { type: 'open_tab',       resource: ResourceId, pinned?: boolean }
 *   | { type: 'close_tab',      id: string }
 *   | { type: 'close_others',   id: string }
 *   | { type: 'close_to_right', id: string }
 *   | { type: 'close_all' }
 *   | { type: 'set_active',     id: string }
 *   | { type: 'pin_tab',        id: string }
 *   | { type: 'unpin_tab',      id: string }
 *   | { type: 'reorder',        from: number, to: number }
 * )} TabsAction
 */

/**
 * Pure reducer. Caller wires up via useReducer in Shell.jsx.
 *
 * @param {TabsState} state
 * @param {TabsAction} action
 * @returns {TabsState}
 */
export function tabsReducer(state, action) {
  switch (action.type) {
    case "open_tab": {
      const id = resourceIdToString(action.resource);
      const existing = state.tabs.find((t) => t.id === id);
      if (existing) {
        // Already open — just activate.
        return state.active_id === id ? state : { ...state, active_id: id };
      }
      /** @type {Tab} */
      const new_tab = {
        id,
        resource: action.resource,
        title: resourceIdToTitle(action.resource),
        pinned: action.pinned ?? false,
      };
      return {
        tabs: [...state.tabs, new_tab],
        active_id: id,
      };
    }

    case "close_tab": {
      const idx = state.tabs.findIndex((t) => t.id === action.id);
      if (idx === -1) return state;
      const new_tabs = state.tabs.filter((_, i) => i !== idx);
      let new_active = state.active_id;
      if (state.active_id === action.id) {
        // Prefer the previous tab; fall back to the next; null if list emptied.
        if (idx > 0) new_active = state.tabs[idx - 1].id;
        else if (idx < state.tabs.length - 1) new_active = state.tabs[idx + 1].id;
        else new_active = null;
      }
      return { tabs: new_tabs, active_id: new_active };
    }

    case "close_others": {
      const target = state.tabs.find((t) => t.id === action.id);
      if (!target) return state;
      if (state.tabs.length === 1) return state;
      return { tabs: [target], active_id: target.id };
    }

    case "close_to_right": {
      const idx = state.tabs.findIndex((t) => t.id === action.id);
      if (idx === -1 || idx === state.tabs.length - 1) return state;
      const new_tabs = state.tabs.slice(0, idx + 1);
      // If the active tab was to the right of the anchor, it's gone; pick anchor.
      const active_idx = state.active_id
        ? state.tabs.findIndex((t) => t.id === state.active_id)
        : -1;
      const new_active = active_idx > idx ? state.tabs[idx].id : state.active_id;
      return { tabs: new_tabs, active_id: new_active };
    }

    case "close_all": {
      if (state.tabs.length === 0) return state;
      return { tabs: [], active_id: null };
    }

    case "set_active": {
      if (state.active_id === action.id) return state;
      if (!state.tabs.some((t) => t.id === action.id)) return state;
      return { ...state, active_id: action.id };
    }

    case "pin_tab":
    case "unpin_tab": {
      const want_pinned = action.type === "pin_tab";
      let changed = false;
      const new_tabs = state.tabs.map((t) => {
        if (t.id !== action.id || t.pinned === want_pinned) return t;
        changed = true;
        return { ...t, pinned: want_pinned };
      });
      return changed ? { ...state, tabs: new_tabs } : state;
    }

    case "reorder": {
      const { from, to } = action;
      const n = state.tabs.length;
      if (from === to || from < 0 || from >= n || to < 0 || to >= n) return state;
      const new_tabs = [...state.tabs];
      const [moved] = new_tabs.splice(from, 1);
      new_tabs.splice(to, 0, moved);
      return { ...state, tabs: new_tabs };
    }

    default: {
      const _exhaustive = /** @type {never} */ (action);
      return state;
    }
  }
}
