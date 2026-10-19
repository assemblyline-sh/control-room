# Tauri vs. Electron, SSR, and the static-export decision

Reference doc capturing why control-room is a Tauri app with a statically-exported Next.js frontend, why SSR isn't on the table, and how the trade-offs compare to Electron. Written so the next person doesn't have to re-derive any of this.

> Written for fob-watch 0.1, when the app shelled out to the `fob` CLI for every read (`run_fob`). It now runs the al-control probe and pm2 instead, but the reasoning on SSR and static export still holds.

## TL;DR

- control-room is a **desktop app**, not a web app. The orchestrator's SSR conventions don't directly apply.
- Tauri ships a **Rust binary + the OS's native webview**. There is no Node.js runtime in the bundle, so SSR — which assumes a live Node process — can't run.
- This wasn't a stylistic preference; it's a direct consequence of picking Tauri. Picking Tauri was driven by bundle size (~10 MB vs. Electron's ~150 MB) and the WIP goal of "a downloaded binary just works."
- For a single-user, single-machine, read-local-files tool, neither SSR nor a local Node server provides any value the app can't get from Rust + CSR.
- The CLAUDE.md "No SSR" line that prompted this doc has been rewritten to explain *why*, not just *what*.

## How the app actually runs

```
User double-clicks control-room.app
        │
        ▼
  Rust binary starts (the Tauri shell)
        │
        ├── Opens a native OS window
        │   containing a webview (WKWebView on macOS,
        │   WebView2 on Windows, WebKitGTK on Linux)
        │
        ├── Webview loads static HTML/JS/CSS bundled
        │   inside the .app (Next.js `output: 'export'` output)
        │
        └── JS in the webview calls invoke('cmd_name', args)
            which crosses an IPC bridge into Rust
            (src-tauri/src/commands.rs):
              - read_config / write_config (filesystem)
              - pick_folder              (native dialog)
              - run_fob({ args, cwd })   (spawn child process)
```

Important things to notice:

- **No Node.js process exists at runtime.** The Rust binary handles everything Node would normally handle in an Electron app.
- **The webview is the OS's**, not bundled. That's where Tauri's bundle-size win comes from.
- **JS↔Rust IPC is not HTTP.** It's Tauri's `invoke()` mechanism — direct serialized message passing, conceptually identical to Electron's `ipcMain`/`ipcRenderer`.

## Why static export, not SSR?

SSR is "Next.js renders pages on a live Node server, sends rendered HTML to the browser." Three components have to exist for that to happen:

1. A Node.js process.
2. That process must be reachable when the user navigates to a page.
3. It must have access to whatever data the page needs (DB connections, secrets, etc.).

In a Tauri app:

- **(1) doesn't exist** — the bundle has Rust and a webview, nothing else.
- Even if we spawned a Node sidecar (see "Could we run a Node sidecar?" below), **(3) still wouldn't help us** — the data we'd want to query lives on the *user's* disk at runtime, which is unknowable at build time and unrelated to SSR's typical use case (database queries).

So `next.config.mjs` is set to `output: 'export'`. At `npm run tauri:build`, Next.js renders every page to a static `.html` file and emits them to `out/`. The Rust shell ships that `out/` folder inside the .app and the webview loads files from it.

### What this means for routing

Static export imposes a hard constraint: only routes that exist *at build time* can be served.

- Routes with dynamic segments like `/factory/[path]/line/[line]/bin/[bin]` require `generateStaticParams()` to declare every value of `[path]`, `[line]`, `[bin]` ahead of time.
- control-room's factory paths are user-supplied at runtime (the user picks a folder via the native dialog). We have **zero knowledge** of them at build time. There's nothing to feed to `generateStaticParams`.

The workable options for in-app navigation are therefore:

| Option | Routes | Back button | Reload-restores-view | Notes |
|---|---|---|---|---|
| React state in a single `page.jsx` | 1 | ✗ | ✗ | Current implementation. Simple. |
| Query string in a single `page.jsx` | 1 | ✓ | ✓ | `?factory=...&line=...`, read via `useSearchParams()`. Closest we can get to deep links without dropping static export. |
| Real dynamic routes | many | ✓ | ✓ | **Requires dropping `output: 'export'`**, which means dropping Tauri's static-file model. Big architectural change. |

For a desktop tool that always opens fresh, option 1 is fine; option 2 is the cheap upgrade if browser-back ever becomes a requirement.

## Why we chose Tauri (and how Electron differs)

Both Tauri and Electron solve "make a web UI feel like a native app." They use different lower halves to do it:

|  | **Tauri** | **Electron** |
|---|---|---|
| UI renderer | OS native webview (WKWebView / WebView2 / WebKitGTK) | Bundled Chromium |
| App-logic runtime | Compiled Rust binary | Bundled Node.js process |
| Privileged ops (fs, dialogs, spawn) | Rust commands behind `invoke()` | Node APIs in main process, exposed via `ipcMain` |
| Bundle size | ~10 MB | ~150 MB |
| Memory at idle | ~50–100 MB | ~200–500 MB |
| Rendering consistency across OSes | Each OS's webview — subtle WebKit-vs-Chromium differences | Same Chromium everywhere |
| Language for privileged code | Rust | JavaScript / TypeScript |

Two questions this table provokes are worth answering directly because they came up during the design conversation.

### Why does Electron bundle Node if it doesn't run a "server"?

"Server" was the misleading word. Electron doesn't run an HTTP server inside the app — it uses IPC, same as Tauri. But it bundles **Node.js as a runtime** because the Electron main process is *a JavaScript program*, and JavaScript needs an interpreter to execute. Without Node present at runtime, there's no language for the main process to run in.

That's the only reason: JavaScript is interpreted, so its interpreter has to ship with the app.

### Why doesn't Tauri bundle Rust, then?

Because **Rust is compiled, not interpreted.** `tauri build` runs the Rust compiler, which produces a native binary — actual machine instructions for x86-64 / ARM64 / etc. The user's machine runs that binary directly via the OS kernel. There is no "Rust runtime" sitting in the middle parsing source code, the way Node sits in the middle parsing JS.

Analogy: a C++ desktop app doesn't bundle a C++ compiler. A Python app does (effectively) bundle Python. Rust is in the C++ camp; Node is in the Python camp.

### Why is Electron's bundle so much bigger?

Rough breakdown:

**Electron (~150 MB):**
- Chromium: ~120 MB (Blink renderer, V8 engine, networking, codecs, sandboxing)
- Node.js: ~25 MB (runtime + standard library: libuv, openssl, zlib, built-ins)
- App code + `node_modules`: a few MB

**Tauri (~10 MB):**
- Compiled Rust binary: ~5–10 MB
- Webview: **0 MB — uses the OS's**
- App JS/HTML/CSS: ~1–3 MB

The dominant factor is **Chromium**, not Node. Tauri's main bundle-size trick is not shipping a browser at all — it leans on the OS's webview, which is already installed everywhere modern enough to run the app.

### When would we pick Electron over Tauri?

Real reasons, not religion:

1. **Cross-platform rendering consistency is critical.** Heavy CSS/Canvas/WebGL/animation work that subtly breaks differently in WebKit (mac/Linux) vs. Chromium might be worth 150 MB to get one renderer everywhere.
2. **Heavy reliance on the Node ecosystem.** Native-binding-heavy npm packages (SQLite drivers, OS APIs via `node-ffi-napi`, ML libs) "just work" in Electron. With Tauri you'd port them to Rust crates or wrap them via sidecars.
3. **JS-only team.** Tauri needs Rust for any new privileged operation. Electron keeps everything in JS.
4. **Maturity matters more than bundle size.** Electron's been shipping production desktop apps since 2013 (Atom, then VS Code, Slack, Discord, Linear, Notion). Bigger ecosystem of plugins, auto-updaters, code-signing recipes, crash reporters.
5. **Niche native APIs** with existing Electron plugins but no Tauri equivalent yet.
6. **Auto-update infra you'd rather inherit.** Squirrel.Mac, Squirrel.Windows, electron-updater are very well-trodden.

None of these apply to control-room. Tiny UI, no heavy Node dependencies, the privileged ops we need are already implemented in Rust in 30 lines each, FDE team is comfortable with the stack, and the WIP explicitly prioritized small bundle size and "downloaded binary just works."

## SSR vs. local-Node-server vs. remote server — when does each become required?

This is the source of most confusion. Three distinct things often get bundled under "we need a backend":

### A. Server-side rendering of UI

Required when:
- SEO matters (search engines need indexable HTML).
- First-paint over slow networks matters and you can pre-render data.
- Per-request data lives on a server the client can't reach (DB credentials, etc.).

**Required for control-room? No.** No SEO (it's a desktop app). First paint is reading local disk — already fast. Per-request data lives on the user's own filesystem; the *user* is who needs to read it, and only at runtime.

### B. A long-running localhost HTTP server inside the desktop app

Required when:
- A library you're embedding requires HTTP (Jupyter kernel, a vendor SDK).
- You're reusing a Next.js SSR codebase verbatim and don't want to refactor.

**Required for control-room? No.** Tauri's `invoke()` IPC fills the role HTTP would. Electron's `ipcMain` does the same. The vast majority of Electron apps don't run a localhost server either — Slack, VS Code, Discord, Linear, Notion all use IPC, not HTTP.

### C. A remote server somewhere on the internet

Required when:
- **Login / multi-user identity** — auth and session state can't live in a shipped binary.
- **Cross-device sync** — state has to be reconciled across machines.
- **Centralized data** — what one user sees depends on others (Slack messages, GitHub issues).
- **Privileged API access** — calling third-party APIs whose secrets you don't want extracted from the desktop bundle.

**Required for control-room today? No** — single user, single machine, data is local files. The WIP non-goals explicitly say "no orchestrator API calls, no telemetry."

**Likely required if control-room grows.** If we ever add "log in with your FOB account and view *any* factory remotely," we'd need (C). The desktop app would still be Tauri+CSR; it would just make authenticated HTTPS calls to a separate remote backend (probably the orchestrator). No SSR, no local Node server.

## Why Slack runs Node (clearing up a common misconception)

Slack's desktop app uses Electron, which means a Node.js runtime is part of the app process. But Slack does **not** run a localhost HTTP server inside the desktop bundle. What Node is doing for Slack:

- **Persistent WebSocket** to Slack's real-time messaging gateway (`wss://wss-primary.slack.com/...`). Node owns the long-lived connection; UI reads from an in-memory store.
- **Main-process logic** in Electron's two-process model (main process = Node, renderer = Chromium). Window lifecycle, native menus, deep links (`slack://`), system tray, badge counts.
- **OS integrations** — notifications, screen capture, microphone permissions, file dialogs.
- **Local cache** — SQLite for message history, offline replay.
- **Auto-update**, crash reporting (Squirrel, Sentry).

Main-process ↔ renderer communication is **IPC, not HTTP** — `ipcMain.handle(...)` / `ipcRenderer.invoke(...)`. Same shape as Tauri's `invoke()`, just JavaScript on both sides instead of JS↔Rust.

Translation: everything Node does for Slack, Rust does for control-room. There is no "Slack needs SSR" requirement hiding in there.

## Could we run a Node sidecar in Tauri anyway?

Yes. Tauri's child-process API doesn't prohibit long-running processes — it's the same mechanism that runs the one-shot `fob` invocations. We could spawn `node next-server.js` on app startup and point the webview at `http://127.0.0.1:<port>`.

The cost is process-supervisor engineering, not Tauri API limits:

| Concern | One-shot `fob` (today) | Long-lived Node SSR sidecar |
|---|---|---|
| Lifetime | 50–500 ms | hours |
| Port | none | needs to bind one; collisions possible |
| Startup ordering | irrelevant | webview must wait for the server to be ready |
| Cleanup on app crash | trivial (child died first) | **orphaned `node` processes leaking RAM** if Tauri exits abnormally |
| Cross-platform binary | one `fob`, user-installed | need to find/bundle Node for Mac x64, Mac arm64, Windows x64, Linux x64 |
| Bundle impact | 0 | 30–80 MB (or require Node-on-PATH and break the "downloaded binary just works" promise) |
| Restart on crash | n/a | needs a supervisor loop |

Realistic, just not free. And the payoff for control-room specifically is approximately zero (no SEO, no remote data at request time, no SSR-coupled libraries we're trying to embed). So we don't.

## Architectural implications for the React layer

Because we're static-export + single-route, the orchestrator's exact `page.jsx`-per-screen pattern (one folder per route, each with its own `page.jsx` + `ViewNoun.jsx` + `_components/`) doesn't transplant cleanly. Two adapted versions:

- **Single `page.jsx` as container, `View<Level>.jsx` for presentation.** `page.jsx` holds the `view` state (`floor` / `line` / `bin` / `workpiece`), owns data fetching via `run_fob`, and renders one of `ViewFloor` / `ViewLine` / `ViewBin` / `ViewWorkpiece` as pure-props presentation components. Each `View*` ships its own `.stories.js`. This matches the orchestrator's *presentation* convention without inventing routes that static export can't serve.
- **Tabs within a `View*`** follow the orchestrator's `<Noun>Tab.jsx` suffix pattern with local state — identical to how `ViewWorkRecord` handles its tabs in the orchestrator.

The current implementation (`src/app/page.jsx` → `MainPane.jsx` → four `*Table` / `*Detail` components) is functionally similar but doesn't follow the standard's naming or co-location. A future refactor toward the `View*` shape is worth doing for Storybook coverage and to match the standard, but it doesn't unlock new routing capabilities — it's a presentation-layer cleanup, not a routing change.

## Related references

- `docs/wip/initial-scaffold.md` — original decision log (2026-06-18) where Tauri + static export was chosen.
- `engineering-standards/naming/files-crud-pages.md` — `View<Noun>` / `Tab` / `Section` naming.
- `engineering-standards/architecture/components/container-presentational-pattern.md` — `page.jsx` as container, `View*` as presentation.
- `apps/orchestrator.assemblyline.sh/src/app/orgs/[o_id]/work-records/[wr_id]/` — concrete orchestrator example with local-state tabs.
- `CLAUDE.md` (this repo) — short version of the SSR rule, points back here for the why.
