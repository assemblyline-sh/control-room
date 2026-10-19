# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repo.

## Project Overview

`control-room` is a Tauri 2 + Next.js desktop app — the "Lens" to the al-control CLI's "kubectl". It reads the same config, `~/.assemblyline/al-control/config.yml` (hosts → factories), shows one host at a time, and renders factory-floor state for that host's `factory-*` repos: through al-control's probe, run with this machine's `node` for `local` or piped over `ssh` for a remote host. It needs `node` on the user's machine (every machine that runs a factory has it) but no CLI install. The UI is a VS Code-style three-pane shell: tree rail on the left, tab strip + per-resource view on the right. See `README.md` for the product overview and `docs/wip/fork-and-reshape.md` for the fork from fob-watch (FinOpsBricks), whose history holds the design log of everything below.

## Related repositories

In the Assembly Line workspace (`~/ec2code/assemblyline/`, see its CLAUDE.md):

- `cli/al-control` — the CLI whose config, probe (`src/probe.js`, bundled here as `src-tauri/resources/probe.js`) and rules (error keys, clear guards) this app mirrors. Keep them in parity.
- `factories/factory-*` — the repos a user points control-room at (lib-factory factories).
- `apps/orchestrator.assemblyline.sh` — the orchestrator; control-room only links to it (from `.orchestrator/factory.json`).

## Architecture

```
React (Next.js, static export)
   ↓ invoke(...)
Tauri 2 Rust commands — every factory command takes (host, factory name)
   ├── commands.rs + central_config.rs     ~/.assemblyline/al-control/config.yml: load / add / remove;
   │                                       pick_folder
   ├── resolve.rs                          (host, factory) → config entries, on every call
   ├── monitor_commands.rs                 lines / stations / bins / workpieces / files
   │     ↓ Source (source/mod.rs) — probe-shaped data (RawState, Lines, logs, workpiece, read)
   │     ├── source/probe.rs               al-control's probe on every host: this machine's node, or
   │     │                                 the host's; several queries per run (`probe_all`)
   │     └── source/ssh.rs                 `ssh … node -` for remote hosts (also pm2, terminal);
   │                                       emits "ssh-stderr" / "ssh-call" events
   │   monitor.rs                          joins the probe's `lines` (order, terminal) with
   │                                       `state`'s bins; positions, events, links
   ├── failures.rs                         error_key (al-control errorKey parity) + list_failures
   ├── housekeeping.rs                     plan_clear (scopes + filter → bins, skips, ages)
   │                                       clear_workpieces (re-plans, refuses, then Source::remove)
   ├── requeue.rs                          requeue_workpieces (failed/done → own input; ids
   │                                       re-resolved from fresh state, then Source::requeue)
   ├── host_commands.rs                    test_host / check_factory_path / open_terminal / fetch_file;
   │                                       terminal_dir (factory folder for both terminals)
   ├── terminal.rs                         integrated terminal: PTY sessions (portable-pty) running
   │                                       the user's shell, or `ssh -tt` on remote hosts
   ├── windows.rs                          one window per host: claim_window_host / open_host_window
   └── pm2.rs                              start / stop / status / log tail — local, or via ssh
                                           ("pm2-log" events keyed host/factory)
```

**Data rule:** nothing above `source/` touches a factory's disk, and nothing in `source/` reads one except through the probe (al-control decision 0006). `src-tauri/resources/probe.js` is al-control's `src/probe.js` at the version pinned in `package.json`, byte for byte: never edit it here. A change goes to al-control first, then bump the pin and `npm run check:probe -- --copy`; CI fails on any difference. Station order, terminal stations and line summaries come from the probe's `lines` query; don't port them to Rust. On this machine the probe runs with the local host's `node:` from the config, else the login shell's `node` (`probe::local_node`), with that node's directory first on PATH so the probe's `pm2 jlist` finds pm2. Two exceptions read local files directly, containment-checked in `host_commands.rs`: `fetch_file` and `read_file_bytes` hand a local workpiece file to the OS or the media view.

