# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.2] - 2026-11-11

### Fixed

- Windows: no more console window flashing every couple of seconds. Every `node`, `ssh` and pm2
  the app starts now runs without a window.
- Windows: Open in Terminal opens PowerShell at the folder, or an ssh session for a remote host,
  instead of failing on `x-terminal-emulator`.
- Windows: local pm2 runs without a Unix shell.
- Windows: remote hosts connect. ssh connection sharing, which Windows' OpenSSH doesn't support,
  is off there.

## [0.4.1] - 2026-11-06

### Added

- The app's version, at the bottom of the sidebar.

## [0.4.0] - 2026-11-06

### Added

- A guided first run, one question per screen: where your factories run, which computer, then which
  factories. Someone whose factories are all on another computer can now get started; before, the
  first screen only took local folders.
- Control Room finds `node` and pm2 on a remote computer, so there's no path to type. It picks the
  `node` with pm2 beside it and only asks when there's a real choice. `node:` is saved only when
  plain ssh wouldn't find it.
- Computers are offered from your ssh config, and running factories are listed and ticked.
- A pointer to the quickstart for anyone without a factory yet.

### Changed

- Adding a computer or a factory from the sidebar opens the same screens, over the app, so open
  tabs and terminals stay as they were. The small sidebar forms are gone, including the host's
  separate display name: a host is named after its ssh name.
- Remove moved to the factory's right-click menu, and works for remote factories too.
- A computer without pm2 can be added, with a warning: you can view its factories but not start or
  stop them.
- Local folders are checked to be factories before they're added.

### Fixed

- Connection failures say what happened and what to do, with the original error under Details.
- A Tailscale sign-in while connecting to a new computer now shows its prompt.

## [0.3.1] - 2026-11-05

### Changed

- The move from `~/.assemblyline` to `~/.al` no longer leaves a symlink at the old path. Update
  al-control, al-orc and control-room together.

## [0.3.0] - 2026-11-05

### Changed

- The config root is `~/.al`, not `~/.assemblyline`, same as al-control. The first run moves the
  folder and leaves a `~/.assemblyline` symlink for tools not yet updated.

### Fixed

- Adding a remote host no longer fails with "too long for Unix domain socket" on a long home path.
  Sockets are named by a 12-character hash of the host's alias instead of ssh's 40-character `%C`,
  and the length check counts the 17 characters ssh adds to its temporary socket. Sharing now works
  for home paths up to 54 characters and is skipped beyond that.

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
