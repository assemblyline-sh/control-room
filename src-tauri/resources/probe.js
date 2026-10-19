/**
 * Probe — the only code that touches a host's filesystem or process table.
 *
 * Self-contained by design: imports nothing but Node built-ins, so the client
 * can send this file verbatim over SSH and run it with `node -` on a host that
 * has no al-control installed (see transport.js). Locally the client imports
 * `runQuery` in-process. Either way the result is plain JSON — no Maps, no
 * formatting.
 *
 * It also owns the line model (station order, terminal station, per-line
 * summary) so every client renders the same answer from the `lines` query: the
 * CLI imports these functions, and the control-room desktop app vendors this
 * file byte for byte instead of porting the logic. Positions and formatting stay
 * client-side (utils/line-state.js).
 *
 * Adapted from al-factory's station-files.js, line-state.js and
 * factory-processes.js, with every cwd-relative path replaced by an explicit
 * factory root.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

export const ALL_BINS = ['input', 'doing', 'output', 'failed', 'done'];
export const LIVE_BINS = ['input', 'doing', 'output', 'failed'];
const MAX_BIN_DEPTH = 4; // depth limit for sub-bin walks (output/invoices/hi-1/ = depth 2)
const ERROR_MESSAGE_CAP = 2000;
const READ_FILE_CAP = 20 * 1024 * 1024;

class ProbeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * @param {string} p - Path on this host; may start with `~`
 * @returns {string} Absolute path
 */
function resolveRoot(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

function requireFactoryRoot(p) {
  const root = resolveRoot(p);
  if (!fs.existsSync(root)) throw new ProbeError('FACTORY_NOT_FOUND', `Factory directory does not exist: ${root}`);
  return root;
}

function readJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    } catch {
      // skip malformed files
    }
  }
  return out;
}

/**
 * Station and line definitions from `.orchestrator/`.
 * @param {string} root
 */
function readDefs(root) {
  const stations = readJsonFiles(path.join(root, '.orchestrator', 'stations'))
    .map((data) => ({ line: data.line ?? null, data }));
  const lines = {};
  for (const data of readJsonFiles(path.join(root, '.orchestrator', 'lines'))) {
    if (data.code) lines[data.code] = data;
  }
  // Committed factory settings, e.g. { orchestrator_url, org } for work-record links.
  let factory = null;
  try {
    factory = JSON.parse(fs.readFileSync(path.join(root, '.orchestrator', 'factory.json'), 'utf8'));
  } catch {
    // absent or not JSON
  }
  return { stations, lines, factory };
}

/**
 * Walk a bin directory and find every workpiece — any directory containing a
 * `pointer.json` marker — descending through organisational sub-bins
 * (`output/invoices/`) up to MAX_BIN_DEPTH.
 *
 * With `orphans`, a directory with no `pointer.json` that holds files itself
 * (sub-bins hold only folders) is recorded there instead of walked into: a
 * failed folder that isn't a workpiece, so every other reader skips it.
 *
 * @param {string} bin_dir
 * @param {Object<string, string>} [orphans] - filled with dir name → path relative to bin_dir
 * @returns {Object<string, string>} workpiece_id → path relative to bin_dir
 */
function scanBinWorkpieces(bin_dir, orphans) {
  const found = {};
  const walk = (dir, depth, relpath) => {
    if (depth >= MAX_BIN_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const child_dir = path.join(dir, entry.name);
      const child_rel = relpath ? `${relpath}/${entry.name}` : entry.name;
      if (fs.existsSync(path.join(child_dir, 'pointer.json'))) found[entry.name] = child_rel;
      else if (orphans && holdsFiles(child_dir)) orphans[entry.name] = child_rel;
      else walk(child_dir, depth + 1, child_rel);
    }
  };
  walk(bin_dir, 0, '');
  return found;
}

function holdsFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).some((e) => e.isFile());
  } catch {
    return false;
  }
}

/**
 * Defs plus bin contents for every station assigned to a line. A bin whose
 * directory doesn't exist is `null` (rendered as — by the client).
 * `orphans[station]` lists failed folders without `pointer.json` (only
 * stations that have any).
 * @param {string} root
 */
