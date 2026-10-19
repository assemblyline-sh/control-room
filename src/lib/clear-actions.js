// @ts-check

/**
 * The Clear… actions a resource offers, as dialog requests — shared by the
 * rail's right-click menu and the views' header buttons so every entry point
 * scopes a clear the same way.
 *
 * @typedef {import("@/lib/resource-id").ResourceId} ResourceId
 * @typedef {import("@/state/clear-context").ClearRequest} ClearRequest
 */

const DONE = { done: true, finished: false, older_than_days: null };
const FINISHED = { done: false, finished: true, older_than_days: null };
const NAMED = { done: true, finished: true, older_than_days: null };

/**
 * @param {ResourceId} r
 * @returns {{ label: string, request: ClearRequest }[]}
 */
export function clearActions(r) {
  switch (r.type) {
    case "factory":
    case "line": {
      /** @type {import("@/lib/tauri-api").ClearScope} */
      const scope = r.type === "factory" ? { kind: "factory", factory: r.factory } : { kind: "line", factory: r.factory, line: r.line };
      const label = r.type === "factory" ? r.factory : `${r.factory} · line ${r.line}`;
      return [
        { label: "Clear done…", request: { host: r.host, scopes: [scope], filter: DONE, label } },
        { label: "Clear finished…", request: { host: r.host, scopes: [scope], filter: FINISHED, label } },
      ];
    }
    case "station": {
      const out = [{ label: "Clear done…", request: binRequest(r.host, r.factory, r.station, "done") }];
      if (r.is_terminal) out.push({ label: "Clear finished…", request: binRequest(r.host, r.factory, r.station, "output") });
      return out;
    }
    case "bin":
      if (r.bin === "done") return [{ label: "Clear bin…", request: binRequest(r.host, r.factory, r.station, "done") }];
      if (r.bin === "output" && r.is_terminal) {
        return [{ label: "Clear finished…", request: binRequest(r.host, r.factory, r.station, "output") }];
      }
      return [];
    default:
      return [];
  }
}

/**
 * @param {string} host
 * @param {string} factory
 * @param {string} station
 * @param {string} bin
 * @returns {ClearRequest}
 */
function binRequest(host, factory, station, bin) {
  return { host, scopes: [{ kind: "bin", factory, station, bin }], filter: NAMED, label: `${factory} · ${station}/${bin}` };
}

/**
 * One workpiece's folder in a done bin or a terminal output.
 * @param {string} host
 * @param {string} factory
 * @param {string} station
 * @param {string} bin
 * @param {string} workpiece
 * @returns {ClearRequest}
 */
export function workpieceRequest(host, factory, station, bin, workpiece) {
  return {
    host,
    scopes: [{ kind: "workpiece", factory, station, bin, workpiece }],
    filter: NAMED,
    label: `${factory} · ${station}/${bin}/${workpiece}`,
  };
}

/**
 * Why a plan skipped a bin, for the dialog.
 * @param {import("@/lib/tauri-api").ClearGroup} g
 */
export function skipReason(g) {
  if (!g.skip) return "";
  if (g.skip.kind === "kept") return "kept (config keep list)";
  return `a conveyor on ${g.skip.by} moves it to ${g.skip.target}`;
}
