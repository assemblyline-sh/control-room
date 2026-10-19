// @ts-check
"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import {
  closeTerminal,
  openTerminalSession,
  openUrl,
  resizeTerminal,
  showError,
  writeTerminal,
} from "@/lib/tauri-api";
import { resourceIdToString } from "@/lib/resource-id";
import { useConfig } from "@/state/config-context";
import { useTabVisible } from "@/state/tab-visible";
import { setTabAttention } from "@/state/tab-attention";
import ViewLayout from "@/components/ViewLayout";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 * @typedef {{ kind: 'connecting' } | { kind: 'open' } | { kind: 'exited', code: number | null } | { kind: 'error', message: string }} Status
 */

const IS_MAC =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

/**
 * A shell in a factory folder (src-tauri/src/terminal.rs): the local login
 * shell, or a plain `ssh -tt` session on a remote host. The tab stays
 * mounted while hidden; the session ends when the tab closes or the
 * connection drops.
 *
 * @param {{ resource: Extract<ResourceId, { type: 'terminal' }> }} props
 * @returns {React.JSX.Element}
 */
export default function ViewTerminal({ resource }) {
  const { host } = useConfig();
  const container_ref = useRef(/** @type {HTMLDivElement | null} */ (null));
  const term_ref = useRef(/** @type {Terminal | null} */ (null));
  const fit_ref = useRef(/** @type {FitAddon | null} */ (null));
  const session_ref = useRef(/** @type {string | null} */ (null));
  const visible = useTabVisible();
  const visible_ref = useRef(visible);
  visible_ref.current = visible;
  const [status, set_status] = useState(
    /** @type {Status} */ ({ kind: "connecting" }),
  );
  const [generation, set_generation] = useState(0);
  const tab_id = resourceIdToString(resource);

  // The xterm instance lives as long as the tab.
  useEffect(() => {
    if (!container_ref.current) return;
    const css = getComputedStyle(document.documentElement);
    const term = new Terminal({
      allowProposedApi: true,
      macOptionIsMeta: true,
      cursorBlink: true,
      scrollback: 10000,
      fontSize: 12,
      fontFamily: "ui-monospace, Menlo, monospace",
      theme: {
        background: css.getPropertyValue("--background").trim() || "#0b0e14",
        foreground: css.getPropertyValue("--foreground").trim() || "#e6edf3",
        selectionBackground: "rgba(88, 166, 255, 0.35)",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.loadAddon(
      new WebLinksAddon((_e, uri) => openUrl(uri).catch(showError)),
    );
    term.open(container_ref.current);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // No WebGL: xterm keeps its DOM renderer.
    }
    fit.fit();

    const send = (/** @type {string} */ data) => {
      if (session_ref.current)
        writeTerminal(session_ref.current, data).catch(() => {});
    };
    term.onData(send);

    term.attachCustomKeyEventHandler((e) => {
      // Shift+Enter: a newline in Claude Code's / Codex's prompt.
      if (
        e.key === "Enter" &&
        e.shiftKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        if (e.type === "keydown") {
          e.preventDefault();
          send("\x1b\r");
        }
        return false;
      }
      // Copy / paste off macOS (there the Edit menu's Cmd+C / Cmd+V reach xterm).
      if (
        !IS_MAC &&
        e.type === "keydown" &&
        e.ctrlKey &&
        e.shiftKey &&
        (e.key === "C" || e.key === "V")
      ) {
        e.preventDefault();
        if (e.key === "C" && term.hasSelection())
          navigator.clipboard.writeText(term.getSelection()).catch(() => {});
        if (e.key === "V")
          navigator.clipboard
            .readText()
            .then((text) => term.paste(text))
            .catch(() => {});
        return false;
      }
      return true;
    });

    // An agent waiting on you rings the bell or sends a notification (OSC 9 /
    // OSC 777); flag the tab when it isn't the one being looked at.
    const attention = () => {
      if (!visible_ref.current) setTabAttention(tab_id, true);
    };
    term.onBell(attention);
    const osc = [9, 777].map((code) =>
      term.parser.registerOscHandler(code, () => {
        attention();
        return true;
      }),
    );

    let last = { cols: term.cols, rows: term.rows };
    term.onResize(({ cols, rows }) => {
      if (cols === last.cols && rows === last.rows) return;
      last = { cols, rows };
      if (session_ref.current)
        resizeTerminal(session_ref.current, cols, rows).catch(() => {});
    });
    const observer = new ResizeObserver(() => {
      // A hidden tab has no size; it's fitted again when shown.
      if (container_ref.current?.offsetWidth) fit.fit();
    });
    observer.observe(container_ref.current);

    term_ref.current = term;
    fit_ref.current = fit;
    return () => {
      observer.disconnect();
      osc.forEach((d) => d.dispose());
      term.dispose();
      term_ref.current = null;
      fit_ref.current = null;
      setTabAttention(tab_id, false);
    };
  }, [tab_id]);

  // One session per generation; Reconnect starts the next one.
  useEffect(() => {
    const term = term_ref.current;
    if (!term) return;
    let cancelled = false;
    set_status({ kind: "connecting" });
    openTerminalSession({
      host: resource.host,
      factory: resource.factory,
      dir: resource.dir,
      cols: term.cols,
      rows: term.rows,
      onData: (bytes) => {
        if (!cancelled) term.write(bytes);
      },
      onExit: (code) => {
        if (cancelled) return;
        session_ref.current = null;
        set_status({ kind: "exited", code });
        term.write(
          `\r\n\x1b[2m[process exited${code == null ? "" : ` with code ${code}`}]\x1b[0m\r\n`,
        );
      },
    })
      .then((id) => {
        if (cancelled) {
          closeTerminal(id).catch(() => {});
          return;
        }
        session_ref.current = id;
        set_status((s) => (s.kind === "connecting" ? { kind: "open" } : s));
        if (visible_ref.current) term.focus();
      })
      .catch((e) => {
        if (!cancelled) set_status({ kind: "error", message: String(e) });
      });

    return () => {
      cancelled = true;
      if (session_ref.current)
        closeTerminal(session_ref.current).catch(() => {});
      session_ref.current = null;
    };
  }, [resource.host, resource.factory, resource.dir, generation]);

  useEffect(() => {
    if (!visible) return;
    fit_ref.current?.fit();
    term_ref.current?.focus();
  }, [visible]);

  const where = resource.dir
    ? `temp/stations/${resource.dir}`
    : resource.factory;
  const ended = status.kind === "exited" || status.kind === "error";

  return (
    <ViewLayout
      title={`${resource.dir ? resource.dir.split("/").pop() : resource.factory} — terminal`}
      sub={`${where}${host.is_local ? "" : ` on ${host.name}`} · ${statusLabel(status)}`}
      error={status.kind === "error" ? status.message : null}
      actions={
        ended ? (
          <button
            type="button"
            style={buttonStyle}
            onClick={() => set_generation((g) => g + 1)}
          >
            Reconnect
          </button>
        ) : undefined
      }
    >
      <div ref={container_ref} style={terminalStyle} />
    </ViewLayout>
  );
}

/** @param {Status} status */
function statusLabel(status) {
  switch (status.kind) {
    case "connecting":
      return "Connecting…";
    case "open":
      return "Connected";
    case "exited":
      return status.code == null ? "Exited" : `Exited (${status.code})`;
    case "error":
      return "Failed";
  }
}

/** @type {React.CSSProperties} */
const terminalStyle = {
  height: "100%",
  minHeight: 0,
  padding: "4px 0 0 8px",
  boxSizing: "border-box",
};

/** @type {React.CSSProperties} */
const buttonStyle = {
  background: "var(--muted)",
  color: "var(--foreground)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "4px 10px",
  fontSize: 12,
  cursor: "pointer",
};
