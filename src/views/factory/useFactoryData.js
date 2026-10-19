// @ts-check
"use client";

import { listLines } from "@/lib/tauri-api";
import { useFetcher } from "@/lib/use-fetcher";

/**
 * @param {string} host
 * @param {string} factory - name in the central config
 */
export function useFactoryData(host, factory) {
  return useFetcher(["listLines", host, factory], () => listLines(host, factory));
}
