// @ts-check
"use client";

import { listFailures } from "@/lib/tauri-api";
import { useFetcher } from "@/lib/use-fetcher";

/**
 * @param {string} host
 * @param {string} factory - "" for every factory on the host
 */
export function useFailuresData(host, factory) {
  return useFetcher(["listFailures", host, factory], () => listFailures(host, factory || undefined));
}
