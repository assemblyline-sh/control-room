// @ts-check
"use client";

import { showLine } from "@/lib/tauri-api";
import { useFetcher } from "@/lib/use-fetcher";

/**
 * @param {string} host
 * @param {string} factory - name in the central config
 * @param {string} line
 */
export function useLineData(host, factory, line) {
  return useFetcher(["showLine", host, factory, line], () => showLine(host, factory, line));
}
