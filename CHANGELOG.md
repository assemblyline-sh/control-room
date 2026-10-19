# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Forked from fob-watch 0.6.0 (FinOpsBricks) with a fresh history. Its changelog and design log
stay in that repo.

### Changed

- Renamed to Control Room (`control-room`, bundle id `sh.assemblyline.controlroom`). A new bundle
  id means a new app-config dir and empty localStorage: the last-used host and open tabs start
  fresh.
- Reads Assembly Line factories: al-control's config, `~/.assemblyline/al-control/config.yml`
  (hosts → `factories`), its SSH socket dir, `.orchestrator/factory.json`, and detects
  `@assemblyline/lib-factory`. Factory vocabulary throughout.
- Runs al-control's probe for every host, this machine included (al-control decision 0006):
  local reads no longer go through a Rust port. Line order, terminal stations and line
  summaries come from the probe's `lines` query. On this machine the probe runs with the local
  host's `node:` or the login shell's `node`, so the app finds node and pm2 when opened from the
  Finder too.
- Bundles al-control 0.3.0's probe; `npm run check:probe` and CI fail if the copy differs.
- Work-record links in a `log.jsonl` come from `.orchestrator/factory.json`, and a `local-` run
  is not linked.

### Added

- Restart for a factory under pm2.

### Fixed

- Start refuses a factory that already runs, under pm2 or directly, and stop refuses one that
  isn't under pm2, as al-control's `procs` do (fob-watch had no guards). Status comes from the
  probe, so a factory started outside pm2 shows as "running directly" instead of "not started".
  Start All and Stop All report what was refused.

- Clear never deletes a bin a `lib-factory:move_files` conveyor drains, including each bin in a
  `moves` array (fob-watch only knew `lib-worker:move_files` with one `source_bin`).

### Removed

- The one-time import of fob-watch's old `config.json`.
- `read_worker_env`: the app no longer reads a factory's `.env`, which sent its secrets to the
  webview.
- `source/local.rs` and the Rust line model (`topo_sort_stations`, `compute_terminal`,
  `build_lines`, `summarize_line`).
