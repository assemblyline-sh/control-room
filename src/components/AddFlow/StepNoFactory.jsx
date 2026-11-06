// @ts-check
"use client";

import { openUrl } from "@/lib/tauri-api";
import { footerStyle, headingStyle, leadStyle, primaryStyle, secondaryStyle } from "@/components/AddFlow/styles";

const QUICKSTART = "https://assemblyline.sh/docs/quickstart";

/**
 * Control Room shows factories; it doesn't make them. Say so, and point at
 * what does.
 *
 * @param {{ onBack: () => void }} props
 * @returns {React.JSX.Element}
 */
export default function StepNoFactory({ onBack }) {
  return (
    <>
      <h1 style={headingStyle}>Make a factory first</h1>
      <p style={leadStyle}>
        Control Room shows factories that already exist. A new factory starts from the <code>factory-template</code>{" "}
        repo, and the quickstart takes you through it. Come back here once it&apos;s made.
      </p>
      <div style={footerStyle}>
        <button type="button" style={secondaryStyle} onClick={onBack}>
          Back
        </button>
        <button type="button" style={primaryStyle} onClick={() => openUrl(QUICKSTART)}>
          Open the quickstart
        </button>
      </div>
    </>
  );
}
