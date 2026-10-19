// @ts-check
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { onSshCall, onSshStderr } from "@/lib/tauri-api";

/**
 * @typedef {{
 *   state: 'idle' | 'busy' | 'ok' | 'error',
 *   message: string | null,
 *   login_url: string | null,
 *   in_flight: number,
 * }} HostSsh
 */

const SshContext = createContext(/** @type {Record<string, HostSsh>} */ ({}));

const URL_RE = /https?:\/\/\S+/;

/**
 * Connection state per remote host, from the SSH source's events. A URL on
 * ssh's stderr while a call is in flight is a sign-in prompt (Tailscale
 * SSH's check mode) — kept until that host's calls finish.
 *
 * @param {{ children: React.ReactNode }} props
 * @returns {React.JSX.Element}
 */
export function SshProvider({ children }) {
  const [hosts, set_hosts] = useState(/** @type {Record<string, HostSsh>} */ ({}));

  useEffect(() => {
    // listen() resolves async; if cleanup already ran (StrictMode remount),
    // drop the listener as soon as it arrives instead of leaking it.
    let cancelled = false;
    /** @type {(() => void)[]} */
    const unlisten = [];
    /** @param {() => void} u */
    const keep = (u) => (cancelled ? u() : unlisten.push(u));
    /** @param {string} host @param {(h: HostSsh) => HostSsh} fn */
    const update = (host, fn) =>
      set_hosts((prev) => ({
        ...prev,
        [host]: fn(prev[host] ?? { state: "idle", message: null, login_url: null, in_flight: 0 }),
      }));

    onSshCall(({ host, phase, message }) => {
      update(host, (h) => {
        if (phase === "start") return { ...h, state: "busy", in_flight: h.in_flight + 1 };
        const in_flight = Math.max(0, h.in_flight - 1);
        return {
          state: in_flight > 0 ? "busy" : phase === "ok" ? "ok" : "error",
          message: phase === "error" ? message : null,
          login_url: in_flight > 0 ? h.login_url : null,
          in_flight,
        };
      });
    }).then(keep);

    onSshStderr(({ host, line }) => {
      const url = line.match(URL_RE)?.[0];
      if (url) update(host, (h) => ({ ...h, login_url: url }));
    }).then(keep);

    return () => {
      cancelled = true;
      unlisten.forEach((u) => u());
    };
  }, []);

  return <SshContext.Provider value={hosts}>{children}</SshContext.Provider>;
}

/**
 * @param {string} host
 * @returns {HostSsh}
 */
export function useHostSsh(host) {
  return useContext(SshContext)[host] ?? { state: "idle", message: null, login_url: null, in_flight: 0 };
}