function readState(root) {
  const defs = readDefs(root);
  const stations_root = path.join(root, 'temp', 'stations');
  const bins = {};
  const orphans = {};
  for (const s of defs.stations) {
    if (!s.line) continue;
    const code = s.data.short_code || s.data.id;
    bins[code] = {};
    for (const bin of ALL_BINS) {
      const dir = path.join(stations_root, code, bin);
      if (!fs.existsSync(dir)) { bins[code][bin] = null; continue; }
      const found_orphans = {};
      bins[code][bin] = scanBinWorkpieces(dir, bin === 'failed' ? found_orphans : undefined);
      if (Object.keys(found_orphans).length > 0) orphans[code] = found_orphans;
    }
  }
  return { ...defs, bins, orphans };
}

/**
 * Absolute path of a workpiece dir given relative to temp/stations/.
 * @param {string} root
 * @param {string} rel
 */
function stationsPath(root, rel) {
  const stations_root = path.join(root, 'temp', 'stations');
  const abs = path.join(stations_root, rel);
  if (!abs.startsWith(stations_root + path.sep)) throw new ProbeError('BAD_PATH', `Refusing to touch outside temp/stations/: ${rel}`);
  return abs;
}

function readErrorJson(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'error.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Workpiece counts per bin for several factories in one call — what a UI
 * polls (control-room's rail, every couple of seconds), so only numbers cross
 * the wire, not ids. A factory that can't be read reports `error` instead of
 * failing the rest.
 * @param {Object<string, string>} paths - factory name → path
 */
function readCounts(paths) {
  const out = {};
  for (const [name, p] of Object.entries(paths)) {
    try {
      const root = requireFactoryRoot(p);
      const { stations, bins, orphans } = readState(root);
      const lines = {};
      for (const s of stations) if (s.line) lines[s.data.short_code || s.data.id] = s.line;
      const counts = {};
      for (const [code, by_bin] of Object.entries(bins)) {
        counts[code] = {};
        for (const [bin, ids] of Object.entries(by_bin)) counts[code][bin] = ids === null ? null : Object.keys(ids).length;
      }
      const orphan_counts = Object.fromEntries(Object.entries(orphans).map(([code, dirs]) => [code, Object.keys(dirs).length]));
      out[name] = { root, lines, counts, orphans: orphan_counts };
    } catch (err) {
      out[name] = { error: err.message };
    }
  }
  return out;
}

/**
 * Last activity per workpiece dir, in ms since the epoch: the later of the
 * folder's and its log.jsonl's mtime (a station appends to the log on every
 * move, which doesn't touch the folder's own mtime). `null` if the dir is gone.
 * @param {string} root
 * @param {string[]} rel_dirs
 */
function readAges(root, rel_dirs) {
  const ages = {};
  for (const rel of rel_dirs) {
    const dir = stationsPath(root, rel);
    const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return null; } };
    const dir_ms = mtime(dir);
    ages[rel] = dir_ms === null ? null : Math.round(Math.max(dir_ms, mtime(path.join(dir, 'log.jsonl')) ?? 0));
  }
  return ages;
}

/**
 * Parsed `log.jsonl` for each workpiece dir (relative to temp/stations/).
 * Blank and malformed lines are dropped — the log is best-effort.
 * @param {string} root
 * @param {string[]} rel_dirs
 */
