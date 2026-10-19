// @ts-check
"use client";

import { useCallback } from "react";
import { factoryStart, factoryStop, factoryStatus } from "@/lib/tauri-api";
import { useFetcher } from "@/lib/use-fetcher";

/**
 * @typedef {import("@/lib/tauri-api").FactoryProcessStatus} FactoryProcessStatus
 */

/**
 * pm2 process control + status for one factory repo. `is_running` is the
 * simple boolean a Play/Stop button needs; `status` carries the full
 * pid/cpu/memory detail for richer views.
 *
 * @param {string} host
 * @param {string} factory - name in the central config
 * @returns {{
 *   status: FactoryProcessStatus | null,
 *   is_running: boolean,
 *   loading: boolean,
 *   error: string | null,
 *   refresh: () => void,
 *   start: () => Promise<void>,
 *   stop: () => Promise<void>,
 * }}
 */
export function useFactoryProcess(host, factory) {
  const { data, loading, refreshing, error, refresh } = useFetcher(["factoryStatus", host, factory], () => factoryStatus(host, factory));

  const start = useCallback(async () => {
    await factoryStart(host, factory);
    refresh();
  }, [host, factory, refresh]);

  const stop = useCallback(async () => {
    await factoryStop(host, factory);
    refresh();
  }, [host, factory, refresh]);

  return {
    status: data,
    is_running: data?.status === "online",
    loading: loading || refreshing,
    error,
    refresh,
    start,
    stop,
  };
}
