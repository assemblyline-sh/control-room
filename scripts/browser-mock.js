// Render the UI in a plain browser (no Tauri window) on real data.
//
// 1. Dump fixtures — the real read commands run against the local host:
//      cd src-tauri && CR_UI_FIXTURES=/tmp/fixtures.json cargo test -- --ignored dump_ui_fixtures
// 2. `npm run dev`, then in Playwright: serve the file at /__fixtures.json
//    (page.route → route.fulfill({ path })) and page.addInitScript(mockTauri).
//
// invoke() answers from the fixtures (keyed `cmd|args` with sorted keys, as
// serde_json writes them); clear_workpieces and requeue_workpieces only pretend. Events are no-ops.
// Terminal sessions open but print nothing (channels aren't wired).

function mockTauri() {
  const sortKeys = (v) =>
    Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
  let fixtures = null;
  const load = () => (fixtures ??= fetch("/__fixtures.json").then((r) => r.json()));
  window.__missing = [];
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: () => Math.floor(Math.random() * 1e9),
    unregisterCallback: () => {},
    convertFileSrc: (p) => p,
    invoke: async (cmd, args) => {
      if (cmd.startsWith("plugin:")) return 0;
      if (cmd === "read_legacy_config") return [];
      if (cmd === "clear_workpieces") return { removed: (args?.dirs ?? []).length };
      if (cmd === "requeue_workpieces") return { requeued: (args?.workpieces ?? []).length };
      if (cmd === "terminal_open") return "term-mock";
      if (cmd === "terminal_write" || cmd === "terminal_resize" || cmd === "terminal_close") return null;
      const key = `${cmd}|${JSON.stringify(sortKeys({ ...(args ?? {}) }))}`;
      const hit = (await load())[key];
      if (!hit) {
        window.__missing.push(key);
        throw `no fixture: ${key}`;
      }
      if ("err" in hit) throw hit.err;
      return hit.ok;
    },
  };
}

module.exports = { mockTauri };