function readLogs(root, rel_dirs) {
  const logs = {};
  for (const rel of rel_dirs) {
    const log_path = path.join(stationsPath(root, rel), 'log.jsonl');
    if (!fs.existsSync(log_path)) { logs[rel] = []; continue; }
    logs[rel] = fs.readFileSync(log_path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  }
  return logs;
}

/**
 * error.json summaries (no stack; message capped) for grouping failures.
 * `null` when a dir has no readable error.json.
 * @param {string} root
 * @param {string[]} rel_dirs
 */
function readErrors(root, rel_dirs) {
  const errors = {};
  for (const rel of rel_dirs) {
    const e = readErrorJson(stationsPath(root, rel));
    errors[rel] = e && {
      failed_at: e.failed_at ?? null,
      name: e.name ?? null,
      code: e.code ?? null,
      message: String(e.message ?? '').slice(0, ERROR_MESSAGE_CAP),
    };
  }
  return errors;
}

/**
 * One workpiece dir: every file under it (relative paths, sizes) and its full
 * error.json.
 * @param {string} root
 * @param {string} rel
 */
function readWorkpiece(root, rel) {
  const dir = stationsPath(root, rel);
  if (!fs.existsSync(dir)) throw new ProbeError('NOT_FOUND', `No workpiece folder at temp/stations/${rel}`);
  const files = [];
  const walk = (d, prefix) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(d, entry.name);
      const name = prefix + entry.name;
      if (entry.isDirectory()) walk(child, `${name}/`);
      else files.push({ name, size: fs.statSync(child).size });
    }
  };
  walk(dir, '');
  return { files, error: readErrorJson(dir) };
}

/**
 * One file inside a workpiece dir. Text comes back as utf8, anything with a
 * NUL byte as base64, so the client can write it out byte-for-byte.
 * @param {string} root
 * @param {string} rel
 * @param {string} file - path relative to the workpiece dir
 */
function readWorkpieceFile(root, rel, file) {
  const dir = stationsPath(root, rel);
  const abs = path.join(dir, file);
  if (!abs.startsWith(dir + path.sep)) throw new ProbeError('BAD_PATH', `Refusing to read outside the workpiece folder: ${file}`);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new ProbeError('NOT_FOUND', `No file '${file}' in temp/stations/${rel}`);
  }
  if (!stat.isFile()) throw new ProbeError('BAD_PATH', `'${file}' is not a file`);
  if (stat.size > READ_FILE_CAP) throw new ProbeError('TOO_LARGE', `'${file}' is ${stat.size} bytes; the limit is ${READ_FILE_CAP}. Use \`workpieces open\` instead.`);
  const buf = fs.readFileSync(abs);
  return buf.includes(0)
    ? { encoding: 'base64', content: buf.toString('base64') }
    : { encoding: 'utf8', content: buf.toString('utf8') };
}

/**
 * Delete workpiece dirs. The client picks them; this re-checks every one and
 * refuses the whole batch, before deleting anything, if any dir isn't a
 * workpiece under a `done` or `output` bin, or sits in a kept bin.
 * @param {string} root
 * @param {string[]} rel_dirs - `STATION/BIN/...` relative to temp/stations/
 * @param {string[]} keep - `STATION/BIN` entries never to clear
 */
function removeWorkpieces(root, rel_dirs, keep) {
  const kept = new Set(keep);
  const targets = rel_dirs.map((rel) => {
    const [station, bin] = rel.split('/');
    if (bin !== 'done' && bin !== 'output') throw new ProbeError('REFUSED', `Only done and output bins can be cleared: ${rel}`);
    if (kept.has(`${station}/${bin}`)) throw new ProbeError('REFUSED', `${station}/${bin} is in this factory's keep list`);
    const abs = stationsPath(root, rel);
    if (!fs.existsSync(path.join(abs, 'pointer.json'))) throw new ProbeError('REFUSED', `Not a workpiece (no pointer.json): ${rel}`);
    return abs;
  });
  for (const abs of targets) fs.rmSync(abs, { recursive: true, force: true });
  return { removed: rel_dirs };
}

/**
 * Move workpiece dirs back to their own station's `input` for a retry. The
 * whole batch is checked before anything moves: each dir is a workpiece
 * (has pointer.json) in a `failed` or `done` bin, and `input/<id>` is free.
 * lib-factory reads input flat, so a sub-bin source still lands at
 * `input/<id>`. The stale error.json / error.txt go (lib-factory never clears
 * them, so a successful retry would carry them into done/), and log.jsonl
 * gets a `requeued` event.
 * @param {string} root
 * @param {string[]} rel_dirs - `STATION/BIN/...` relative to temp/stations/
 */
