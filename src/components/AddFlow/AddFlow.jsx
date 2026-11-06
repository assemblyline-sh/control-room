// @ts-check
"use client";

import { useState } from "react";
import StepComputer from "@/components/AddFlow/StepComputer";
import StepConnecting from "@/components/AddFlow/StepConnecting";
import StepDone from "@/components/AddFlow/StepDone";
import StepFactories from "@/components/AddFlow/StepFactories";
import StepNoFactory from "@/components/AddFlow/StepNoFactory";
import StepWhere from "@/components/AddFlow/StepWhere";

/**
 * @typedef {(
 *   { step: 'where' } |
 *   { step: 'no-factory' } |
 *   { step: 'computer' } |
 *   { step: 'connecting', ssh: string } |
 *   { step: 'factories', host: string, computer: string } |
 *   { step: 'done', host: string, computer: string, names: string[] }
 * )} Step
 */

/**
 * The one way to add a host or a factory: one question per screen, for the
 * first run and every add after it. Back walks the screens in order.
 *
 * @param {{
 *   start: Step,
 *   onFinish: (host: string) => void,
 *   onCancel?: () => void,
 * }} props - `onFinish` gets the host to show; `onCancel` is Back on the first screen
 * @returns {React.JSX.Element}
 */
export default function AddFlow({ start, onFinish, onCancel }) {
  const [history, set_history] = useState(/** @type {Step[]} */ ([start]));
  const step = history[history.length - 1];
  /** @param {Step} next */
  const go = (next) => set_history((h) => [...h, next]);
  const back = history.length > 1 ? () => set_history((h) => h.slice(0, -1)) : onCancel;
  const back_label = history.length > 1 ? "Back" : "Cancel";

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        {step.step === "where" && (
          <StepWhere
            onNext={(where) => {
              if (where === "none") go({ step: "no-factory" });
              else if (where === "elsewhere") go({ step: "computer" });
              else go({ step: "factories", host: "local", computer: "this computer" });
            }}
          />
        )}
        {step.step === "no-factory" && <StepNoFactory onBack={() => back?.()} />}
        {step.step === "computer" && (
          <StepComputer
            onBack={back}
            backLabel={back_label}
            onNext={(choice) => {
              if ("saved" in choice) go({ step: "factories", host: choice.saved, computer: choice.saved });
              else go({ step: "connecting", ssh: choice.ssh });
            }}
          />
        )}
        {step.step === "connecting" && (
          <StepConnecting
            key={step.ssh}
            ssh={step.ssh}
            onBack={back}
            onConnected={(host) => go({ step: "factories", host, computer: host })}
          />
        )}
        {step.step === "factories" && (
          <StepFactories
            key={step.host}
            host={step.host}
            computer={step.computer}
            onBack={back}
            backLabel={back_label}
            onAdded={(names) => go({ step: "done", host: step.host, computer: step.computer, names })}
          />
        )}
        {step.step === "done" && (
          <StepDone
            computer={step.computer}
            names={step.names}
            finishLabel={onCancel ? "Done" : "Open Control Room"}
            onFinish={() => onFinish(step.host)}
          />
        )}
      </div>
    </div>
  );
}

/** @type {React.CSSProperties} */
const pageStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 50,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 32,
  overflowY: "auto",
  background: "var(--background)",
};

/** @type {React.CSSProperties} */
const cardStyle = {
  maxWidth: 560,
  width: "100%",
  maxHeight: "100%",
  overflowY: "auto",
  boxSizing: "border-box",
  background: "var(--muted)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 32,
};
