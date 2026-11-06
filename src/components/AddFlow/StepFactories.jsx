// @ts-check
"use client";

import { useEffect, useState } from "react";
import { addFactory, checkFactoryPath, loadConfig, pickFolder, runningFactories } from "@/lib/tauri-api";
import { SignInPrompt } from "@/components/SignInBanner";
import ErrorNote from "@/components/AddFlow/ErrorNote";
import {
  footerStyle,
  headingStyle,
  inputStyle,
  leadStyle,
  listStyle,
  noteStyle,
  primaryWhen,
  rowHintStyle,
  rowStyle,
  secondaryStyle,
} from "@/components/AddFlow/styles";

/**
 * @typedef {{ name: string, path: string, ticked: boolean, already: boolean }} Row
 */

/**
 * Is a folder a host reports the one a config entry names? Config paths can
 * start with `~`, which only the host can resolve.
 * @param {string} configured
 * @param {string} folder
 * @returns {boolean}
 */
function sameFolder(configured, folder) {
  return configured === folder || (configured.startsWith("~/") && folder.endsWith(configured.slice(1)));
}

/**
 * Which factories to add from one host. What's running is listed and ticked,
 * so most people type nothing; a folder or path covers the rest, and is
 * checked to be a factory before it's offered.
 *
 * @param {{
 *   host: string,
 *   computer: string,
 *   onBack?: () => void,
 *   backLabel: string,
 *   onAdded: (names: string[]) => void,
 * }} props - `host` as in the config; `computer` is what to call it in a sentence
 * @returns {React.JSX.Element}
 */
export default function StepFactories({ host, computer, onBack, backLabel, onAdded }) {
  const is_local = host === "local";
  const [rows, set_rows] = useState(/** @type {Row[] | null} */ (null));
  const [load_error, set_load_error] = useState(/** @type {unknown} */ (null));
  const [attempt, set_attempt] = useState(0);
  const [path, set_path] = useState("");
  const [note, set_note] = useState(/** @type {string | null} */ (null));
  const [busy, set_busy] = useState(false);
  const [add_error, set_add_error] = useState(/** @type {unknown} */ (null));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [check, cfg] = await Promise.all([runningFactories(host), loadConfig()]);
        if (cancelled) return;
        const configured = cfg?.hosts.find((h) => h.name === host)?.factories ?? [];
        set_rows(
          check.running.map((f) => {
            const already = configured.some((c) => sameFolder(c.abs_path ?? c.path, f.path));
            return { name: f.name, path: f.path, ticked: true, already };
          }),
        );
      } catch (err) {
        if (!cancelled) set_load_error(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [host, attempt]);

  function retry() {
    set_rows(null);
    set_load_error(null);
    set_attempt((a) => a + 1);
  }

  /** @param {string} candidate */
  async function offer(candidate) {
    set_note(null);
    set_add_error(null);
    set_busy(true);
    try {
      const c = await checkFactoryPath(host, candidate);
      if (!c.exists) {
        set_note(`${c.root} doesn't exist on ${computer}.`);
      } else if (!c.main) {
        set_note(`${c.root} isn't a factory. A factory's package.json lists @assemblyline/lib-factory and a main file.`);
      } else {
        const name = c.root.split("/").filter(Boolean).pop() ?? c.root;
        set_rows((r) => {
          const list = r ?? [];
          if (list.some((row) => row.path === c.root)) return list.map((row) => (row.path === c.root ? { ...row, ticked: true } : row));
          return [...list, { name, path: c.root, ticked: true, already: false }];
        });
        set_path("");
      }
    } catch (err) {
      set_add_error(err);
    } finally {
      set_busy(false);
    }
  }

  async function chooseFolder() {
    const folder = await pickFolder();
    if (folder) await offer(folder);
  }

  async function finish() {
    set_add_error(null);
    set_busy(true);
    try {
      const chosen = (rows ?? []).filter((r) => r.ticked && !r.already);
      for (const row of chosen) await addFactory(host, row.path);
      onAdded(chosen.map((r) => r.name));
    } catch (err) {
      set_add_error(err);
      set_busy(false);
    }
  }

  const can_finish = !busy && (rows ?? []).some((r) => r.ticked && !r.already);
  const has_rows = !!rows && rows.length > 0;

  return (
    <>
      <h1 style={headingStyle}>{is_local ? "Which factories do you want to see?" : `Which factories on ${computer}?`}</h1>
      <SignInPrompt host={host} />
      {!rows && !load_error && <p style={leadStyle}>Looking for factories on {computer}…</p>}
      {load_error ? <ErrorNote error={load_error} computer={computer} onRetry={retry} /> : null}
      {rows && (
        <>
          <p style={leadStyle}>
            {has_rows
              ? "These are running now. Untick any you don't want to see."
              : is_local
                ? "No factories are running here. Pick the folder of a factory repo."
                : `No factories are running on ${computer}. Enter the folder of a factory there.`}
          </p>
          {has_rows && (
            <div style={listStyle}>
              {rows.map((row) => (
                <label key={row.path} style={rowStyle}>
                  <input
                    type="checkbox"
                    checked={row.ticked}
                    disabled={row.already}
                    onChange={(e) =>
                      set_rows((r) => (r ?? []).map((x) => (x.path === row.path ? { ...x, ticked: e.target.checked } : x)))
                    }
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div>{row.name}</div>
                    <div style={rowHintStyle}>{row.already ? "Already added" : row.path}</div>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            {is_local ? (
              <button type="button" style={secondaryStyle} disabled={busy} onClick={chooseFolder}>
                {has_rows ? "Add another folder…" : "Choose a folder…"}
              </button>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={inputStyle}
                  aria-label={`Folder on ${computer}`}
                  placeholder={`Folder on ${computer}, e.g. ~/factories/factory-x`}
                  value={path}
                  onChange={(e) => set_path(e.target.value)}
                />
                <button type="button" style={secondaryStyle} disabled={busy || !path.trim()} onClick={() => offer(path.trim())}>
                  Add
                </button>
              </div>
            )}
          </div>
          {note && <p style={{ ...noteStyle, color: "#ff7b72" }}>{note}</p>}
        </>
      )}
      {add_error ? <ErrorNote error={add_error} computer={computer} /> : null}
      <div style={footerStyle}>
        {onBack && (
          <button type="button" style={secondaryStyle} disabled={busy} onClick={onBack}>
            {backLabel}
          </button>
        )}
        <button type="button" disabled={!can_finish} style={primaryWhen(can_finish)} onClick={finish}>
          Continue
        </button>
      </div>
    </>
  );
}