function requeueWorkpieces(root, rel_dirs) {
  const seen = new Set();
  const moves = rel_dirs.map((rel) => {
    const abs = stationsPath(root, rel);
    // Split the normalised path, so `X/failed/../output/wp` can't pass as failed.
    const [station, bin] = path.relative(path.join(root, 'temp', 'stations'), abs).split(path.sep);
    if (bin !== 'failed' && bin !== 'done') throw new ProbeError('REFUSED', `Only failed and done workpieces can be retried: ${rel}`);
    if (!fs.existsSync(path.join(abs, 'pointer.json'))) throw new ProbeError('REFUSED', `Not a workpiece (no pointer.json): ${rel}`);
    const target = stationsPath(root, `${station}/input/${path.basename(abs)}`);
    if (fs.existsSync(target) || seen.has(target)) throw new ProbeError('REFUSED', `${station}/input/${path.basename(abs)} already exists`);
    seen.add(target);
    return { abs, target, station, bin };
  });
  for (const { abs, target, station, bin } of moves) {
    fs.rmSync(path.join(abs, 'error.json'), { force: true });
    fs.rmSync(path.join(abs, 'error.txt'), { force: true });
    const event = { ts: new Date().toISOString(), station, event: 'requeued', from: bin };
    fs.appendFileSync(path.join(abs, 'log.jsonl'), `${JSON.stringify(event)}\n`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(abs, target);
  }
  return { requeued: rel_dirs };
}

// ---------------------------------------------------------------------------
// Processes (macOS / Linux)
// ---------------------------------------------------------------------------

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return '';
  }
}

function processSnapshot() {
  // Leading `\s*` is load-bearing: `ps` right-aligns and space-pads pid/ppid.
  const re = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(.*)$/;
  const procs = new Map();
  for (const line of sh('ps -A -o pid=,ppid=,lstart=,etime=,command=').split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    const [, pid, ppid, lstart, etime, command] = m;
    procs.set(pid, { pid, ppid, lstart, etime, command });
  }
  return procs;
}

/** Linux reads /proc (no lsof dependency); macOS has no /proc, so lsof. */
function cwdOf(pid) {
  if (process.platform === 'linux') {
    try {
      return fs.readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      return null;
    }
  }
  const line = sh(`lsof -p ${pid} -a -d cwd -Fn`).split('\n').find((l) => l.startsWith('n'));
  return line ? line.slice(1) : null;
}

/**
 * @param {string} dir
 * @returns {{ main: string } | null} package.json `main` when `dir` is a factory repo
 */
function factoryPackageInfo(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (!('@assemblyline/lib-factory' in deps) || !pkg.main) return null;
    return { main: pkg.main };
  } catch {
    return null;
  }
}

function listeningPort(pid) {
  const line = sh(`lsof -nP -a -p ${pid} -iTCP -sTCP:LISTEN`).split('\n').find((l) => l.includes('LISTEN'));
  return line?.match(/:(\d+)\s*\(LISTEN\)/)?.[1] ?? '-';
}

/** @returns {Array<object>|null} null when pm2 isn't on PATH (or not running) */
function pm2Apps() {
  try {
    return JSON.parse(sh('pm2 jlist')).map((p) => ({
      pid: String(p.pid),
      name: p.name,
      cwd: p.pm2_env?.pm_cwd,
      status: p.pm2_env?.status,
      cpu: p.monit?.cpu ?? null,
      memory: p.monit?.memory ?? null,
    }));
  } catch {
    return null;
  }
}

/**
 * Every factory process on this host, pm2-managed or run directly.
 * `pm2_found: false` means pm2 couldn't be queried, so pm2-managed factories
 * show up as `direct` — the client warns rather than trusting the mode.
 *
 * pm2-managed factories come from `pm2 jlist`'s own `pm_cwd` rather than `ps`
 * command text — pm2 rewrites the process title, which can corrupt argv as
 * `ps` reports it.
 */
