// @ts-check
"use client";

import { useCallback, useEffect, useState } from "react";
import { loadConfig, factoryStart, factoryStop, factoryStatus, showError } from "@/lib/tauri-api";

const POLL_INTERVAL_MS = 2000;

/**
 * @typedef {Object} FactoryOverviewRow
 * @property {string} name
 * @property {string} status
 * @property {string | null} pid
 * @property {number | null} cpu
 * @property {number | null} memory
 */

/**
 * Live status across every factory on `host`, refreshed every 2s while this
 * hook is mounted. This is a deliberate, scoped exception to the app's usual
 * manual-refresh-only pattern: a process scan is cheap (not a factory-repo
 * filesystem walk), and CPU/RAM is only meaningful live. The
 * interval is cleared on unmount, so it only ever runs while this specific
 * tab is the active one (TabContent fully unmounts inactive tabs).
 *
 * @param {string} host
 * @returns {{
 *   rows: FactoryOverviewRow[] | null,
 *   error: string | null,
 *   startAll: () => Promise<void>,
 *   stopAll: () => Promise<void>,
 * }}
 */
export function useFactoriesOverview(host) {
  const [rows, set_rows] = useState(/** @type {FactoryOverviewRow[] | null} */ (null));
  const [error, set_error] = useState(/** @type {string | null} */ (null));

  const tick = useCallback(async () => {
    try {
      const cfg = await loadConfig();
      const factories = (cfg?.hosts.find((h) => h.name === host)?.factories ?? []).map((w) => w.name);

      const statuses = await Promise.all(
        factories.map((w) =>
          factoryStatus(host, w).catch((err) => ({
            status: `error: ${String(err)}`,
            pid: null,
            cpu: null,
            memory: null,
          })),
        ),
      );
      set_rows(factories.map((w, i) => ({ name: w, ...statuses[i] })));
      set_error(null);
    } catch (err) {
      set_error(String(err));
    }
  }, [host]);

  useEffect(() => {
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tick]);

  /**
   * Run `action` on the factories whose last status is `status`, then report
   * any that failed or were refused (e.g. one run directly, which pm2 can't stop).
   * @param {string} status
   * @param {(host: string, factory: string) => Promise<void>} action
   */
  const runAll = useCallback(
    async (status, action) => {
      const names = (rows ?? []).filter((r) => r.status === status).map((r) => r.name);
      const results = await Promise.allSettled(names.map((w) => action(host, w)));
      const failed = results.flatMap((r, i) => (r.status === "rejected" ? [`${names[i]}: ${String(r.reason)}`] : []));
      await tick();
      if (failed.length > 0) await showError(failed.join("\n"));
    },
    [host, rows, tick],
  );
  const startAll = useCallback(() => runAll("stopped", factoryStart), [runAll]);
  const stopAll = useCallback(() => runAll("online", factoryStop), [runAll]);

  return { rows, error, startAll, stopAll };
}
