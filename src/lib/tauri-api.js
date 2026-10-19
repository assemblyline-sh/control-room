// @ts-check
import { Channel, invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { confirm, message } from "@tauri-apps/plugin-dialog";

/**
 * A factory entry from the central config.
 * @typedef {Object} ConfigFactory
 * @property {string} name
 * @property {string} path - as written in the config; a path on its host, may start with `~`
 * @property {string[]} keep - `STATION/done|output` bins clearing must never touch
 * @property {string | null} abs_path - `path` with `~` expanded; local host only
 */

/**
 * @typedef {Object} ConfigHost
 * @property {string} name
 * @property {boolean} is_local
 * @property {string | null} ssh
 * @property {string | null} node
 * @property {ConfigFactory[]} factories
 */

/**
 * al-control's `~/.assemblyline/al-control/config.yml` — control-room's only config.
 * @typedef {Object} CentralConfig
 * @property {string} path - the file on disk
 * @property {string | null} current_host - the CLI's current host; the app never writes it
 * @property {ConfigHost[]} hosts
 */

/**
 * A local factory repo, as the rail and views address it until they move to
 * host + factory names.
 * @typedef {Object} FactoryRepo
 * @property {string} label
 * @property {string} path - absolute
 */

/**
 * Load the central config. `null` before the first factory is added; rejects
 * with the validation message when the file is malformed.
 * @returns {Promise<CentralConfig | null>}
 */
export async function loadConfig() {
  return invoke("load_config");
}

/**
 * The `local` host's factories as absolute-path repos.
 * @param {CentralConfig | null} cfg
 * @returns {FactoryRepo[]}
 */
export function localFactories(cfg) {
  const local = cfg?.hosts.find((h) => h.is_local);
  return (local?.factories ?? []).map((w) => ({ label: w.name, path: w.abs_path ?? w.path }));
}

/**
 * Add a factory to a host in the central config. `name` defaults to the
 * directory basename, made unique on that host.
 * @param {string} host
 * @param {string} path
 * @param {string} [name]
 * @returns {Promise<CentralConfig>}
 */
export async function addFactory(host, path, name) {
  return invoke("add_factory", { host, path, name: name ?? null });
}

/**
 * @param {string} host
 * @param {string} name
 * @returns {Promise<CentralConfig>}
 */
export async function removeFactory(host, name) {
  return invoke("remove_factory", { host, name });
}

/**
 * @param {string} name
 * @param {string} ssh - alias from ~/.ssh/config
 * @param {string} [node] - absolute path to node on the host
 * @returns {Promise<CentralConfig>}
 */
export async function addHost(name, ssh, node) {
  return invoke("add_host", { name, ssh, node: node ?? null });
}

/**
 * Native OK/Cancel dialog.
 * @param {string} message
 * @param {string} title
 * @returns {Promise<boolean>}
 */
export async function confirmDialog(message, title) {
  return confirm(message, { title, kind: "warning" });
}

/**
 * Native error dialog — for failures of one-shot actions (open a terminal,
 * start a factory) that have no view to show them in.
 * @param {unknown} err
 * @returns {Promise<void>}
 */
export async function showError(err) {
  await message(String(err), { title: "control-room", kind: "error" });
}

/**
 * Open the OS folder picker. Resolves to the selected path, or `null` on cancel.
 * @returns {Promise<string | null>}
 */
export async function pickFolder() {
  return invoke("pick_folder");
}

/**
 * Open a `file://` URL (or any path) in the OS file browser.
 * @param {string} url_or_path
 * @returns {Promise<void>}
 */
export async function openInFinder(url_or_path) {
  await shellOpen(url_or_path);
}

/**
 * Open an http(s) URL in the default browser.
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function openUrl(url) {
  if (!/^https?:\/\//.test(url)) throw new Error(`Not a web URL: ${url}`);
  await shellOpen(url);
}

// ===========================================================================
// Monitor commands — implemented in src-tauri/src/monitor_commands.rs.
// These read factory repos through the source layer; no al-control install on
// the user's machine. The watch-shell's per-resource data hooks call these.
// ===========================================================================

/**
 * @typedef {Object} MonitorLineSummary
 * @property {number} in_flight
 * @property {number} stuck
 * @property {number} finished
 * @property {string[]} stuck_locations
 * @property {{ count: number, at: string | null }} biggest_flow
 */

/**
 * @typedef {Object} MonitorLineRow
 * @property {string} code
 * @property {string | null} name
 * @property {string | null} description
 * @property {string[]} stations
 * @property {string} terminal
 * @property {MonitorLineSummary} summary
 */

/**
 * @typedef {Object} MonitorStationBinRow
 * @property {string} station
 * @property {string | null} name
 * @property {string | null} description
 * @property {boolean} is_terminal
 * @property {number | null} input
 * @property {number | null} doing
 * @property {number | null} output
 * @property {number | null} failed
 * @property {number | null} done
 */

/**
 * @typedef {Object} MonitorLineDetail
 * @property {string} code
 * @property {string | null} name
 * @property {string | null} description
 * @property {string} terminal
 * @property {MonitorStationBinRow[]} stations
 * @property {MonitorLineSummary} summary
 * @property {string | null} orchestrator - `<url>/orgs/<org>` from .orchestrator/factory.json
 */

/**
 * @typedef {Object} MonitorStationDef
 * @property {string} id
 * @property {string | null} short_code
 * @property {string | null} line
 * @property {string | null} name
 * @property {string | null} description
 * @property {boolean | null} is_enabled
 * @property {string[]} dependencies
 */

/**
 * @typedef {Object} MonitorStationDetail
 * @property {string} station
 * @property {string} line
 * @property {boolean} is_terminal
 * @property {Object<string, string[]>} bins
 * @property {MonitorStationDef | null} def
 * @property {string | null} orchestrator - `<url>/orgs/<org>` from .orchestrator/factory.json
 */

/**
 * @typedef {Object} MonitorLogEvent
 * @property {string} ts
 * @property {string} station
 * @property {string} event
 * @property {string | null} wr - work record of the run that logged it
 */

/**
 * @typedef {Object} MonitorWorkpieceRow
 * @property {string} id
 * @property {MonitorLogEvent | null} last_event
 */

/**
 * @typedef {Object} MonitorPosition
 * @property {string} line
 * @property {string} station
 * @property {string} bin
 * @property {string} subpath - path inside the bin; the id, or `sub/<id>` under a sub-bin
 * @property {boolean} terminal
 * @property {boolean} [anomaly]
 */

/**
 * @typedef {Object} MonitorWorkpieceDetail
 * @property {string} id
 * @property {MonitorPosition | null} position
 * @property {MonitorLogEvent[]} events
 * @property {string | null} folder
 * @property {string | null} link
 * @property {Object<string, any> | null} error - the folder's error.json, whole
 * @property {string | null} error_key - al-control's grouping key for `error`
 * @property {MonitorFileEntry[]} files - every file in the folder, recursively
 * @property {string | null} orchestrator - `<url>/orgs/<org>` from .orchestrator/factory.json
 */

/**
 * @typedef {Object} MonitorFileEntry
 * @property {string} name - relative to the workpiece folder (`sub/file` when nested)
 * @property {string} path - relative to the factory root; what `readFile` takes
 * @property {boolean} is_dir
 * @property {number | null} size
 */

/**
 * @typedef {Object} MonitorFileContent
 * @property {string} content
 * @property {number} size
 * @property {boolean} truncated
 * @property {boolean} is_binary - a NUL byte in the first 8 KB; `content` is then empty
 */

/**
 * @param {string} host
 * @param {string} factory - name in the central config
 * @returns {Promise<MonitorLineRow[]>}
 */
export async function listLines(host, factory) {
  return invoke("list_lines", { host, factory });
}

/**
 * @param {string} host
 * @param {string} factory - name in the central config
 * @param {string} line
 * @returns {Promise<MonitorLineDetail>}
 */
export async function showLine(host, factory, line) {
  return invoke("show_line", { host, factory, line });
}

/**
 * @param {string} host
 * @param {string} factory - name in the central config
 * @param {string} line
 * @param {string} station
 * @returns {Promise<MonitorStationDetail>}
 */
export async function showStation(host, factory, line, station) {
  return invoke("show_station", { host, factory, line, station });
}

/**
 * @param {string} host
 * @param {string} factory - name in the central config
 * @param {string} station
 * @param {string} bin
 * @returns {Promise<MonitorWorkpieceRow[]>}
 */
export async function listBinWorkpieces(host, factory, station, bin) {
  return invoke("list_bin_workpieces", { host, factory, station, bin });
}

/**
 * @param {string} host
 * @param {string} factory - name in the central config
 * @param {string} workpiece_id
 * @returns {Promise<MonitorWorkpieceDetail>}
 */
export async function showWorkpiece(host, factory, workpiece_id) {
  return invoke("show_workpiece", { host, factory, workpieceId: workpiece_id });
}

/**
 * @param {string} host
 * @param {string} factory - name in the central config
 * @param {string} station
 * @param {string} bin
 * @param {string} workpiece
 * @returns {Promise<MonitorFileEntry[]>}
 */
export async function listFilesInWorkpiece(host, factory, station, bin, workpiece) {
  return invoke("list_files_in_workpiece", {
    host,
    factory,
    station,
    bin,
    workpiece,
  });
}

/**
 * Read a file under the given factory repo. Paths are constrained to descendants
 * of the factory repo (no `..` escapes). Files larger than ~1 MiB are returned
 * truncated with `truncated: true`.
 *
 * @param {string} host
 * @param {string} factory - name in the central config
 * @param {string} file_path - relative to the factory root
 * @returns {Promise<MonitorFileContent>}
 */
export async function readFile(host, factory, file_path) {
  return invoke("read_file", { host, factory, filePath: file_path });
}

/**
 * Parse the factory repo's `.env` file into a flat string map. Returns an
 * empty object if `.env` is missing or unparseable.
 *
 * @param {string} host
 * @param {string} factory - name in the central config
 * @returns {Promise<Object<string, string>>}
 */
export async function readFactoryEnv(host, factory) {
  return invoke("read_factory_env", { host, factory });
}

// ===========================================================================
// pm2 process control — implemented in src-tauri/src/pm2.rs. A factory's pm2
// process name is always the directory basename of its factory root (must
// match al-control's `procs start` naming so both tools address the same
// pm2 app for a given repo).
// ===========================================================================

/**
 * @typedef {Object} FactoryProcessStatus
 * @property {string} status - "online" | "stopped" | "errored" | "not_found" | ...
 * @property {number | null} pid
 * @property {number | null} cpu
 * @property {number | null} memory
 * @property {number | null} uptime_ms
 */

/**
 * @returns {Promise<boolean>} whether the `pm2` binary is available on PATH
 */
export async function checkPm2Available() {
  return invoke("check_pm2_available");
}

/**
 * Start a factory repo under pm2 (reads its package.json `main` field).
 * @param {string} host
 * @param {string} factory - name in the central config
 * @returns {Promise<void>}
 */
export async function factoryStart(host, factory) {
  return invoke("factory_start", { host, factory });
}

/**
 * @param {string} host
 * @param {string} factory - name in the central config
 * @returns {Promise<void>}
 */
export async function factoryStop(host, factory) {
  return invoke("factory_stop", { host, factory });
}

/**
 * @param {string} host
 * @param {string} factory - name in the central config
 * @returns {Promise<FactoryProcessStatus>}
 */
export async function factoryStatus(host, factory) {
  return invoke("factory_status", { host, factory });
}

/**
 * Start live-tailing a factory's pm2 logs. Subsequent `pm2-log` events (see
 * `onPm2Log`) carry lines for this factory until `stopLogTail` is called.
 * Idempotent — calling twice for the same factory is a no-op.
 * @param {string} host
 * @param {string} factory - name in the central config
 * @returns {Promise<void>}
 */
export async function startLogTail(host, factory) {
  return invoke("start_log_tail", { host, factory });
}

/**
 * Stop tailing a factory's pm2 logs and kill the underlying tail subprocess
 * (does not affect the factory itself, only the log stream).
 * @param {string} host
 * @param {string} factory - name in the central config
 * @returns {Promise<void>}
 */
export async function stopLogTail(host, factory) {
  return invoke("stop_log_tail", { host, factory });
}

/**
 * The key a log tail's events carry — the same factory name can exist on two
 * hosts, so it's both.
 * @param {string} host
 * @param {string} factory
 */
export function logTailKey(host, factory) {
  return `${host}/${factory}`;
}

/**
 * Subscribe to streamed pm2 log lines from any actively-tailed factory.
 * Callers filter `payload.key` against `logTailKey(host, factory)`.
 * @param {(payload: {key: string, line: string}) => void} handler
 * @returns {Promise<() => void>} unlisten function
 */
export async function onPm2Log(handler) {
  const { listen } = await import("@tauri-apps/api/event");
  return listen("pm2-log", (event) => handler(event.payload));
}

// ===========================================================================
// Hosts, windows and SSH — src-tauri/src/host_commands.rs, windows.rs, source/ssh.rs
// ===========================================================================

/**
 * Record the host this window shows (and title the window with it). The
 * main window calls it on boot; host windows are opened already bound.
 * @param {string} host
 * @returns {Promise<void>}
 */
export async function claimWindowHost(host) {
  return invoke("claim_window_host", { host });
}

/**
 * Focus the window showing `host`, or open a new one for it.
 * @param {string} host
 * @returns {Promise<void>}
 */
export async function openHostWindow(host) {
  return invoke("open_host_window", { host });
}

/**
 * @typedef {Object} HostCheck
 * @property {boolean} pm2_found - false usually means `node:` is needed (nvm installs are off PATH over ssh)
 * @property {string[]} running - factories running on the host
 */

/**
 * One probe round trip to an ssh alias, before it's saved as a host.
 * @param {string} ssh - alias from ~/.ssh/config
 * @param {string} [node] - absolute path to node on the host
 * @returns {Promise<HostCheck>}
 */
export async function testHost(ssh, node) {
  return invoke("test_host", { ssh, node: node || null });
}

/**
 * @typedef {Object} PathCheck
 * @property {boolean} exists
 * @property {string | null} main - set when the folder is a factory
 * @property {string} root - the path with `~` resolved on the host
 */

/**
 * Does `path` exist on `host`, and is it a factory?
 * @param {string} host
 * @param {string} path
 * @returns {Promise<PathCheck>}
 */
export async function checkFactoryPath(host, path) {
  return invoke("check_factory_path", { host, path });
}

/**
 * A local path for a factory file, to open in the default app — the file
 * itself locally, a downloaded copy for a remote host.
 * @param {string} host
 * @param {string} factory
 * @param {string} file_path - relative to the factory root
 * @returns {Promise<string>}
 */
export async function fetchFile(host, factory, file_path) {
  return invoke("fetch_file", { host, factory, filePath: file_path });
}

/**
 * A factory file's bytes, for viewing in the app (20 MB cap).
 * @param {string} host
 * @param {string} factory
 * @param {string} file_path - relative to the factory root
 * @returns {Promise<ArrayBuffer>}
 */
export async function readFileBytes(host, factory, file_path) {
  return invoke("read_file_bytes", { host, factory, filePath: file_path });
}

/**
 * Open a terminal at a factory's root, or at a workpiece folder — locally, or
 * as an `ssh -t` session on a remote host.
 * @param {string} host
 * @param {string} factory
 * @param {string} [dir] - relative to temp/stations/, e.g. `BK-DI5/failed/bkdi-35`
 * @returns {Promise<void>}
 */
export async function openTerminal(host, factory, dir) {
  return invoke("open_terminal", { host, factory, dir: dir ?? null });
}

// ------------------------------ integrated terminal ------------------------------

/**
 * Open a shell in a factory folder inside a pseudo-terminal: the user's shell
 * locally, `ssh -tt` on a remote host. Rust builds the command; JS only
 * names the folder and sends keystrokes. Implemented in src-tauri/src/terminal.rs.
 * @param {Object} opts
 * @param {string} opts.host
 * @param {string} opts.factory
 * @param {string} [opts.dir] - relative to temp/stations/
 * @param {number} opts.cols
 * @param {number} opts.rows
 * @param {(bytes: Uint8Array) => void} opts.onData
 * @param {(code: number | null) => void} opts.onExit - null when killed by a signal
 * @returns {Promise<string>} session id
 */
export async function openTerminalSession({ host, factory, dir, cols, rows, onData, onExit }) {
  /** @type {Channel<ArrayBuffer>} */
  const on_data = new Channel();
  on_data.onmessage = (buf) => onData(new Uint8Array(buf));
  /** @type {Channel<number | null>} */
  const on_exit = new Channel();
  on_exit.onmessage = onExit;
  return invoke("terminal_open", { host, factory, dir: dir ?? null, cols, rows, onData: on_data, onExit: on_exit });
}

/**
 * @param {string} id
 * @param {string} data - keystrokes / pasted text
 * @returns {Promise<void>}
 */
export async function writeTerminal(id, data) {
  return invoke("terminal_write", { id, data });
}

/**
 * @param {string} id
 * @param {number} cols
 * @param {number} rows
 * @returns {Promise<void>}
 */
export async function resizeTerminal(id, cols, rows) {
  return invoke("terminal_resize", { id, cols, rows });
}

/**
 * Kill a terminal session.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function closeTerminal(id) {
  return invoke("terminal_close", { id });
}

/**
 * ssh's stderr, line by line. Tailscale SSH prints its sign-in URL here.
 * @param {(payload: {host: string, line: string}) => void} handler
 * @returns {Promise<() => void>} unlisten
 */
export async function onSshStderr(handler) {
  const { listen } = await import("@tauri-apps/api/event");
  return listen("ssh-stderr", (event) => handler(/** @type {any} */ (event.payload)));
}

/**
 * Each remote probe call's start and end.
 * @param {(payload: {host: string, phase: 'start' | 'ok' | 'error', message: string | null}) => void} handler
 * @returns {Promise<() => void>} unlisten
 */
export async function onSshCall(handler) {
  const { listen } = await import("@tauri-apps/api/event");
  return listen("ssh-call", (event) => handler(/** @type {any} */ (event.payload)));
}

/**
 * @typedef {Object} FactoryCounts
 * @property {string | null} [root]
 * @property {Object<string, string>} lines - station code → line code
 * @property {Object<string, Object<string, number | null>>} counts - station → bin → workpieces (null = no bin dir)
 * @property {Object<string, number>} [orphans] - station → failed folders without pointer.json (not in counts)
 * @property {string | null} [error] - the factory couldn't be read
 */

/**
 * Per-bin workpiece counts for every factory on a host — one probe round trip
 * for a remote host. Polled by the rail.
 * @param {string} host
 * @returns {Promise<Object<string, FactoryCounts>>}
 */
export async function hostCounts(host) {
  return invoke("host_counts", { host });
}

// --------------------------- failures & housekeeping ---------------------------

/**
 * @typedef {Object} Failure
 * @property {string} line
 * @property {string} station
 * @property {string} id
 * @property {string} dir - relative to temp/stations/
 * @property {string | null} failed_at
 * @property {string | null} name
 * @property {string | number | null} code
 * @property {string | null} message - capped at 2,000 chars; null = no error.json
 * @property {string} key - grouping key (al-control's errorKey)
 * @property {boolean} orphan - no pointer.json: not a workpiece
 */

/**
 * @typedef {Object} FactoryFailures
 * @property {string} factory
 * @property {string | null} error - the factory couldn't be read
 * @property {Failure[]} failures
 */

/**
 * Failed workpieces and orphaned failed folders, with error keys.
 * @param {string} host
 * @param {string} [factory] - one factory; every factory on the host when omitted
 * @returns {Promise<FactoryFailures[]>}
 */
export async function listFailures(host, factory) {
  return invoke("list_failures", { host, factory: factory ?? null });
}

/**
 * @typedef {(
 *   | { kind: 'host' }
 *   | { kind: 'factory', factory: string }
 *   | { kind: 'line', factory: string, line: string }
 *   | { kind: 'bin', factory: string, station: string, bin: string }
 *   | { kind: 'workpiece', factory: string, station: string, bin: string, workpiece: string }
 * )} ClearScope
 */

/**
 * @typedef {Object} ClearFilter
 * @property {boolean} done - host / factory / line scopes: include done bins
 * @property {boolean} finished - …and terminal-station outputs
 * @property {number | null} older_than_days
 */

/**
 * @typedef {(
 *   | { kind: 'kept', config: string }
 *   | { kind: 'drained', by: string, target: string }
 * )} ClearSkip
 */

/**
 * @typedef {Object} ClearGroup
 * @property {string} line
 * @property {string} station
 * @property {string} bin - "done" | "output" (output = finished)
 * @property {number} count - to delete; when skipped, what's there
 * @property {number} newer - held back by the age filter
 * @property {number | null} oldest - ms since epoch
 * @property {ClearSkip | null} skip
 * @property {string[]} dirs - what clearWorkpieces takes; empty when skipped
 */

/**
 * @typedef {Object} FactoryClearPlan
 * @property {string} factory
 * @property {string | null} error
 * @property {boolean} has_keep_list
 * @property {ClearGroup[]} groups
 */

/**
 * @typedef {Object} ClearPlan
 * @property {string} host
 * @property {FactoryClearPlan[]} factories
 */

/**
 * What a clear would delete, fresh from disk. Read-only.
 * @param {string} host
 * @param {ClearScope[]} scopes
 * @param {ClearFilter} filter
 * @returns {Promise<ClearPlan>}
 */
export async function planClear(host, scopes, filter) {
  return invoke("plan_clear", { host, scopes, filter });
}

/**
 * Delete exactly these workpiece dirs (from a plan) in one factory. Refused
 * as a whole if any isn't clearable any more.
 * @param {string} host
 * @param {string} factory
 * @param {string[]} dirs
 * @returns {Promise<{ removed: number }>}
 */
export async function clearWorkpieces(host, factory, dirs) {
  return invoke("clear_workpieces", { host, factory, dirs });
}

/**
 * Move workpieces from a station's `failed` / `done` bin back to that
 * station's `input` for a retry. `workpieces` are ids; `null` takes the whole
 * bin (failed only). Refused as a whole if any isn't there or retryable now.
 * @param {string} host
 * @param {string} factory
 * @param {string} station
 * @param {string} bin - "failed" | "done"
 * @param {string[] | null} workpieces
 * @returns {Promise<{ requeued: number }>}
 */
export async function requeueWorkpieces(host, factory, station, bin, workpieces) {
  return invoke("requeue_workpieces", { host, factory, station, bin, workpieces });
}