function listRunningFactories() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new ProbeError('UNSUPPORTED_PLATFORM', `Process detection requires macOS or Linux (host is ${process.platform}).`);
  }

  const procs = processSnapshot();
  const apps = pm2Apps();
  const rows = [];
  const claimed_cwds = new Set();

  for (const app of apps ?? []) {
    if (app.status !== 'online' || !app.cwd) continue;
    if (!factoryPackageInfo(app.cwd)) continue; // some other, pm2 app that is not a factory
    // A wrapped pm2 app ("npm run start") runs the real `node <main>` as a
    // grandchild — claim the cwd so it isn't double-counted as "direct".
    claimed_cwds.add(app.cwd);
    const proc = procs.get(app.pid);
    rows.push({
      pid: app.pid,
      factory: path.basename(app.cwd),
      mode: 'pm2',
      pm2: app.name,
      cwd: app.cwd,
      port: listeningPort(app.pid),
      uptime: proc?.etime ?? '-',
      started: proc?.lstart ?? '-',
      cpu: app.cpu,
      memory: app.memory,
    });
  }

  for (const proc of procs.values()) {
    if (path.basename(proc.command.split(/\s+/)[0]) !== 'node') continue;
    const cwd = cwdOf(proc.pid);
    if (!cwd || claimed_cwds.has(cwd)) continue;
    const info = factoryPackageInfo(cwd);
    if (!info || !proc.command.includes(info.main)) continue;
    // `node --watch <main>` is a supervisor; its child does the real work.
    if (proc.command.includes('--watch')) continue;
    rows.push({
      pid: proc.pid,
      factory: path.basename(cwd),
      mode: 'direct',
      pm2: '-',
      cwd,
      port: listeningPort(proc.pid),
      uptime: proc.etime,
      started: proc.lstart,
      cpu: null,
      memory: null,
    });
  }

  rows.sort((a, b) => a.factory.localeCompare(b.factory) || Number(a.pid) - Number(b.pid));
  return { procs: rows, pm2_found: apps !== null };
}

// ---------------------------------------------------------------------------
// Line model (pure; shared with the CLI and vendored by control-room)
// ---------------------------------------------------------------------------

/**
 * @typedef {{line: string|null, data: any}} StationDef
 */

/**
 * Stable code for a station def — short_code, falling back to id.
 * @param {StationDef} s
 * @returns {string}
 */
export const codeOf = (s) => s.data.short_code || s.data.id;

/**
 * Index station defs by every reference form they answer to, so a dependency
 * edge written as short_code or id finds its peer.
 * @param {StationDef[]} members
 * @returns {Map<string, StationDef>}
 */
export function indexStationsByRef(members) {
  const by_ref = new Map();
  for (const s of members) {
    by_ref.set(codeOf(s), s);
    if (s.data.id) by_ref.set(s.data.id, s);
    if (s.data.short_code) by_ref.set(s.data.short_code, s);
  }
  return by_ref;
}

/**
 * Normalise one `dependencies` entry (bare id string, or object with
 * short_code/id) to a reference string.
 * @param {any} dep
 * @returns {string|undefined}
 */
export function dependencyRef(dep) {
  return typeof dep === 'string' ? dep : dep?.short_code || dep?.id;
}

/**
 * Resolve a station reference (short_code or orchestrator id) to its display
 * code; unchanged when the peer isn't among `stations`.
 * @param {string} ref
 * @param {Map<string, StationDef>|StationDef[]} stations
 * @returns {string}
 */
export function resolveStationRef(ref, stations) {
  const by_ref = stations instanceof Map ? stations : indexStationsByRef(stations);
  const match = by_ref.get(ref);
  return match ? codeOf(match) : ref;
}

/**
 * Topologically sort one line's station defs by `dependencies`, with an
 * alphabetical pre-sort for stable sibling order.
 * @param {StationDef[]} members
 * @returns {StationDef[]}
 */
