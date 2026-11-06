// @ts-check
"use client";

import { useEffect, useState } from "react";
import { runningFactories } from "@/lib/tauri-api";
import { footerStyle, headingStyle, leadStyle, listStyle, primaryWhen, rowHintStyle, rowStyle } from "@/components/AddFlow/styles";

/** @typedef {'here' | 'elsewhere' | 'none'} Where */

/**
 * The first question. When a factory is already running here, that's the
 * default; otherwise nothing is selected, so the user is asked, not steered.
 *
 * @param {{ onNext: (where: Where) => void }} props
 * @returns {React.JSX.Element}
 */
export default function StepWhere({ onNext }) {
  const [where, set_where] = useState(/** @type {Where | null} */ (null));
  const [running, set_running] = useState(0);

  useEffect(() => {
    let cancelled = false;
    runningFactories("local")
      .then((r) => {
        if (cancelled) return;
        set_running(r.running.length);
        if (r.running.length > 0) set_where((w) => w ?? "here");
      })
      .catch(() => {}); // Node may not be here at all; that's only a problem if they pick this computer
    return () => {
      cancelled = true;
    };
  }, []);

  /** @type {[Where, string, string][]} */
  const options = [
    ["here", "On this computer", running > 0 ? `${running} ${running === 1 ? "factory" : "factories"} running here` : "You'll pick the folder"],
    ["elsewhere", "On another computer", "Reached over SSH"],
    ["none", "I don't have a factory yet", "Show me how to make one"],
  ];

  return (
    <>
      <h1 style={headingStyle}>Welcome to Control Room</h1>
      <p style={leadStyle}>
        Control Room shows what your factories are doing, on this computer or on others you can reach. A factory is a
        repo that runs your lines.
      </p>
      <h2 style={questionStyle}>Where do your factories run?</h2>
      <div style={listStyle} role="radiogroup">
        {options.map(([value, label, hint]) => (
          <label key={value} style={rowStyle}>
            <input type="radio" name="where" checked={where === value} onChange={() => set_where(value)} />
            <span style={{ flex: 1 }}>{label}</span>
            <span style={rowHintStyle}>{hint}</span>
          </label>
        ))}
      </div>
      <div style={footerStyle}>
        <button type="button" disabled={!where} style={primaryWhen(!!where)} onClick={() => where && onNext(where)}>
          Continue
        </button>
      </div>
    </>
  );
}

/** @type {React.CSSProperties} */
const questionStyle = { margin: "0 0 12px", fontSize: 15, fontWeight: 600 };
