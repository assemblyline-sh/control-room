// @ts-check
"use client";

import { useEffect, useSyncExternalStore } from "react";
import { hostCounts } from "@/lib/tauri-api";

/**
 * Workpiece counts for the selected host, polled every POLL_MS and read by
 * every rail row. A module-level store rather than context: rows subscribe
 * through a selector that returns a string, so a tick re-renders only the
 * rows whose numbers changed — not a tree that may have thousands of rows
 * expanded.
 *
 * Polling: the next tick is scheduled when the previous one finishes (never
 * overlapping, however slow ssh is), and pauses while the window is hidden.
 */

const POLL_MS = 2000;

/** @typedef {import("@/lib/tauri-api").FactoryCounts} FactoryCounts */
/** @typedef {import("@/lib/resource-id").ResourceId} ResourceId */

/** @type {{ host: string | null, data: Object<string, FactoryCounts>, json: string }} */
let store = { host: null, data: {}, json: "{}" };
/** @type {Set<() => void>} */
const listeners = new Set();

/** @param {() => void} fn */
function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * @param {string} host
 * @param {Object<string, FactoryCounts>} data
 */
function publish(host, data) {
  const json = JSON.stringify(data);
  if (host === store.host && json === store.json) return; // nothing changed — no renders
  store = { host, data, json };
  listeners.forEach((fn) => fn());
}

/**
 * Run the poller for `host` while mounted. Mount once, in the shell.
 * @param {string} host
 */
export function useCountsPoller(host) {
  useEffect(() => {
    let stopped = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    publish(host, {});

    const tick = async () => {
      if (stopped) return;
      if (!document.hidden) {
        try {
          const data = await hostCounts(host);
          if (!stopped) publish(host, data);
        } catch {
          // keep the last numbers; the rail's connection dot shows the error
        }
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    tick();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [host]);
}

/**
 * @typedef {{ input: number, doing: number, failed: number, output: number, done: number }} Totals
 */

/**
 * Totals for a rail node: a factory / line sums its stations; a station is
 * its own bins; a bin is just its count. `null` when there's nothing to show.
 * Failed includes orphaned failed folders (no pointer.json), as al-control's
 * `count` does.
 *
 * @param {ResourceId} r
 * @returns {Totals | number | null}
 */
function select(r) {
  if (!("factory" in r) || r.host !== store.host) return null;
  const w = store.data[r.factory];
  if (!w || w.error) return null;
  const orphans = w.orphans ?? {};
  if (r.type === "bin") {
    const n = w.counts[r.station]?.[r.bin] ?? null;
    return r.bin === "failed" && n !== null ? n + (orphans[r.station] ?? 0) : n;
  }
  if (r.type !== "factory" && r.type !== "line" && r.type !== "station") return null;

  /** @type {Totals} */
  const t = { input: 0, doing: 0, failed: 0, output: 0, done: 0 };
  for (const [station, bins] of Object.entries(w.counts)) {
    if (r.type === "line" && w.lines[station] !== r.line) continue;
    if (r.type === "station" && station !== r.station) continue;
    t.input += bins.input ?? 0;
    t.doing += bins.doing ?? 0;
    t.failed += (bins.failed ?? 0) + (orphans[station] ?? 0);
    t.output += bins.output ?? 0;
    t.done += bins.done ?? 0;
  }
  return t;
}

/**
 * A rail node's counts, re-rendering only when they change.
 * @param {ResourceId} resource
 * @returns {Totals | number | null}
 */
export function useNodeCounts(resource) {
  // A string snapshot compares by value, so unchanged rows skip rendering.
  const key = useSyncExternalStore(
    subscribe,
    () => JSON.stringify(select(resource)),
    () => "null",
  );
  return JSON.parse(key);
}

/**
 * The selected host's totals — failed (incl. orphans) and done — for the
 * rail's Failures and Housekeeping badges. `null` until the first poll.
 * @param {string} host
 * @returns {{ failed: number, done: number } | null}
 */
export function useHostTotals(host) {
  const key = useSyncExternalStore(
    subscribe,
    () => {
      if (store.host !== host || Object.keys(store.data).length === 0) return "null";
      const t = { failed: 0, done: 0 };
      for (const w of Object.values(store.data)) {
        if (w.error) continue;
        for (const [station, bins] of Object.entries(w.counts)) {
          t.failed += (bins.failed ?? 0) + (w.orphans?.[station] ?? 0);
          t.done += bins.done ?? 0;
        }
      }
      return JSON.stringify(t);
    },
    () => "null",
  );
  return JSON.parse(key);
}
