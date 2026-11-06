// @ts-check
"use client";

import { useEffect, useState } from "react";
import { listSshHosts, loadConfig } from "@/lib/tauri-api";
import { footerStyle, headingStyle, inputStyle, leadStyle, noteStyle, primaryWhen, secondaryStyle } from "@/components/AddFlow/styles";

const TYPE_A_NAME = "\u0000type";

/**
 * @typedef {{ value: string, label: string, saved: boolean }} Option
 */

/**
 * Which computer. Offers what's in the ssh config, plus hosts saved earlier
 * that have no factories yet (someone who left part-way through). Hosts that
 * already have factories aren't offered: their rail has "Add factory".
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
  const [choice, set_choice] = useState("");
  const [typed, set_typed] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [aliases, cfg] = await Promise.all([listSshHosts(), loadConfig().catch(() => null)]);
      if (cancelled) return;
      const remote = (cfg?.hosts ?? []).filter((h) => !h.is_local);
      const saved = remote.filter((h) => h.factories.length === 0).map((h) => ({ value: h.name, label: `${h.name} (already added)`, saved: true }));
      const fresh = aliases.filter((a) => !remote.some((h) => h.ssh === a)).map((a) => ({ value: a, label: a, saved: false }));
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
  const saved = !typing && !!options?.find((o) => o.value === choice)?.saved;

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
        Control Room connects the way <code>ssh {name || "my-server"}</code> does in a terminal. That needs to work without
        typing a password.
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
          onClick={() => onNext(saved ? { saved: name } : { ssh: name })}
        >
          Connect
        </button>
      </div>
    </>
  );
}
