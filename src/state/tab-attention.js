// @ts-check
"use client";

import { useSyncExternalStore } from "react";

/**
 * Tab ids asking for attention while in the background: a terminal whose
 * program rang the bell or sent a notification (an agent waiting on you).
 * The tab strip shows a dot; activating the tab clears it.
 */

/** @type {Set<string>} */
let ids = new Set();
/** @type {Set<() => void>} */
const listeners = new Set();

/**
 * @param {string} id
 * @param {boolean} on
 */
export function setTabAttention(id, on) {
  if (ids.has(id) === on) return;
  ids = new Set(ids);
  if (on) ids.add(id);
  else ids.delete(id);
  listeners.forEach((fn) => fn());
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function useTabAttention(id) {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => ids.has(id),
    () => false,
  );
}
