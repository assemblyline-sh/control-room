// @ts-check
"use client";

import { openInFinder } from "@/lib/tauri-api";
import { useConfig } from "@/state/config-context";
import { useHostSsh } from "@/state/ssh-context";

/**
 * Tailscale SSH (check mode) prints a sign-in URL on ssh's stderr and waits.
 * There's no terminal to show it in, so while the selected host has a call
 * waiting on one, show it here. The call carries on once you've signed in.
 *
 * @returns {React.JSX.Element | null}
 */
export default function SignInBanner() {
  const { host } = useConfig();
  const ssh = useHostSsh(host.name);
  if (!ssh.login_url) return null;
  const url = ssh.login_url;
  return (
    <div style={bannerStyle}>
      <span>{host.name} needs you to sign in before it answers.</span>
      <button type="button" style={buttonStyle} onClick={() => openInFinder(url)}>
        Open sign-in page
      </button>
    </div>
  );
}

/** @type {React.CSSProperties} */
const bannerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "8px 16px",
  background: "rgba(227, 179, 65, 0.12)",
  borderBottom: "1px solid var(--border)",
  color: "#e3b341",
  fontSize: 12,
};

/** @type {React.CSSProperties} */
const buttonStyle = {
  padding: "3px 10px",
  background: "transparent",
  border: "1px solid #e3b341",
  borderRadius: 4,
  color: "#e3b341",
  fontSize: 12,
  cursor: "pointer",
};
