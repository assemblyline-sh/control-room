// @ts-check
"use client";

import { listFailures, showWorkpiece } from "@/lib/tauri-api";
import { useFetcher } from "@/lib/use-fetcher";

/**
 * @param {string} host
 * @param {string} factory - name in the central config
 * @param {string} workpiece_id
 */
export function useWorkpieceData(host, factory, workpiece_id) {
  return useFetcher(["showWorkpiece", host, factory, workpiece_id], () => showWorkpiece(host, factory, workpiece_id));
}

/**
 * How many other failed workpieces in this factory share `error_key` — for the
 * error panel's link to the Failures tab. Null when there's no key.
 * @param {string} host
 * @param {string} factory
 * @param {string | null | undefined} error_key
 */
export function useSameErrorCount(host, factory, error_key) {
  return useFetcher(["sameErrorCount", host, factory, error_key], async () => {
    if (!error_key) return null;
    const [w] = await listFailures(host, factory);
    return (w?.failures ?? []).filter((f) => !f.orphan && f.key === error_key).length - 1;
  });
}
