// @ts-check
"use client";

import { useEffect, useState } from "react";
import { addHost, detectNode, loadConfig, testHost } from "@/lib/tauri-api";
import { SignInPrompt } from "@/components/SignInBanner";
import ErrorNote from "@/components/AddFlow/ErrorNote";
import { footerStyle, headingStyle, inputStyle, noteStyle, primaryWhen, secondaryStyle } from "@/components/AddFlow/styles";

const OTHER_PATH = "\u0000other";

/**
 * @typedef {import("@/lib/tauri-api").NodeCandidate} NodeCandidate
 * @typedef {import("@/lib/tauri-api").NodeDetection} NodeDetection
 * @typedef {import("@/lib/tauri-api").HostCheck} HostCheck
 * @typedef {'busy' | 'ok' | 'warn' | 'fail' | 'waiting'} CheckState
 */

/**
 * The `node:` a host needs: nothing when plain ssh finds this one, so a Node
 * upgrade there can't break the host.
 * @param {NodeCandidate} candidate
 * @returns {string}
 */
function nodeToSave(candidate) {
  return candidate.plain ? "" : candidate.path;
}

/**
 * Connect to a computer and show each check as it finishes. Which `node` to
 * use is worked out here (see detect_node); the user only sees a choice when
 * there's a real one, or asks for it. Test runs the real probe, so a tick
 * means it works. The host is saved on Continue.
 *
 * @param {{
 *   ssh: string,
 *   onBack?: () => void,
 *   onConnected: (host: string) => void,
 * }} props
 * @returns {React.JSX.Element}
 */
