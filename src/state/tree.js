// @ts-check

import { resourceIdToString } from "@/lib/resource-id";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 */

/**
 * @typedef {Object} TreeState
 * @property {Set<string>} expanded  - resource_id string forms currently expanded
 * @property {Set<string>} loading   - currently fetching children
 * @property {Map<string, ResourceId[]>} children - memoized per node
 * @property {Map<string, string>} errors
 */

/** @type {TreeState} */
export const tree_initial_state = {
  expanded: new Set(),
  loading: new Set(),
  children: new Map(),
  errors: new Map(),
};

/**
 * @typedef {(
 *   | { type: 'toggle',       resource: ResourceId }
 *   | { type: 'expand',       resource: ResourceId }
 *   | { type: 'set_loading',  resource: ResourceId, value: boolean }
 *   | { type: 'set_children', resource: ResourceId, children: ResourceId[] }
 *   | { type: 'set_error',    resource: ResourceId, error: string }
 *   | { type: 'invalidate',   resource: ResourceId }
 * )} TreeAction
 */

/**
 * Pure reducer. `loadChildrenInto` below is the async thunk that drives
 * `set_loading` / `set_children` / `set_error` from a fetch.
 *
 * @param {TreeState} state
 * @param {TreeAction} action
 * @returns {TreeState}
 */
export function treeReducer(state, action) {
  switch (action.type) {
    case "toggle": {
      const key = resourceIdToString(action.resource);
      const next_expanded = new Set(state.expanded);
      if (next_expanded.has(key)) next_expanded.delete(key);
      else next_expanded.add(key);
      return { ...state, expanded: next_expanded };
    }

    case "expand": {
      const key = resourceIdToString(action.resource);
      if (state.expanded.has(key)) return state;
      const next_expanded = new Set(state.expanded);
      next_expanded.add(key);
      return { ...state, expanded: next_expanded };
    }

    case "set_loading": {
      const key = resourceIdToString(action.resource);
      if (action.value === state.loading.has(key)) return state;
      const next_loading = new Set(state.loading);
      if (action.value) next_loading.add(key);
      else next_loading.delete(key);
      return { ...state, loading: next_loading };
    }

    case "set_children": {
      const key = resourceIdToString(action.resource);
      const next_children = new Map(state.children);
      next_children.set(key, action.children);
      // Clear any prior error for this node — successful load wins.
      let next_errors = state.errors;
      if (state.errors.has(key)) {
        next_errors = new Map(state.errors);
        next_errors.delete(key);
      }
      return { ...state, children: next_children, errors: next_errors };
    }

    case "set_error": {
      const key = resourceIdToString(action.resource);
      const next_errors = new Map(state.errors);
      next_errors.set(key, action.error);
      return { ...state, errors: next_errors };
    }

    case "invalidate": {
      const key = resourceIdToString(action.resource);
      const had_children = state.children.has(key);
      const had_error = state.errors.has(key);
      if (!had_children && !had_error) return state;
      const next_children = had_children ? new Map(state.children) : state.children;
      const next_errors = had_error ? new Map(state.errors) : state.errors;
      if (had_children) next_children.delete(key);
      if (had_error) next_errors.delete(key);
      return { ...state, children: next_children, errors: next_errors };
    }

    default: {
      const _exhaustive = /** @type {never} */ (action);
      return state;
    }
  }
}

/**
 * Async loader for a node's children. Dispatches the three primitive
 * actions around an awaited resolver call. `resolver` is injected so this
 * module stays decoupled from the eventual Tauri-backed implementation in
 * `resource-id.js` (avoids any circular import once that's filled in).
 *
 * @param {ResourceId} resource
 * @param {(a: TreeAction) => void} dispatch
 * @param {(id: ResourceId) => Promise<ResourceId[]>} resolver
 * @returns {Promise<void>}
 */
export async function loadChildrenInto(resource, dispatch, resolver) {
  dispatch({ type: "set_loading", resource, value: true });
  try {
    const children = await resolver(resource);
    dispatch({ type: "set_children", resource, children });
  } catch (err) {
    dispatch({ type: "set_error", resource, error: String(err) });
  } finally {
    dispatch({ type: "set_loading", resource, value: false });
  }
}
