// @ts-check
"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useLogTail } from "@/views/factory-logs/useLogTail";
import { useTabVisible } from "@/state/tab-visible";
import ViewLayout from "@/components/ViewLayout";

/**
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 */

/**
 * Live-tailing pm2 logs for one factory, rendered in xterm.js for correct
 * ANSI color handling (pm2 colorizes each app's log output). Read-only — no
 * keyboard input is wired back to the underlying process.
 *
 * @param {{ resource: Extract<ResourceId, { type: 'factory-logs' }> }} props
 * @returns {React.JSX.Element}
 */
export default function ViewFactoryLogs({ resource }) {
  const container_ref = useRef(/** @type {HTMLDivElement | null} */ (null));
  const term_ref = useRef(/** @type {Terminal | null} */ (null));
  const fit_ref = useRef(/** @type {FitAddon | null} */ (null));
  const visible = useTabVisible();

  useEffect(() => {
    if (!container_ref.current) return;

    const term = new Terminal({
      convertEol: true,
      disableStdin: true,
      fontSize: 12,
      fontFamily: "ui-monospace, Menlo, monospace",
      theme: { background: "#00000000" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container_ref.current);
    fit.fit();
    term_ref.current = term;
    fit_ref.current = fit;

    const on_resize = () => fit.fit();
    window.addEventListener("resize", on_resize);

    return () => {
      window.removeEventListener("resize", on_resize);
      term.dispose();
      term_ref.current = null;
      fit_ref.current = null;
    };
  }, [resource.host, resource.factory]);

  // A hidden tab has no size; fit to the pane once it's shown again.
  useEffect(() => {
    if (visible) fit_ref.current?.fit();
  }, [visible]);

  const { status, error } = useLogTail(resource.host, resource.factory, (line) => {
    term_ref.current?.writeln(line);
  });

  return (
    <ViewLayout
      title={`${resource.factory} — logs`}
      sub={statusLabel(status)}
      error={error}
    >
      <div ref={container_ref} style={terminalContainerStyle} />
    </ViewLayout>
  );
}

/** @param {'connecting' | 'streaming' | 'error'} status */
function statusLabel(status) {
  if (status === "connecting") return "Connecting…";
  if (status === "streaming") return "Live";
  return "Disconnected";
}


/** @type {React.CSSProperties} */
const terminalContainerStyle = {
  height: "100%",
  minHeight: 0,
};
