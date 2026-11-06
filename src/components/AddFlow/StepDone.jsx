// @ts-check
"use client";

import { footerStyle, headingStyle, leadStyle, listStyle, noteStyle, primaryStyle, rowStyle } from "@/components/AddFlow/styles";

/**
 * @param {{ computer: string, names: string[], onFinish: () => void }} props
 * @returns {React.JSX.Element}
 */
export default function StepDone({ computer, names, onFinish }) {
  return (
    <>
      <h1 style={headingStyle}>You&apos;re set</h1>
      <p style={leadStyle}>Added from {computer}:</p>
      <div style={listStyle}>
        {names.map((name) => (
          <div key={name} style={{ ...rowStyle, cursor: "default" }}>
            {name}
          </div>
        ))}
      </div>
      <p style={noteStyle}>
        Saved to <code>~/.al/al-control/config.yml</code>, which the al-control CLI also uses.
      </p>
      <div style={footerStyle}>
        <button type="button" style={primaryStyle} onClick={onFinish}>
          Open Control Room
        </button>
      </div>
    </>
  );
}