**Clear rule:** the only delete is `clear_workpieces`, and it goes through three checks: the plan (`done` anywhere, a terminal `output`; not in the factory's config `keep`; not a `lib-factory:move_files` source_bin), a re-plan from fresh state in `clear_workpieces` that refuses any dir not clearable *now* (never trust the dirs JS sends), and the probe's own `remove` (under temp/stations, done/output, not kept, has pointer.json). Keep these in step with al-control's `workpieces clear` and its decision 0005. Every UI entry point opens `ClearDialog` via `useClear()` (`src/state/clear-context.jsx`); after a clear it bumps `src/state/data-epoch.js`, which marks every cached `useFetcher` entry stale.

**Retry rule:** the only move is `requeue_workpieces`. A workpiece goes from a station's `failed` or `done` bin to **that same station's** `input`, flat at `input/<id>` (lib-factory reads input flat). Like clear, it has three layers: `canRetry` in `src/lib/retry.js` gates the rail's drop target and menu items; the command resolves ids against fresh state (JS sends ids, never paths); and the source re-checks before moving anything (the probe's `requeue`: normalised path in `failed`/`done`, has pointer.json, `input/<id>` free). The move deletes `error.json`/`error.txt` and appends a `requeued` event to `log.jsonl`. No orchestrator run is triggered: lib-factory's bin-watch fires on a station's own input backlog, and cron'd stations pick it up on their next tick. A retry from `done` asks first..

**Error keys** must match al-control's: `failures.rs` has its test vectors and an `#[ignore]`d `error_key_parity` test that runs al-control's `errorKey` with node over every real failure.

