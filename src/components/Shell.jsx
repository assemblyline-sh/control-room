// @ts-check
"use client";

import { useEffect } from "react";
import { ConfigProvider } from "@/state/config-context";
import { SshProvider } from "@/state/ssh-context";
import { useConfig } from "@/state/config-context";
import { useCountsPoller } from "@/state/counts-store";
import { TabsProvider } from "@/state/tabs-context";
import { TreeProvider } from "@/state/tree-context";
import { ClearProvider } from "@/state/clear-context";
import { useTabs } from "@/state/tabs-context";
import Rail from "@/components/Rail/Rail";
import TabStrip from "@/components/TabStrip/TabStrip";
import TabContent from "@/components/TabContent";
import SignInBanner from "@/components/SignInBanner";

/**
 * @typedef {import("@/lib/tauri-api").CentralConfig} CentralConfig
 */

/**
 * Top-level shell: rail | (tab strip + tab content). Owns the tabs and
 * tree state providers; everything below pulls via useTabs/useTree hooks.
 *
 * @param {{ config: CentralConfig, onAddFactory: () => void }} props
 * @returns {React.JSX.Element}
 */
export default function Shell({ config, onAddFactory }) {
  return (
    <ConfigProvider initial={config}>
      <SshProvider>
        <TabsProvider>
          <TreeProvider>
            <ClearProvider>
              <ShellBody onAddFactory={onAddFactory} />
            </ClearProvider>
          </TreeProvider>
        </TabsProvider>
      </SshProvider>
    </ConfigProvider>
  );
}

/**
 * @param {{ onAddFactory: () => void }} props
 * @returns {React.JSX.Element}
 */
function ShellBody({ onAddFactory }) {
  useShellKeyboard();
  useCountsPoller(useConfig().host.name);
  return (
    <div style={shellStyle}>
      <Rail onAddFactory={onAddFactory} />
      <main style={paneStyle}>
        <SignInBanner />
        <TabStrip />
        <TabContent />
      </main>
    </div>
  );
}

const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

/**
 * App-level keyboard shortcuts. Lives inside the providers so it can call
 * useTabs() to read the current active tab and dispatch close / switch.
 * The modifier is Cmd on macOS and Ctrl elsewhere; Ctrl-Tab works on both.
 * Inside a terminal, Ctrl keys belong to the shell (Ctrl-W deletes a word).
 *
 *   Cmd-W / Ctrl-W                → close the active tab
 *   Cmd-Alt-Right / Ctrl-Tab      → next tab
 *   Cmd-Alt-Left / Ctrl-Shift-Tab → previous tab
 *   Cmd-Shift-]                   → next tab (VS Code style on macOS)
 *   Cmd-Shift-[                   → previous tab
 */
function useShellKeyboard() {
  const { state, dispatch } = useTabs();

  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      const in_terminal = e.target instanceof Element && e.target.closest(".xterm") !== null;
      const ctrl_tab = e.ctrlKey && e.key === "Tab" && !in_terminal;
      const meta = IS_MAC ? e.metaKey : e.ctrlKey && !in_terminal;
      if (!meta && !ctrl_tab) return;

      const tabs = state.tabs;
      const active_idx = state.active_id
        ? tabs.findIndex((t) => t.id === state.active_id)
        : -1;

      // Close active tab.
      if (e.key === "w" && meta && !e.altKey) {
        if (state.active_id) {
          e.preventDefault();
          dispatch({ type: "close_tab", id: state.active_id });
        }
        return;
      }

      // Cycle tabs.
      const cycle = (delta) => {
        if (tabs.length === 0) return;
        const i = active_idx === -1 ? 0 : (active_idx + delta + tabs.length) % tabs.length;
        dispatch({ type: "set_active", id: tabs[i].id });
      };

      // Cmd-Alt-Right / Cmd-Alt-Left (macOS-ish).
      if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        cycle(e.key === "ArrowRight" ? 1 : -1);
        return;
      }

      // Cmd-Shift-] / Cmd-Shift-[ (VS Code tab cycling on macOS). Shift
      // mutates the key into "}"/"{" on most keyboards — match both forms.
      if (
        e.metaKey &&
        e.shiftKey &&
        (e.key === "]" || e.key === "[" || e.key === "}" || e.key === "{")
      ) {
        e.preventDefault();
        cycle(e.key === "]" || e.key === "}" ? 1 : -1);
        return;
      }

      // Ctrl-Tab / Ctrl-Shift-Tab (classic editor cycling).
      if (e.key === "Tab") {
        e.preventDefault();
        cycle(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, dispatch]);
}

/** @type {React.CSSProperties} */
const shellStyle = {
  height: "100vh",
  display: "grid",
  gridTemplateColumns: "280px 1fr",
  background: "var(--background)",
  color: "var(--foreground)",
};

/** @type {React.CSSProperties} */
const paneStyle = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
  borderLeft: "1px solid var(--border)",
};
