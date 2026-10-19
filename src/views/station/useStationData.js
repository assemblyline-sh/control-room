// @ts-check
"use client";

import { showStation } from "@/lib/tauri-api";
import { useFetcher } from "@/lib/use-fetcher";

/**
 * @param {string} host
 * @param {string} factory - name in the central config
 * @param {string} line
 * @param {string} station
 */
export function useStationData(host, factory, line, station) {
  return useFetcher(["showStation", host, factory, line, station], () => showStation(host, factory, line, station));
}