export function topoSortStations(members) {
  const by_ref = indexStationsByRef(members);
  /** @param {StationDef} s */
  const depsOf = (s) => (s.data.dependencies || [])
    .map(dependencyRef)
    .map((/** @type {string} */ ref) => by_ref.get(ref))
    .filter(Boolean);

  const sorted = [...members].sort((a, b) => codeOf(a).localeCompare(codeOf(b)));
  const visited = new Set();
  /** @type {StationDef[]} */
  const result = [];
  /** @param {StationDef} s */
  const visit = (s) => {
    const code = codeOf(s);
    if (visited.has(code)) return;
    visited.add(code);
    for (const dep of depsOf(s)) visit(dep);
    result.push(s);
  };
  for (const s of sorted) visit(s);
  return result;
}

/**
 * Terminal = station no in-line peer depends on. With several sinks, the one
 * latest in topo order.
 * @param {StationDef[]} ordered - From topoSortStations
 * @returns {string}
 */
export function computeTerminal(ordered) {
  if (ordered.length === 0) return '';
  const by_ref = indexStationsByRef(ordered);
  const depended_on = new Set();
  for (const s of ordered) {
    for (const d of s.data.dependencies || []) {
      const ref = dependencyRef(d);
      if (ref && by_ref.has(ref)) depended_on.add(resolveStationRef(ref, by_ref));
    }
  }
  for (let i = ordered.length - 1; i >= 0; i--) {
    const c = codeOf(ordered[i]);
    if (!depended_on.has(c)) return c;
  }
  return codeOf(ordered[ordered.length - 1]);
}

/**
 * Station defs grouped by line, each line's stations in dependency order.
 * @param {StationDef[]} stations
 * @returns {Object<string, {stations: string[], terminal: string}>}
 */
export function groupLines(stations) {
  /** @type {Map<string, StationDef[]>} */
  const grouped = new Map();
  for (const def of stations) {
    if (!def.line) continue;
    if (!grouped.has(def.line)) grouped.set(def.line, []);
    grouped.get(def.line)?.push(def);
  }
  /** @type {Object<string, {stations: string[], terminal: string}>} */
  const lines = {};
  for (const [code, members] of grouped) {
    const ordered = topoSortStations(members);
    lines[code] = { stations: ordered.map(codeOf), terminal: computeTerminal(ordered) };
  }
  return lines;
}

/**
 * @typedef {object} LineSummary
 * @property {number} in_flight - input + doing + output, excluding terminal output
 * @property {number} stuck - failed across the line
 * @property {number} finished - terminal-station output
 * @property {string[]} stuck_locations - e.g. '3 at VM2/failed'
 * @property {{count: number, at: string|null}} biggest_flow - fullest in-flight bin
 */

/**
 * Per-line totals from live bin counts (`done` ignored).
 * @param {{stations: string[], terminal: string}} line
 * @param {Object<string, Object<string, number|null>>} counts - counts[station][bin], null when the bin is missing
 * @returns {LineSummary}
 */
export function summarizeCounts(line, counts) {
  let in_flight = 0;
  let stuck = 0;
  let finished = 0;
  /** @type {string[]} */
  const stuck_locations = [];
  /** @type {{count: number, at: string|null}} */
  let biggest_flow = { count: 0, at: null };

  for (const station of line.stations) {
    const is_terminal = station === line.terminal;
    for (const bin of LIVE_BINS) {
      const n = counts[station]?.[bin];
      if (n === null || n === undefined) continue;
      if (bin === 'failed') {
        stuck += n;
        if (n > 0) stuck_locations.push(`${n} at ${station}/failed`);
      } else if (is_terminal && bin === 'output') {
        finished += n;
      } else {
        in_flight += n;
        if (n > biggest_flow.count) biggest_flow = { count: n, at: `${station}/${bin}` };
      }
    }
  }
  return { in_flight, stuck, finished, stuck_locations, biggest_flow };
}

/**
 * The `lines` query: every line with its stations in order, terminal, live bin
 * counts and summary, from one read of the factory. Counts only, no workpiece
 * ids, so it stays small enough to poll.
 * @param {string} root
 */
