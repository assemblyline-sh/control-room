# Fork fob-watch into control-room

## Status: IN PROGRESS (~95%)

control-room is the desktop window onto Assembly Line factory floors, forked from fob-watch
0.6.0 with a fresh history. It reads al-control's config, runs al-control's probe for every
host (this machine too) instead of a Rust port of it, and only renders. This WIP covers the
fork, the switch to the probe (al-control decision 0006), and the safety gaps fob-watch had
against fob-factory.

---

## Problem Statement

fob-watch reads FinOpsBricks workers: `~/.fob/fob-factory/config.yml`, `@fob/lib-worker`,
`.orchestrator/worker.json`. Pointed at an Assembly Line factory, its clear guard knows only
`lib-worker:move_files`, so it could delete a terminal output that another line still drains.
It also carries a Rust copy of the floor reads (`source/local.rs`) and of the line model
(`monitor.rs`), and those copies drift from the JS ones. It sends a factory's whole `.env`,
secrets included, to the webview to build orchestrator links. And its pm2 start and stop have
none of fob-factory's guards.

## Proposed Solution

- **Fresh history.** fob-watch's history names customer workers and hosts. Its history stays in
  `finopsbricks/fob-watch`; the NOTICE credits it.
- **Names:** repo and package `control-room`, product name "Control Room", bundle id
  `sh.assemblyline.controlroom` (a new id, so localStorage and the app-config dir start empty).
  Factory vocabulary throughout: never "worker".
- **Config:** `~/.assemblyline/al-control/config.yml`, the same file as al-control (hosts →
  `factories`, each a path or `{path, keep}`), and its SSH socket dir, so the app and a
  terminal share one connection per host. The legacy `config.json` import goes.
- **The probe for every host** (decision 0006). `src-tauri/resources/probe.js` is a byte copy
  of `@assemblyline/al-control/probe` at the version pinned in `package.json`; CI fails when they
  differ. This machine runs it with a local `node` (the host's `node:` if set, else the login
  shell's). `source/local.rs` and the line model in `monitor.rs` go; the `lines` query feeds the
  line views.
- **No `.env` read.** Orchestrator links come from `.orchestrator/factory.json`
  (`orchestrator_url`, `org`), which every factory commits and the probe already returns. This
  replaces "read only two keys from `.env`" in the CLI architecture WIP.
- **Conveyor guard** in the clear planner: `lib-factory:move_files`, its `source_bin` and its
  `moves` array, as al-control 0.3.0.
- **pm2 parity with al-control:** refuse start when the factory already runs (under pm2 or
  directly), refuse stop when it isn't under pm2; add restart.
- The error key and clear planner stay in Rust for now (decision 0006 says they can move to the
  probe later), with test vectors against al-control.

## Implementation Phases

### Phase 1: Fork, rename, config ✅
- [x] Copy fob-watch 0.6.0's tracked files; fresh history; Apache-2.0 LICENSE and NOTICE
- [x] Scrub customer and host names (README, comments, ignored tests read a host and factory
      from env vars instead)
- [x] Drop fob-watch's design WIPs (its history keeps them); keep `docs/architecture/`
- [x] Names: package, Cargo crate, product, window title, bundle id, release workflow
- [x] Factory vocabulary in Rust, JS, file and folder names, IPC command names
- [x] Config: al-control's path, `factories:`, socket dir; drop the legacy import
- [x] Vendor al-control 0.3.0's `probe.js` (queries `factories`, `factory.json`,
      `@assemblyline/lib-factory` detection); update the Rust types (`factory`, not `worker`)
- [x] Clear planner: `lib-factory:move_files` and `moves` arrays, with tests
- [x] `cargo test` (39, plus probe, error-key and clear-plan parity on real factories), typecheck, lint pass
- [x] Public repo `assemblyline-sh/control-room`, pushed

### Phase 2: The probe for every host ✅
- [x] One probe-backed `Source` for every host (`source/probe.rs`): this machine's `node` (the
      local host's `node:`, else the login shell's), with its dir first on PATH for pm2; several
      queries share one run (`probe_all`), so `state` + `lines` is one node start or one round
      trip. `source/local.rs` deleted
- [x] Line views from `lines` + `defs`; failures, clear and positions from `state` joined with
      `lines` (`monitor::join_lines`). `topo_sort_stations`, `compute_terminal`, `build_lines`,
      `summarize_line` deleted
- [x] Orchestrator links from `factory.json` (`factory_orchestrator`); `read_worker_env` deleted
- [x] Rail `counts` poll on this machine: ~45 ms per tick through node (alex-linux-pc ~150–240
      ms over SSH, unchanged). Clear plans on every factory and 328 error keys unchanged
- [x] `scripts/check-probe.mjs` (`npm run check:probe`, pinned `@assemblyline/al-control`
      0.3.0) and `.github/workflows/ci.yml`: byte check, typecheck, lint, `cargo test`

### Phase 3: pm2 parity ✅
- [x] Status, start, stop and restart from one probe `factories` query (`Target::inspect`), as
      al-control's `procs`: start refuses a running factory (pm2 or direct); stop and restart
      refuse one that isn't under pm2. Status "online" / "direct" / "stopped" matches
      `al-control procs list` on both machines
- [x] Restart in the factory view; "Running directly" instead of a Start button that would
      fail; refusals shown in a dialog, Start All / Stop All only act on stopped / online rows
- [x] Local pm2 is the one next to the probe's node, with that dir on PATH (Finder-launched app)
- [x] Unit tests for both guards (32 Rust tests)

### Phase 4: Ship 🔄
- [x] README, CLAUDE.md, CHANGELOG (Unreleased, to become 0.1.0)
- [x] `npm run tauri:build` (`Control Room.app`, `.dmg` aarch64); installed in /Applications.
      Opened from the Finder it finds node and polls the rail (a `node` child every 2 s)
- [x] Browser render on real fixtures (`scripts/browser-mock.js`): rail, factory view with Stop
      and Restart, line summaries from the probe, factories overview "online (pm2)"
- [ ] Alex in the native window: every view on this machine and alex-linux-pc, a restart, a
      log.jsonl work-record link
- [x] Public repo `assemblyline-sh/control-room`; v0.1.0 tagged; CI and the release workflow
      pass (macOS universal, Windows). Release is a draft until published
- [x] `assemblyline.sh/docs/wip/cli-architecture.md` Phase 6 and the workspace CLAUDE.md

## Related Files

- `src-tauri/src/source/` - where a factory's data comes from: the probe, on every host
- `src-tauri/src/monitor.rs` - joins the probe's line model with bins; display helpers
- `src-tauri/src/housekeeping.rs` - clear planner and conveyor guard
- `src-tauri/src/pm2.rs` - start, stop, status, log tail
- `src-tauri/src/central_config.rs` - the shared config file
- `src-tauri/resources/probe.js` - vendored from al-control
- `~/ec2code/assemblyline/cli/al-control/docs/decisions/0006-the-probe-computes-the-line-model.md`
