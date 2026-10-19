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
- Bundles al-control 0.3.0's probe.

### Fixed

- Clear never deletes a bin a `lib-factory:move_files` conveyor drains, including each bin in a
  `moves` array (fob-watch only knew `lib-worker:move_files` with one `source_bin`).

### Removed

- The one-time import of fob-watch's old `config.json`.
