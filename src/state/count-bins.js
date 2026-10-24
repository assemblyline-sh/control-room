// @ts-check
"use client";

import { useSyncExternalStore } from "react";

/**
 * Which bins the rail's factory / line / station counts show. Always in BINS
 * order; the user only picks which. Kept in localStorage, so every window
 * shares it (the `storage` event updates the others).
 */

/** @typedef {"input" | "doing" | "failed" | "output" | "done"} CountBin */

/** @type {CountBin[]} */
export const BINS = ["input", "doing", "failed", "output", "done"];

const STORAGE_KEY = "control-room.count-bins";
/** @type {CountBin[]} */
const DEFAULT = ["input", "failed", "output"];

/** @type {Set<() => void>} */
const listeners = new Set();

/** @returns {string} */
function snapshot() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT.join(",");
  } catch {
    return DEFAULT.join(",");
  }
}

/** @param {() => void} fn */
function subscribe(fn) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

/**
 * The chosen bins, in BINS order.
 * @returns {CountBin[]}
 */
export function useCountBins() {
  const value = useSyncExternalStore(subscribe, snapshot, () => DEFAULT.join(","));
  return BINS.filter((b) => value.split(",").includes(b));
}

/**
 * Show or hide one bin's count.
 * @param {CountBin} bin
 * @param {boolean} on
 */
export function setCountBin(bin, on) {
  const current = snapshot().split(",");
  const next = BINS.filter((b) => (b === bin ? on : current.includes(b)));
  try {
    localStorage.setItem(STORAGE_KEY, next.join(","));
  } catch {
    // storage unavailable: the choice can't be kept
  }
  listeners.forEach((fn) => fn());
}
