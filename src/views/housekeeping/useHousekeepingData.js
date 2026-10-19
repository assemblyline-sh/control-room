// @ts-check
"use client";

import { planClear } from "@/lib/tauri-api";
import { useFetcher } from "@/lib/use-fetcher";

/**
 * The clear plan the Housekeeping tab renders: every clearable bin on the
 * host (or one factory) under the tab's filter. Read-only.
 *
 * @param {string} host
 * @param {string} factory - "" for every factory on the host
 * @param {import("@/lib/tauri-api").ClearFilter} filter
 */
export function useHousekeepingData(host, factory, filter) {
  return useFetcher(
    ["planClear", host, factory, filter.done, filter.finished, filter.older_than_days],
    () => planClear(host, [factory ? { kind: "factory", factory } : { kind: "host" }], filter),
  );
}