function readLines(root) {
  const { stations, lines: line_defs, factory, bins, orphans } = readState(root);
  /** @type {Object<string, Object<string, number|null>>} */
  const counts = {};
  for (const [code, by_bin] of Object.entries(bins)) {
    counts[code] = {};
    for (const [bin, ids] of Object.entries(by_bin)) counts[code][bin] = ids === null ? null : Object.keys(ids).length;
  }
  const lines = {};
  for (const [code, line] of Object.entries(groupLines(stations))) {
    const def = line_defs[code] ?? {};
    const line_counts = Object.fromEntries(line.stations.map((st) => [st, counts[st] ?? {}]));
    lines[code] = {
      code,
      name: def.name ?? null,
      location: def.location ?? null,
      stations: line.stations,
      terminal: line.terminal,
      counts: line_counts,
      orphans: Object.fromEntries(line.stations.filter((st) => orphans[st]).map((st) => [st, Object.keys(orphans[st]).length])),
      summary: summarizeCounts(line, line_counts),
    };
  }
  return { factory, lines };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * @typedef {{type: 'defs', path: string}
 *   | {type: 'state', path: string}
 *   | {type: 'lines', path: string}
 *   | {type: 'logs', path: string, dirs: string[]}
 *   | {type: 'errors', path: string, dirs: string[]}
 *   | {type: 'ages', path: string, dirs: string[]}
 *   | {type: 'workpiece', path: string, dir: string}
 *   | {type: 'read', path: string, dir: string, file: string}
 *   | {type: 'remove', path: string, dirs: string[], keep: string[]}
 *   | {type: 'requeue', path: string, dirs: string[]}
 *   | {type: 'counts', paths: Object<string, string>}
 *   | {type: 'procs'}
 *   | {type: 'factories', paths: Object<string, string>}} ProbeQuery
 */

/**
 * @param {ProbeQuery} query
 * @returns {object} JSON-serialisable result
 */
export function runQuery(query) {
  switch (query.type) {
    case 'defs': {
      const root = requireFactoryRoot(query.path);
      return { root, ...readDefs(root) };
    }
    case 'state': {
      const root = requireFactoryRoot(query.path);
      return { root, ...readState(root) };
    }
    case 'lines': {
      const root = requireFactoryRoot(query.path);
      return { root, ...readLines(root) };
    }
    case 'logs': {
      const root = requireFactoryRoot(query.path);
      return { root, logs: readLogs(root, query.dirs) };
    }
    case 'errors': {
      const root = requireFactoryRoot(query.path);
      return { root, errors: readErrors(root, query.dirs) };
    }
    case 'ages': {
      const root = requireFactoryRoot(query.path);
      return { root, ages: readAges(root, query.dirs) };
    }
    case 'workpiece': {
      const root = requireFactoryRoot(query.path);
      return { root, ...readWorkpiece(root, query.dir) };
    }
    case 'read':
      return readWorkpieceFile(requireFactoryRoot(query.path), query.dir, query.file);
    case 'remove':
      return removeWorkpieces(requireFactoryRoot(query.path), query.dirs, query.keep ?? []);
    case 'requeue':
      return requeueWorkpieces(requireFactoryRoot(query.path), query.dirs);
    case 'counts':
      return readCounts(query.paths);
    case 'procs':
      return listRunningFactories();
    case 'factories': {
      const factories = Object.entries(query.paths).map(([name, p]) => {
        const root = resolveRoot(p);
        return { name, root, exists: fs.existsSync(root), main: factoryPackageInfo(root)?.main ?? null };
      });
      return { factories, ...listRunningFactories() };
    }
    default:
      throw new ProbeError('BAD_QUERY', `Unknown probe query: ${query.type}`);
  }
}

/**
 * Remote entry: the transport appends `main(<query as a JSON literal>)` when
 * piping this file to `node -`. Result is one JSON envelope on stdout, so the
 * client never has to parse a stack trace.
 * @param {ProbeQuery} query
 */
export function main(query) {
  let out;
  try {
    out = { ok: true, data: runQuery(query) };
  } catch (err) {
    out = { ok: false, error: { code: err.code || 'PROBE_ERROR', message: err.message } };
  }
  process.stdout.write(JSON.stringify(out));
}
