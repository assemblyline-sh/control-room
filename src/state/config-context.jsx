// @ts-check
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { claimWindowHost, loadConfig } from "@/lib/tauri-api";

/**
 * @typedef {import("@/lib/tauri-api").CentralConfig} CentralConfig
 * @typedef {import("@/lib/tauri-api").ConfigHost} ConfigHost
 */

/**
 * @typedef {{
 *   config: CentralConfig,
 *   host: ConfigHost,
 *   reload: () => Promise<void>,
 *   factoryRoot: (host: string, factory: string) => string | null,
 * }} ConfigContextValue
 */

const ConfigContext = createContext(/** @type {ConfigContextValue | null} */ (null));

const HOST_STORAGE_KEY = "control-room.host";

/**
 * Each window shows one host for its life. A window opened for a host has
 * it injected (`window.__CONTROL_ROOM_HOST__`, see windows.rs); the main window
 * takes the host last focused, remembered in localStorage. It never writes
 * the config's `current_host` — a window must not retarget the al-control
 * CLI in a terminal.
 *
 * @param {CentralConfig} config
 * @returns {string}
 */
function initialHost(config) {
  const names = config.hosts.map((h) => h.name);
  const bound = /** @type {any} */ (window).__CONTROL_ROOM_HOST__;
  if (typeof bound === "string" && names.includes(bound)) return bound;
  let saved = null;
  try {
    saved = localStorage.getItem(HOST_STORAGE_KEY);
  } catch {
    // storage unavailable — fall through to the default
  }
  if (saved && names.includes(saved)) return saved;
  if (names.includes("local")) return "local";
  return names[0];
}

/**
 * @param {{ initial: CentralConfig, children: React.ReactNode }} props
 * @returns {React.JSX.Element}
 */
export function ConfigProvider({ initial, children }) {
  const [config, set_config] = useState(initial);
  const [host_name] = useState(() => initialHost(initial));

  useEffect(() => {
    claimWindowHost(host_name).catch(() => {});
    const remember = () => {
      try {
        localStorage.setItem(HOST_STORAGE_KEY, host_name);
      } catch {
        // not remembered — fine
      }
    };
    remember();
    window.addEventListener("focus", remember);
    return () => window.removeEventListener("focus", remember);
  }, [host_name]);

  const reload = useCallback(async () => {
    const cfg = await loadConfig();
    if (cfg) set_config(cfg);
  }, []);

  const value = useMemo(() => {
    const host = config.hosts.find((h) => h.name === host_name) ?? config.hosts[0];
    /** @type {ConfigContextValue["factoryRoot"]} */
    const factoryRoot = (h, w) =>
      config.hosts.find((x) => x.name === h)?.factories.find((x) => x.name === w)?.abs_path ?? null;
    return { config, host, reload, factoryRoot };
  }, [config, host_name, reload]);

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

/**
 * @returns {ConfigContextValue}
 */
export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be inside <ConfigProvider>");
  return ctx;
}
