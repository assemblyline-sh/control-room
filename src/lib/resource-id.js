// @ts-check

/**
 * A ResourceId is a typed pointer to one resource the rail/tabs/views can address.
 * Every component that opens, closes, or routes to a resource takes one of these.
 *
 * Hierarchy lives here (in the shape of each variant), not in folder nesting.
 * `name` / `description` on line and station, and `is_terminal` on station
 * and bin, are display-only (the rail's tooltip and menus) and never part of
 * the id. `failures` and `housekeeping` cover every factory on the host unless
 * `factory` is set; `error_key` pre-filters Failures to one group.
 * `terminal.session` is a client-made id, so one folder can have several
 * terminal tabs; `dir` is relative to temp/stations/.
 *
 * @typedef {(
 *   | { type: 'factory',           host: string, factory: string }
 *   | { type: 'line',             host: string, factory: string, line: string, name?: string | null, description?: string | null }
 *   | { type: 'station',          host: string, factory: string, line: string, station: string, name?: string | null, description?: string | null, is_terminal?: boolean }
 *   | { type: 'bin',              host: string, factory: string, line: string, station: string, bin: string, is_terminal?: boolean }
 *   | { type: 'workpiece',        host: string, factory: string, line: string, station: string, bin: string, workpiece: string }
 *   | { type: 'work-record',      host: string, factory: string, line: string, station: string, work_record: string }
 *   | { type: 'file',             host: string, factory: string, file_path: string }
 *   | { type: 'factories-overview', host: string }
 *   | { type: 'factory-logs',      host: string, factory: string }
 *   | { type: 'failures',         host: string, factory?: string, error_key?: string }
 *   | { type: 'housekeeping',     host: string, factory?: string }
 *   | { type: 'terminal',         host: string, factory: string, dir?: string, session: string }
 * )} ResourceId
 */

/**
 * Stable string form for use as a Map/Set key. Array (not object) so JSON
 * ordering is guaranteed identical across engines.
 *
 * @param {ResourceId} id
 * @returns {string}
 */
