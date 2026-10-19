// @ts-check
"use client";

import { useSyncExternalStore } from "react";

/**
 * A counter bumped after anything changes factory data from this window (a
 * clear or retry). It marks every cached useFetcher entry stale: open views
 * refetch now, the rest when they next mount.
 */

let epoch = 0;
/** @type {Set<() => void>} */
const listeners = new Set();

export function bumpDataEpoch() {
  epoch += 1;
  listeners.forEach((fn) => fn());
}

/** @returns {number} */
export function getDataEpoch() {
  return epoch;
}

/** @returns {number} */
export function useDataEpoch() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => epoch,
    () => 0,
  );
}
