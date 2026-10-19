# Fork fob-watch into control-room

## Status: IN PROGRESS (~30%)

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

### Phase 1: Fork, rename, config 🔄
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
- [ ] Public repo
      `assemblyline-sh/control-room`, pushed

### Phase 2: The probe for every host ❌
- [ ] `Source::Local` runs the probe with this machine's `node`; delete `source/local.rs`
- [ ] Line views from the `lines` query; drop `topo_sort_stations`, `compute_terminal`,
      `build_lines`, `summarize_line` from `monitor.rs`
- [ ] Orchestrator links from `factory.json`; delete `read_worker_env`
- [ ] Measure the rail's 2-second `counts` poll on this machine (it now spawns `node`)
- [ ] `scripts/check-probe.js` and a CI workflow: byte check, `cargo test`, typecheck, lint

### Phase 3: pm2 parity ❌
- [ ] Start refuses when the factory already runs (pm2 or direct); stop refuses when it isn't
      under pm2 (from the probe's `procs`)
- [ ] Restart
- [ ] Tests for both guards

### Phase 4: Ship ❌
- [ ] README, CLAUDE.md, CHANGELOG 0.1.0
- [ ] `npm run tauri:build`; install on this Mac; check every view against this machine and
      a remote host
- [ ] Tag v0.1.0
- [ ] Update `assemblyline.sh/docs/wip/cli-architecture.md` Phase 6 and the workspace CLAUDE.md

## Related Files

- `src-tauri/src/source/` - where a factory's data comes from (local disk now, probe later)
- `src-tauri/src/monitor.rs` - line model (to go) and display helpers
- `src-tauri/src/housekeeping.rs` - clear planner and conveyor guard
- `src-tauri/src/pm2.rs` - start, stop, status, log tail
- `src-tauri/src/central_config.rs` - the shared config file
- `src-tauri/resources/probe.js` - vendored from al-control
- `~/ec2code/assemblyline/cli/al-control/docs/decisions/0006-the-probe-computes-the-line-model.md`