export default function StepConnecting({ ssh, onBack, onConnected }) {
  const computer = ssh.replace(/^.*@/, "");
  const [detection, set_detection] = useState(/** @type {NodeDetection | null} */ (null));
  const [reach_error, set_reach_error] = useState(/** @type {unknown} */ (null));
  const [chosen, set_chosen] = useState("");
  const [other, set_other] = useState("");
  const [node, set_node] = useState(/** @type {string | null} */ (null));
  const [check, set_check] = useState(/** @type {HostCheck | null} */ (null));
  const [check_error, set_check_error] = useState(/** @type {unknown} */ (null));
  const [picking, set_picking] = useState(false);
  const [attempt, set_attempt] = useState(0);
  const [save_error, set_save_error] = useState(/** @type {unknown} */ (null));
  const [saving, set_saving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let reached = false;
      try {
        const found = await detectNode(ssh);
        if (cancelled) return;
        reached = true;
        set_detection(found);
        const best = found.candidates[0];
        if (!best) return;
        set_chosen(best.path);
        const value = nodeToSave(best);
        set_node(value);
        const result = await testHost(ssh, value);
        if (!cancelled) set_check(result);
      } catch (err) {
        if (cancelled) return;
        if (reached) set_check_error(err);
        else set_reach_error(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ssh, attempt]);

  function retry() {
    set_detection(null);
    set_reach_error(null);
    set_node(null);
    set_check(null);
    set_check_error(null);
    set_attempt((a) => a + 1);
  }

  /** @param {string} value - a `node:` value, possibly empty */
  async function test(value) {
    set_node(value);
    set_check(null);
    set_check_error(null);
    try {
      set_check(await testHost(ssh, value));
    } catch (err) {
      set_check_error(err);
    }
  }

  /** @param {string} value */
  function choose(value) {
    set_chosen(value);
    const candidate = detection?.candidates.find((c) => c.path === value);
    if (candidate) {
      test(nodeToSave(candidate));
    } else {
      set_node(null);
      set_check(null);
      set_check_error(null);
    }
  }

  async function next() {
    set_save_error(null);
    set_saving(true);
    try {
      const cfg = await loadConfig();
      const existing = cfg?.hosts.find((h) => h.ssh === ssh);
      if (!existing) await addHost(computer, ssh, node ?? "");
      onConnected(existing?.name ?? computer);
    } catch (err) {
      set_save_error(err);
      set_saving(false);
    }
  }

  const candidates = detection?.candidates ?? [];
  const no_node = !!detection && candidates.length === 0;
  const using = candidates.find((c) => c.path === chosen);
  const testing = node !== null && !check && !check_error;
  const show_choice = !!detection && (detection.ask || no_node || picking || !!check_error);

  const reach_text = detection ? `Reached ${computer}` : reach_error ? `Couldn't reach ${computer}` : `Reaching ${computer}…`;
  const node_text = check_error
    ? "Couldn't use that Node"
    : using
      ? `Found Node ${using.version.replace(/^v/, "")}`
      : check
        ? `Using ${node}`
        : no_node
          ? "No Node found"
          : "Node";
  /** @type {CheckState} */
  const node_state = check ? "ok" : check_error ? "fail" : testing ? "busy" : no_node ? "fail" : "waiting";
  /** @type {CheckState} */
  const pm2_state = !check ? "waiting" : check.pm2_found ? "ok" : "warn";

  return (
    <>
      <h1 style={headingStyle}>{check ? `Connected to ${computer}` : `Connecting to ${computer}`}</h1>
      <SignInPrompt host={ssh} />
      <div style={checksStyle}>
        <Check state={detection ? "ok" : reach_error ? "fail" : "busy"} text={reach_text} />
        <Check state={node_state} text={node_text} />
        <Check state={pm2_state} text={check && !check.pm2_found ? "pm2 isn't available" : check ? "Found pm2" : "pm2"} />
      </div>

      {reach_error ? <ErrorNote error={reach_error} computer={computer} onRetry={retry} /> : null}
      {no_node && !check && <ErrorNote error={`node not found on ${computer}`} computer={computer} onRetry={retry} />}
      {check_error ? <ErrorNote error={check_error} computer={computer} onRetry={() => test(node ?? "")} /> : null}

      {check && !check.pm2_found && (
        <p style={noteStyle}>
          You can look at factories on {computer}, but not start or stop them. To fix that, run{" "}
          <code>npm install -g pm2</code> there and try again, or choose the Node that has it.
        </p>
      )}

      {show_choice ? (
        <div style={{ marginTop: 16 }}>
          <label style={labelStyle} htmlFor="node-choice">
            Which Node should Control Room use?
          </label>
          <select id="node-choice" style={inputStyle} value={chosen} onChange={(e) => choose(e.target.value)}>
            {no_node && <option value="">Choose…</option>}
            {candidates.map((c) => (
              <option key={c.path} value={c.path}>
                {c.version}
                {c.pm2 ? " · has pm2" : ""} · {c.path}
              </option>
            ))}
            <option value={OTHER_PATH}>Other path…</option>
          </select>
          {chosen === OTHER_PATH && (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                style={inputStyle}
                aria-label={`Path to node on ${computer}`}
                placeholder="/usr/local/bin/node"
                value={other}
                onChange={(e) => set_other(e.target.value)}
              />
              <button type="button" style={secondaryStyle} disabled={!other.trim() || testing} onClick={() => test(other.trim())}>
                Use
              </button>
            </div>
          )}
        </div>
      ) : (
        check && (
          <button type="button" style={linkStyle} onClick={() => set_picking(true)}>
            Use a different Node
          </button>
        )
      )}

      {save_error ? <ErrorNote error={save_error} computer={computer} /> : null}

      <div style={footerStyle}>
        {onBack && (
          <button type="button" style={secondaryStyle} onClick={onBack}>
            Back
          </button>
        )}
        <button type="button" disabled={!check || saving} style={primaryWhen(!!check && !saving)} onClick={next}>
          Continue
        </button>
      </div>
    </>
  );
}

/**
 * @param {{ state: CheckState, text: string }} props
 * @returns {React.JSX.Element}
 */
function Check({ state, text }) {
  const [icon, color] = {
    busy: ["…", "var(--muted-foreground)"],
    waiting: ["·", "var(--muted-foreground)"],
    ok: ["✓", "#3fb950"],
    warn: ["!", "#e3b341"],
    fail: ["✗", "#ff7b72"],
  }[state];
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 14, color: state === "waiting" ? "var(--muted-foreground)" : "var(--foreground)" }}>
      <span style={{ width: 14, textAlign: "center", color, fontWeight: 700 }}>{icon}</span>
      <span>{text}</span>
    </div>
  );
}

/** @type {React.CSSProperties} */
const checksStyle = { display: "flex", flexDirection: "column", gap: 8, marginTop: 16 };

/** @type {React.CSSProperties} */
const labelStyle = { display: "block", marginBottom: 6, fontSize: 13 };

/** @type {React.CSSProperties} */
const linkStyle = {
  marginTop: 12,
  padding: 0,
  background: "none",
  border: "none",
  color: "var(--muted-foreground)",
  fontSize: 12,
  textDecoration: "underline",
  cursor: "pointer",
};
