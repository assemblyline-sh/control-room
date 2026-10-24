# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-10-24

### Added

- Pick which bin counts the rail's factory, line and station rows show: the menu next to
  FACTORIES has a checkbox per bin (input, doing, failed, output, done; always in that order).
  The default is now input/failed/output, in place of done/failed/output. The choice is kept and
  shared by every window. `doing` counts are amber.
- `install.sh`: install or update the macOS app with one `curl` command. A `curl` download isn't
  quarantined, so it opens without the "Not Opened" dialog until the build is notarized.

### Fixed

- A factory started or restarted from the app gets the PATH of a normal shell session: pm2
  runs in the user's login shell, on this machine and over SSH, so `~/.local/bin` (claude),
  Homebrew and the like are there. Before, an app opened from the Finder, or a remote host's
  non-login SSH shell, gave the factory a bare PATH, and a step calling `claude` failed with
  ENOENT. Same change as al-control 0.3.1.
- Restart passes `--update-env`, so it picks up the current environment.
- Start and restart run `pm2 save`, so the host brings the factory back after a reboot.

### Changed

- README: the install script, and clearing the quarantine flag as the temporary fix for a
  browser download.

## [0.1.0] - 2026-10-19

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