export function resourceIdToString(id) {
  switch (id.type) {
    case "factory":
      return JSON.stringify(["factory", id.host, id.factory]);
    case "line":
      return JSON.stringify(["line", id.host, id.factory, id.line]);
    case "station":
      return JSON.stringify(["station", id.host, id.factory, id.line, id.station]);
    case "bin":
      return JSON.stringify(["bin", id.host, id.factory, id.line, id.station, id.bin]);
    case "workpiece":
      return JSON.stringify([
        "workpiece",
        id.host,
        id.factory,
        id.line,
        id.station,
        id.bin,
        id.workpiece,
      ]);
    case "work-record":
      return JSON.stringify([
        "work-record",
        id.host,
        id.factory,
        id.line,
        id.station,
        id.work_record,
      ]);
    case "file":
      return JSON.stringify(["file", id.host, id.factory, id.file_path]);
    case "factories-overview":
      return JSON.stringify(["factories-overview", id.host]);
    case "factory-logs":
      return JSON.stringify(["factory-logs", id.host, id.factory]);
    case "failures":
      return JSON.stringify(["failures", id.host, id.factory ?? null, id.error_key ?? null]);
    case "housekeeping":
      return JSON.stringify(["housekeeping", id.host, id.factory ?? null]);
    case "terminal":
      return JSON.stringify(["terminal", id.host, id.factory, id.session]);
    default: {
      const _exhaustive = /** @type {never} */ (id);
      throw new Error(`unknown resource type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Human-readable title for tab labels and tree nodes. Stays short so it
 * fits in a narrow rail or a crowded tab strip.
 *
 * @param {ResourceId} id
 * @returns {string}
 */
export function resourceIdToTitle(id) {
  switch (id.type) {
    case "factory":
      return id.factory;
    case "line":
      return id.line;
    case "station":
      return id.station;
    case "bin":
      return `${id.station}/${id.bin}`;
    case "workpiece":
      return id.workpiece;
    case "work-record":
      return id.work_record;
    case "file":
      return basename(id.file_path);
    case "factories-overview":
      return "Factories";
    case "factory-logs":
      return `${id.factory} — logs`;
    case "failures": {
      const key = id.error_key && id.error_key.length > 40 ? `${id.error_key.slice(0, 39)}…` : id.error_key;
      return ["Failures", id.factory, key].filter(Boolean).join(" — ");
    }
    case "housekeeping":
      return id.factory ? `Housekeeping — ${id.factory}` : "Housekeeping";
    case "terminal":
      return `${id.dir ? basename(id.dir) : id.factory} — terminal`;
    default: {
      const _exhaustive = /** @type {never} */ (id);
      throw new Error(`unknown resource type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * lucide-react icon name per resource type. The consumer renders the icon —
 * this module stays UI-library-agnostic.
 *
 * @param {ResourceId['type']} type
 * @returns {string}
 */
export function resourceIdToIcon(type) {
  switch (type) {
    case "factory":
      return "package";
    case "line":
      return "route";
    case "station":
      return "box";
    case "bin":
      return "archive";
    case "workpiece":
      return "file-cog";
    case "work-record":
      return "clipboard-list";
    case "file":
      return "file";
    case "factories-overview":
      return "layout-grid";
    case "factory-logs":
      return "terminal";
    case "failures":
      return "alert-triangle";
    case "housekeeping":
      return "trash-2";
    case "terminal":
      return "square-terminal";
    default: {
      const _exhaustive = /** @type {never} */ (type);
      throw new Error(`unknown resource type: ${String(_exhaustive)}`);
    }
  }
}

/**
 * On-disk folder that should be opened for "Reveal in Finder" / "Reveal
 * in Explorer". Returns `null` for resources without a direct disk path
 * (lines, work-records — virtual / TBD).
 *
 * For `file`, we return the *parent* directory: shellOpen on a regular
 * file just opens it in the default app, which isn't what "reveal" means
 * to most users.
 *
 * `factory_root` is the factory's absolute root on this machine, or null for
 * a remote host — remote folders can't be revealed in Finder.
 *
 * @param {ResourceId} id
 * @param {string | null} factory_root
 * @returns {string | null}
 */
export function resourceToDiskPath(id, factory_root) {
  if (!factory_root) return null;
  switch (id.type) {
    case "factory":
      return factory_root;
    case "station":
      return `${factory_root}/temp/stations/${id.station}`;
    case "bin":
      return `${factory_root}/temp/stations/${id.station}/${id.bin}`;
    case "workpiece":
      return `${factory_root}/temp/stations/${id.station}/${id.bin}/${id.workpiece}`;
    case "file": {
      const idx = id.file_path.lastIndexOf("/");
      const parent = idx === -1 ? "" : id.file_path.slice(0, idx);
      return parent ? `${factory_root}/${parent}` : factory_root;
    }
    case "line":
    case "work-record":
    case "factories-overview":
    case "factory-logs":
    case "failures":
    case "housekeeping":
    case "terminal":
      return null;
    default: {
      const _exhaustive = /** @type {never} */ (id);
      return null;
    }
  }
}

/**
 * Expand every rail-tree ancestor of `resource` so the user can see it in
 * place after "Reveal in Explorer View". Each ancestor's children are
 * lazy-fetched via the TreeNode's own useEffect once its `expanded` flag
 * flips — we just have to put the keys in the expanded set.
 *
 * For `file` resources we parse `temp/stations/<station>/<bin>/<workpiece>/…`
 * from `file_path` to recover the deeper context, and call `listLines`
 * once to map the station back to its line (the file ResourceId itself
 * doesn't carry a line).
 *
 * @param {ResourceId} resource
 * @param {(a: import('@/state/tree').TreeAction) => void} dispatch
 * @returns {Promise<void>}
 */
export async function revealInRail(resource, dispatch) {
  const ancestors = await ancestorsOf(resource);
  for (const a of ancestors) dispatch({ type: "expand", resource: a });
}

/**
 * @param {ResourceId} resource
 * @returns {Promise<ResourceId[]>}
 */
async function ancestorsOf(resource) {
  // Handled first, before destructuring the factory below — this is the one
  // variant without that field.
  if (resource.type === "factories-overview" || resource.type === "failures" || resource.type === "housekeeping") {
    return [];
  }

  const { host, factory } = resource;
  /** @type {ResourceId[]} */
  const out = [];
  const push_factory = () => out.push({ type: "factory", host, factory });

  switch (resource.type) {
    case "factory":
      return [];
    case "line":
      push_factory();
      return out;
    case "station":
      push_factory();
      out.push({ type: "line", host, factory, line: resource.line });
      return out;
    case "bin":
      push_factory();
      out.push({ type: "line", host, factory, line: resource.line });
      out.push({
        type: "station",
        host,
        factory,
        line: resource.line,
        station: resource.station,
      });
      return out;
    case "workpiece":
      push_factory();
      out.push({ type: "line", host, factory, line: resource.line });
      out.push({
        type: "station",
        host,
        factory,
        line: resource.line,
        station: resource.station,
      });
      out.push({
        type: "bin",
        host,
        factory,
        line: resource.line,
        station: resource.station,
        bin: resource.bin,
      });
      return out;
    case "work-record":
      push_factory();
      out.push({ type: "line", host, factory, line: resource.line });
      out.push({
        type: "station",
        host,
        factory,
        line: resource.line,
        station: resource.station,
      });
      return out;
    case "file": {
      // File path shape we care about:
      //   temp/stations/<station>/<bin>/<workpiece>/<name>
      const m = resource.file_path.match(
        /^temp\/stations\/([^/]+)\/([^/]+)\/([^/]+)\//,
      );
      push_factory();
      if (!m) return out;
      const [, station, bin, workpiece] = m;
      // Look up the line via listLines — file ResourceId doesn't carry it.
      const { listLines } = await import("@/lib/tauri-api");
      let line = null;
      try {
        const lines = await listLines(host, factory);
        const row = lines.find((l) => l.stations.includes(station));
        line = row ? row.code : null;
      } catch {
        // Treat as no line known — partial reveal still beats none.
      }
      if (!line) return out;
      out.push({ type: "line", host, factory, line });
      out.push({ type: "station", host, factory, line, station });
      out.push({ type: "bin", host, factory, line, station, bin });
      out.push({ type: "workpiece", host, factory, line, station, bin, workpiece });
      return out;
    }
    case "factory-logs":
    case "terminal":
      push_factory();
      return out;
    default: {
      const _exhaustive = /** @type {never} */ (resource);
      return out;
    }
  }
}

/**
 * Resolve a node's children for the rail tree. Each branch calls a Tauri
 * monitor command and maps the response into ResourceIds for the next level.
 *
 * Bins under a station are inlined (no synthetic grouping node) — the
 * 5-bin contract is fixed, so adding a click to expand a "bins" header
 * doesn't pay rent. Work-records will join the same list once their
 * on-disk shape is confirmed (watch-shell Open Question 4).
 *
 * Files are leaves; their resolveChildren returns [].
 *
 * @param {ResourceId} id
 * @returns {Promise<ResourceId[]>}
 */
export async function resolveChildren(id) {
  const { listLines, showLine, listBinWorkpieces, listFilesInWorkpiece } =
    await import("@/lib/tauri-api");

  switch (id.type) {
    case "factory": {
      const lines = await listLines(id.host, id.factory);
      return lines.map((l) => ({
        type: "line",
        host: id.host,
        factory: id.factory,
        line: l.code,
        name: l.name,
        description: l.description,
      }));
    }
    case "line": {
      const detail = await showLine(id.host, id.factory, id.line);
      return detail.stations.map((s) => ({
        type: "station",
        host: id.host,
        factory: id.factory,
        line: id.line,
        station: s.station,
        name: s.name,
        description: s.description,
        is_terminal: s.is_terminal,
      }));
    }
    case "station": {
      // Fixed 5-bin contract. Work-records will join as siblings once
      // Open Question 4 (on-disk shape) is answered.
      return ["input", "doing", "output", "failed", "done"].map((bin) => ({
        type: "bin",
        host: id.host,
        factory: id.factory,
        line: id.line,
        station: id.station,
        bin,
        is_terminal: id.is_terminal,
      }));
    }
    case "bin": {
      const rows = await listBinWorkpieces(id.host, id.factory, id.station, id.bin);
      return rows.map((row) => ({
        type: "workpiece",
        host: id.host,
        factory: id.factory,
        line: id.line,
        station: id.station,
        bin: id.bin,
        workpiece: row.id,
      }));
    }
    case "workpiece": {
      const entries = await listFilesInWorkpiece(
        id.host,
        id.factory,
        id.station,
        id.bin,
        id.workpiece,
      );
      return entries
        .filter((e) => !e.is_dir)
        .map((e) => ({
          type: "file",
          host: id.host,
          factory: id.factory,
          file_path: e.path,
        }));
    }
    case "work-record": {
      // Blocked on watch-shell Open Question 4: confirm on-disk shape.
      return [];
    }
    case "file": {
      return [];
    }
    case "factories-overview":
    case "factory-logs":
    case "failures":
    case "housekeeping":
    case "terminal": {
      // None is a rail-tree node — opened directly via a button/tab
      // dispatch, never expanded as a child. No children to resolve.
      return [];
    }
    default: {
      const _exhaustive = /** @type {never} */ (id);
      throw new Error(
        `unknown resource type: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/**
 * A new terminal tab's resource — a fresh session each time.
 *
 * @param {string} host
 * @param {string} factory
 * @param {string} [dir] - relative to temp/stations/
 * @returns {ResourceId}
 */
export function newTerminal(host, factory, dir) {
  return { type: "terminal", host, factory, dir, session: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` };
}

/**
 * Last path segment, stripping trailing separators. Works for POSIX and
 * Windows-style paths since control-room supports both.
 *
 * @param {string} p
 * @returns {string}
 */
function basename(p) {
  const trimmed = p.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}
