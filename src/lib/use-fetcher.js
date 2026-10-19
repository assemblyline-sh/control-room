// @ts-check
"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { getDataEpoch, useDataEpoch } from "@/state/data-epoch";

/**
 * Data hook backed by a window-wide cache keyed by query, so a tab that
 * remounts shows its last data at once instead of refetching over ssh. Each
 * entry is revalidated in the background when it's older than FRESH_MS, read
 * under an older data epoch (state/data-epoch.js), or read with other
 * `signals`. A hidden tab (TabContent's <Activity>) unsubscribes and stops
 * revalidating; it catches up when shown. Concurrent reads of one key share
 * one call. Entries no hook is reading are kept, oldest dropped beyond
 * MAX_IDLE, so a tab hidden for hours still shows its data the moment it's
 * shown. See docs/wip/tab-data-cache.md.
 */

const FRESH_MS = 10_000;
const MAX_IDLE = 100;

/**
 * @typedef {Object} Snapshot
 * @property {unknown} data
 * @property {string | null} error - the last fetch's error; data is kept
 * @property {number | null} fetched_at - when `data` was read; null = never
 * @property {number} epoch - data epoch `data` was read under
 * @property {string} signals - JSON of the signals `data` was read with
 * @property {boolean} fetching
 */

/**
 * @typedef {Object} Entry
 * @property {Snapshot} snapshot - replaced, never mutated (useSyncExternalStore)
 * @property {Set<() => void>} listeners
 * @property {{ id: number, epoch: number, signals: string } | null} in_flight
 * @property {number} next_id
 * @property {number | null} idle_since - when the last reader left; null while read
 */

/** @type {Snapshot} */
const EMPTY = { data: null, error: null, fetched_at: null, epoch: -1, signals: "", fetching: true };

/** @type {Map<string, Entry>} */
const cache = new Map();

/** @param {string} key */
function getEntry(key) {
  let entry = cache.get(key);
  if (!entry) {
    // Starts as EMPTY (fetching): an entry is only created for a mounting hook, whose effect fetches it.
    entry = { snapshot: EMPTY, listeners: new Set(), in_flight: null, next_id: 0, idle_since: null };
    cache.set(key, entry);
  }
  return entry;
}

/**
 * @param {Entry} entry
 * @param {Partial<Snapshot>} patch
 */
function update(entry, patch) {
  entry.snapshot = { ...entry.snapshot, ...patch };
  entry.listeners.forEach((fn) => fn());
}

/**
 * Fetch `key` unless an equivalent call is in flight (`force` always fetches:
 * a refresh after a write must not join a call that started before it). A
 * newer call supersedes an older one's result.
 * @param {string} key
 * @param {() => Promise<unknown>} fetcher
 * @param {string} signals
 * @param {boolean} [force]
 */
function revalidate(key, fetcher, signals, force = false) {
  const entry = getEntry(key);
  const epoch = getDataEpoch();
  if (!force && entry.in_flight && entry.in_flight.epoch === epoch && entry.in_flight.signals === signals) return;
  const id = ++entry.next_id;
  entry.in_flight = { id, epoch, signals };
  update(entry, { fetching: true });
  fetcher().then(
    (data) => {
      if (entry.in_flight?.id !== id) return;
      entry.in_flight = null;
      update(entry, { data, error: null, fetched_at: Date.now(), epoch, signals, fetching: false });
    },
    (err) => {
      if (entry.in_flight?.id !== id) return;
      entry.in_flight = null;
      update(entry, { error: String(err), fetching: false });
    },
  );
}

/**
 * @param {string} key
 * @param {() => void} fn
 */
function subscribe(key, fn) {
  const entry = getEntry(key);
  entry.idle_since = null;
  entry.listeners.add(fn);
  return () => {
    entry.listeners.delete(fn);
    if (entry.listeners.size > 0) return;
    entry.idle_since = Date.now();
    const idle = [...cache].filter(([, e]) => e.idle_since !== null).sort(([, a], [, b]) => a.idle_since - b.idle_since);
    for (const [k] of idle.slice(0, Math.max(0, idle.length - MAX_IDLE))) cache.delete(k);
  };
}

/**
 * @template T
 * @param {readonly unknown[]} key - names the query, e.g. ["showLine", host, factory, line].
 *   Hooks with equal keys share data, so a fetcher that reshapes its result needs its own name.
 * @param {() => Promise<T>} fetcher
 * @param {readonly unknown[]} [signals] - values that trigger a revalidation when they move
 *   but don't identify the data (e.g. a bin's polled count)
 * @returns {{ data: T | null, loading: boolean, refreshing: boolean, fetched_at: number | null, error: string | null, refresh: () => void }}
 */
export function useFetcher(key, fetcher, signals = []) {
  const key_json = JSON.stringify(key);
  const signals_json = JSON.stringify(signals);
  const epoch = useDataEpoch();
  const fetcher_ref = useRef(fetcher);
  fetcher_ref.current = fetcher;

  const snapshot = useSyncExternalStore(
    useCallback((/** @type {() => void} */ fn) => subscribe(key_json, fn), [key_json]),
    () => cache.get(key_json)?.snapshot ?? EMPTY,
    () => EMPTY,
  );

  useEffect(() => {
    const s = cache.get(key_json)?.snapshot;
    const stale =
      !s ||
      s.fetched_at === null ||
      s.epoch < epoch ||
      s.signals !== signals_json ||
      Date.now() - s.fetched_at > FRESH_MS;
    if (stale) revalidate(key_json, fetcher_ref.current, signals_json);
  }, [key_json, signals_json, epoch]);

  const refresh = useCallback(() => revalidate(key_json, fetcher_ref.current, signals_json, true), [key_json, signals_json]);

  const has_data = snapshot.fetched_at !== null;
  return {
    data: /** @type {T | null} */ (snapshot.data),
    loading: snapshot.fetching && !has_data,
    refreshing: snapshot.fetching && has_data,
    fetched_at: snapshot.fetched_at,
    error: snapshot.error,
    refresh,
  };
}
