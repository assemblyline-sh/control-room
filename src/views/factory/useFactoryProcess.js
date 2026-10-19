// @ts-check
"use client";

import { useCallback } from "react";
import { factoryRestart, factoryStart, factoryStatus, factoryStop, showError } from "@/lib/tauri-api";
import { useFetcher } from "@/lib/use-fetcher";

/**
 * @typedef {import("@/lib/tauri-api").FactoryProcessStatus} FactoryProcessStatus
 */

/**
 * pm2 process control + status for one factory repo. `status.status` is
 * "online" (under pm2), "direct" (run outside pm2, which pm2 can't stop) or
 * "stopped". A refused or failed action is shown in a dialog, then the status
 * is re-read.
 *
 * @param {string} host
 * @param {string} factory - name in the central config
 * @returns {{
 *   status: FactoryProcessStatus | null,
 *   is_running: boolean,
 *   is_direct: boolean,
 *   loading: boolean,
 *   error: string | null,
 *   refresh: () => void,
 *   start: () => Promise<void>,
 *   stop: () => Promise<void>,
 *   restart: () => Promise<void>,
 * }}
 */
export function useFactoryProcess(host, factory) {
  const { data, loading, refreshing, error, refresh } = useFetcher(["factoryStatus", host, factory], () => factoryStatus(host, factory));

  /** @param {(host: string, factory: string) => Promise<void>} action */
  const run = useCallback(
    async (action) => {
      await action(host, factory).catch(showError);
      refresh();
    },
    [host, factory, refresh],
  );
  const start = useCallback(() => run(factoryStart), [run]);
  const stop = useCallback(() => run(factoryStop), [run]);
  const restart = useCallback(() => run(factoryRestart), [run]);

  return {
    status: data,
    is_running: data?.status === "online",
    is_direct: data?.status === "direct",
    loading: loading || refreshing,
    error,
    refresh,
    start,
    stop,
    restart,
  };
}
