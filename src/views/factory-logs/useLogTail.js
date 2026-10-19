// @ts-check
"use client";

import { useEffect, useRef, useState } from "react";
import { logTailKey, startLogTail, stopLogTail, onPm2Log } from "@/lib/tauri-api";

/**
 * Live-tail a factory's pm2 logs via Tauri events. Starting the tail and
 * subscribing both happen on mount; both are torn down on unmount (or when
 * the factory changes). `TabContent` keeps inactive tabs mounted, so the
 * tail keeps streaming while you're on another tab (like a terminal) and
 * stops when the logs tab is closed.
 *
 * Lines are pushed to `onLine` as they arrive rather than accumulated in
 * React state, so a chatty factory doesn't force a re-render per line —
 * the caller (xterm.js) owns its own scrollback buffer.
 *
 * @param {string} host
 * @param {string} factory - name in the central config
 * @param {(line: string) => void} onLine
 * @returns {{ status: 'connecting' | 'streaming' | 'error', error: string | null }}
 */
export function useLogTail(host, factory, onLine) {
  const [status, set_status] = useState(/** @type {'connecting' | 'streaming' | 'error'} */ ("connecting"));
  const [error, set_error] = useState(/** @type {string | null} */ (null));
  const on_line_ref = useRef(onLine);
  on_line_ref.current = onLine;

  useEffect(() => {
    let cancelled = false;
    /** @type {(() => void) | null} */
    let unlisten = null;
    const key = logTailKey(host, factory);

    set_status("connecting");
    set_error(null);

    (async () => {
      try {
        unlisten = await onPm2Log((payload) => {
          if (payload.key === key) on_line_ref.current(payload.line);
        });
        await startLogTail(host, factory);
        if (!cancelled) set_status("streaming");
      } catch (err) {
        if (!cancelled) {
          set_status("error");
          set_error(String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      stopLogTail(host, factory).catch(() => {});
    };
  }, [host, factory]);

  return { status, error };
}

