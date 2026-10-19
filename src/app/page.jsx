// @ts-check
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadConfig } from "@/lib/tauri-api";
import Shell from "@/components/Shell";

/**
 * @typedef {import("@/lib/tauri-api").CentralConfig} CentralConfig
 */

/**
 * Boot: load the central config (~/.assemblyline/al-control/config.yml), route
 * to onboarding when no host has any factories, else render the shell.
 */
export default function ControlRoomPage() {
  const router = useRouter();
  const [config, set_config] = useState(/** @type {CentralConfig | null} */ (null));
  const [error, set_error] = useState(/** @type {string | null} */ (null));
  const [loading, set_loading] = useState(true);

  /** @param {CentralConfig | null} cfg */
  const route = useCallback(
    (cfg) => {
      if (!cfg || cfg.hosts.every((h) => h.factories.length === 0)) {
        router.replace("/onboarding");
        return;
      }
      set_config(cfg);
    },
    [router],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await loadConfig();
        if (!cancelled) route(cfg);
      } catch (err) {
        if (!cancelled) set_error(String(err));
      } finally {
        if (!cancelled) set_loading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route]);

  const goToOnboarding = useCallback(() => router.push("/onboarding"), [router]);

  if (loading) return <div style={centerStyle}>Loading…</div>;

  if (error) {
    return (
      <div style={centerStyle}>
        <div style={cardStyle}>
          <h1 style={titleStyle}>Can&apos;t read the al-control config</h1>
          <pre style={errorStyle}>{error}</pre>
          <p style={hintStyle}>
            Control Room and the al-control CLI share <code>~/.assemblyline/al-control/config.yml</code>.
            Fix the file, then reload (Cmd-R).
          </p>
        </div>
      </div>
    );
  }

  if (!config) return null;

  return <Shell config={config} onAddFactory={goToOnboarding} />;
}

/** @type {React.CSSProperties} */
const centerStyle = {
  height: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--muted-foreground)",
  padding: 24,
};

/** @type {React.CSSProperties} */
const cardStyle = {
  maxWidth: 560,
  width: "100%",
  padding: 24,
  border: "1px solid var(--border)",
  borderRadius: 10,
  background: "var(--muted)",
  color: "var(--foreground)",
};

/** @type {React.CSSProperties} */
const titleStyle = { margin: "0 0 12px", fontSize: 18, fontWeight: 600 };

/** @type {React.CSSProperties} */
const hintStyle = { margin: "0 0 12px", fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 };

/** @type {React.CSSProperties} */
const errorStyle = {
  margin: "0 0 12px",
  padding: 12,
  background: "rgba(255, 123, 114, 0.1)",
  color: "#ff7b72",
  fontSize: 12,
  whiteSpace: "pre-wrap",
  borderRadius: 6,
};