**Config rule:** control-room has no config of its own. It writes the central file only for add/remove factory/host (comments in it are lost on write — same as the CLI's `hosts use`), and **never writes `current_host`**: the host is per-window app state, so nothing in the app can retarget the CLI.

**Window rule:** one window per host, fixed for the window's life (VS Code style). `windows.rs` keeps label → host; the host picker calls `open_host_window`, which focuses that host's window or opens one (`host-N`, host injected as `window.__CONTROL_ROOM_HOST__`). `main` boots on the last-focused host (localStorage) and claims it via `claim_window_host`. The OS menu is Tauri's default plus File → New Window ▸ <host> (same `open`; rebuilt from the config whenever a window boots or opens). Closing a window stops its host's pm2 log tails and kills its terminal sessions. Capabilities cover `main` and `host-*`.

The React layer **never** imports `@tauri-apps/api/*` directly. All Tauri calls go through `src/lib/tauri-api.js`, which exports typed (via JSDoc) wrappers around `invoke()`. New IPC entry points must be added there.

UI shape: `src/app/page.jsx` boots config and renders `<Shell />`. `Shell` owns the config, SSH-status, tabs and tree state via context providers (`src/state/{config,ssh,tabs,tree}-context.jsx`). Every tab is on the window's host. The left pane is `src/components/Rail/` (recursive tree, lazy children); the right pane is `src/components/TabStrip/` + `src/components/TabContent.jsx`, which switches on `resource.type` and renders one `src/views/<type>/View<X>.jsx` per type. Every open tab stays mounted and only the active one is shown, so a tab keeps its open groups, filters and scroll. Data tabs are hidden in React's `<Activity>`, which pauses their effects (fetching, polling) until shown; terminal and logs tabs (`ALWAYS_ON` in `TabContent.jsx`) keep running while hidden, so a shell session or log tail survives a switch, and read `useTabVisible()` (`src/state/tab-visible.js`) to refit or flag attention. Each view consumes a matching `use<X>Data.js` hook that wraps the relevant monitor command via `src/lib/use-fetcher.js`, a window-wide cache keyed by query (stale-while-revalidate). The `ResourceId` discriminated union in `src/lib/resource-id.js` is the single shape every layer agrees on.

## Common commands

| Command | What it does |
|---------|--------------|
| `npm run tauri:dev` | Runs `next dev` + native Tauri window |
| `npm run tauri:build` | Builds installers for the current platform |
| `npm run dev` | Next.js only (browser-only; `invoke()` will throw) |
| `npm run typecheck` | `tsc -p jsconfig.json` (uses `@ts-check` headers) |
| `npm run lint` / `npm run format` | ESLint CLI (`eslint.config.mjs`, flat config) / Prettier |
| `npm run check:probe` | The bundled probe is al-control's, byte for byte (`-- --copy` to update it after bumping the pin) |
| `cargo test -- --ignored error_key_parity` / `plan_every_host` / `every_configured_factory` / `counts_timing` | Real-data checks against your config (in `src-tauri`) |
| `CR_UI_FIXTURES=… cargo test -- --ignored dump_ui_fixtures` | Fixtures for rendering the UI in a browser with `scripts/browser-mock.js` |

## Engineering standards applied

Per the [engineering standards](https://github.com/alexjv89/engineering-standards):

- **JS + JSDoc, not TypeScript.** Add `// @ts-check` at the top of each new file and JSDoc types for params / returns.
- **Variables snake_case, functions camelCase.** Example: `const can_finish = ...`; `function addRepo() { ... }`.
- **React state hooks**: lowercase setter (`set_output`, `set_loading`), not `setOutput`.
- **WIP files** under `docs/wip/`, format per `engineering-standards/git-workflow/wip-files.md`.
- **No one-shot utility functions.** If a helper would be called once, inline it.
- **Minimal comments.** Only when the WHY is non-obvious.

## Tauri-specific conventions

- **All commands return `Result<T, CommandError>`.** Variants are scoped (`ConfigDir`, `Io`, `Json`, `Dialog`, `Pm2`) so the UI can render specific failure modes. Don't introduce a generic `Other(String)`. `monitor::MonitorError` collapses into `CommandError::Io` / `Json` at the command boundary.
- **No JS-invokable shell-execute capability.** `shell:default` + `shell:allow-open` in `capabilities/default.json` are kept only for `openInFinder` (which opens `file://` URLs via the OS) — that capability scope governs what the webview's JS can invoke via `@tauri-apps/plugin-shell`, nothing else. `src-tauri/src/pm2.rs` *does* spawn an external binary (`pm2`) via plain `std::process::Command` from inside already-registered `#[tauri::command]` bodies — this needs **no capability grant at all**, since Tauri's ACL only gates the webview→Rust boundary, not what a Rust command does internally (same reasoning as `read_file`'s containment check being manual Rust logic, not a declared `fs:*` scope). Always hardcode the binary name literals (`"pm2"`, `"ssh"`, and `open`/`x-terminal-emulator` for Open in Terminal) — never build one from JS-supplied input. Everything interpolated into a remote command goes through `ssh::shell_quote`, and an ssh alias may never start with `-` (config validation enforces it). don't reintroduce a *JS-invokable* shell-execute capability without thinking through whether it's actually needed.
- **The integrated terminal is the one deliberate exception**: the webview types into a shell (`src-tauri/src/terminal.rs`). Keep it narrow: JS sends `(host, factory, dir)` and keystrokes, never a command or argv; Rust resolves the folder (`host_commands::terminal_dir`, containment-checked), hardcodes the binaries (`ssh`, the user's login shell) and builds the command; `terminal_write`/`resize`/`close` are refused for a session another window opened. Output goes over a per-session `tauri::ipc::Channel` as raw bytes, not `emit`. Sessions die with their tab, their window, the app or the ssh connection: no tmux, deliberately (simplicity first)..
- **Live log tailing uses Tauri's event system** (`app.emit("pm2-log", ...)` / `listen()`), the one exception to "React never imports `@tauri-apps/api/*` directly" being that `onPm2Log` in `tauri-api.js` wraps the `listen()` call so views still only touch `tauri-api.js`. A long-running `pm2 logs --raw` child process is tracked in `LogTailState` (managed Tauri state, keyed by pm2 app name) and killed on tab-close (`stop_log_tail`) or app exit (`RunEvent::ExitRequested` in `lib.rs`) — killing the tail never affects the pm2-managed factory itself, only the log stream.
- **Dialog calls use `spawn_blocking`** because `blocking_pick_folder` can't run on the main async thread.
- **`CommandError` gained `Config`, `Ssh` and `Refused`.** `Refused` is a guard saying no (the probe's `REFUSED`), so the UI can tell it from an I/O failure.
- **SSH has no terminal here.** `source/ssh.rs` streams ssh's stderr as `ssh-stderr` events and each call as `ssh-call` start/ok/error; `SignInBanner` shows a URL from stderr (Tailscale SSH check mode) while a call waits. Remote calls time out after 120s.
- **File reads are containment-checked.** `read_file` lexically resolves `..` and refuses to read outside `factory_path`. Don't bypass this — the user's filesystem is the trust boundary.
- **Static export, no Node runtime in the bundle.** Tauri ships a Rust binary + the OS's webview, with no embedded Node.js. SSR, route handlers, and server actions all assume a Node runtime at request time, which doesn't exist here — `next.config.mjs` sets `output: 'export'` and the entire UI is client-rendered. Privileged work (filesystem, dialogs, spawning `pm2`, `ssh` and `node`) goes through Rust commands in `src-tauri/src/commands.rs`, called from JS via the wrappers in `src/lib/tauri-api.js`. See `docs/architecture/tauri-vs-electron-and-ssr.md` for the full reasoning, including why this isn't a deviation from the orchestrator's SSR pattern.

## Conventions to NOT adopt

- The orchestrator uses `@fob/lib-ui`, Radix, Sentry, etc. **control-room deliberately doesn't.** It's a single-window desktop app with a tiny UI; pulling in those deps would bloat the bundle and introduce SSR-coupled code that breaks static export. Keep dependencies minimal.
