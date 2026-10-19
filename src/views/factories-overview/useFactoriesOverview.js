// @ts-check
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadConfig, factoryStart, factoryStop, factoryStatus } from "@/lib/tauri-api";

const POLL_INTERVAL_MS = 2000;

/**
 * @typedef {Object} FactoryOverviewRow
 * @property {string} name
 * @property {string} status
 * @property {number | null} pid
 * @property {number | null} cpu
 * @property {number | null} memory
 */

/**
 * Live status across every factory on `host`, refreshed every 2s while this
 * hook is mounted. This is a deliberate, scoped exception to the app's usual
 * manual-refresh-only pattern: `pm2 jlist` is a cheap daemon-state read (not
 * a factory-repo filesystem walk), and CPU/RAM is only meaningful live. The
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
  const factories_ref = useRef(/** @type {string[]} */ ([]));

  const tick = useCallback(async () => {
    try {
      const cfg = await loadConfig();
      const factories = (cfg?.hosts.find((h) => h.name === host)?.factories ?? []).map((w) => w.name);
      factories_ref.current = factories;

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

  const startAll = useCallback(async () => {
    await Promise.allSettled(factories_ref.current.map((w) => factoryStart(host, w)));
    await tick();
  }, [host, tick]);

  const stopAll = useCallback(async () => {
    await Promise.allSettled(factories_ref.current.map((w) => factoryStop(host, w)));
    await tick();
  }, [host, tick]);

  return { rows, error, startAll, stopAll };
}
