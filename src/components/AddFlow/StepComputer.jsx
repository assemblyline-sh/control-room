// @ts-check
"use client";

import { useEffect, useState } from "react";
import { listSshHosts, loadConfig } from "@/lib/tauri-api";
import { savedHostFor } from "@/lib/saved-host";
import { footerStyle, headingStyle, inputStyle, leadStyle, noteStyle, primaryWhen, secondaryStyle } from "@/components/AddFlow/styles";

const TYPE_A_NAME = "\u0000type";

/**
 * @typedef {{ value: string, label: string, saved: boolean }} Option
 * @typedef {import("@/lib/tauri-api").ConfigHost} ConfigHost
 */

/**
 * Which computer. Offers the hosts saved earlier, then what's in the ssh
 * config. A saved host, however it's typed (`user@` or not), goes to its
 * factories instead of being added again.
 *
 * @param {{
 *   onBack?: () => void,
 *   backLabel: string,
 *   onNext: (choice: { ssh: string } | { saved: string }) => void,
 * }} props
 * @returns {React.JSX.Element}
 */
export default function StepComputer({ onBack, backLabel, onNext }) {
  const [options, set_options] = useState(/** @type {Option[] | null} */ (null));
  const [hosts, set_hosts] = useState(/** @type {ConfigHost[]} */ ([]));
  const [choice, set_choice] = useState("");
  const [typed, set_typed] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [aliases, cfg] = await Promise.all([listSshHosts(), loadConfig().catch(() => null)]);
      if (cancelled) return;
      const remote = (cfg?.hosts ?? []).filter((h) => !h.is_local);
      set_hosts(remote);
      const saved = remote.map((h) => ({ value: h.name, label: `${h.name} (already added)`, saved: true }));
      const fresh = aliases.filter((a) => !savedHostFor(remote, a)).map((a) => ({ value: a, label: a, saved: false }));
      const list = [...saved, ...fresh];
      set_options(list);
      if (list.length === 0) set_choice(TYPE_A_NAME);
      if (list.length === 1) set_choice(list[0].value);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const typing = choice === TYPE_A_NAME;
  const name = typing ? typed.trim() : choice;
  const saved = savedHostFor(hosts, name);

  return (
    <>
      <h1 style={headingStyle}>Which computer are your factories on?</h1>
      <p style={leadStyle}>This is the computer (host) Control Room will connect to.</p>
      {options && options.length > 0 && (
        <select style={inputStyle} aria-label="Computer" value={choice} onChange={(e) => set_choice(e.target.value)}>
          <option value="" disabled>
            Choose a computer…
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          <option value={TYPE_A_NAME}>Type a name…</option>
        </select>
      )}
      {typing && (
        <input
          style={{ ...inputStyle, marginTop: options?.length ? 8 : 0 }}
          aria-label="Computer name"
          placeholder="my-server, or user@my-server"
          autoFocus
          value={typed}
          onChange={(e) => set_typed(e.target.value)}
        />
      )}
      <p style={noteStyle}>
        {saved ? (
          <>
            <code>{saved}</code> is already added. Next you can add more of its factories, or open it.
          </>
        ) : (
          <>
            Control Room connects the way <code>ssh {name || "my-server"}</code> does in a terminal. That needs to work
            without typing a password.
          </>
        )}
      </p>
      <div style={footerStyle}>
        {onBack && (
          <button type="button" style={secondaryStyle} onClick={onBack}>
            {backLabel}
          </button>
        )}
        <button
          type="button"
          disabled={!name}
          style={primaryWhen(!!name)}
          onClick={() => onNext(saved ? { saved } : { ssh: name })}
        >
          {saved ? "Next" : "Connect"}
        </button>
      </div>
    </>
  );
}
