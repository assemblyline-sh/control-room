# Control Room

A desktop window onto [Assembly Line](https://assemblyline.sh) factory floors, on this machine and
on machines you reach over SSH. Browse lines, stations, bins and workpieces; see why workpieces
failed, grouped by error; retry them; clear finished work; start and stop factory sessions; open
a terminal in any factory or workpiece folder.

The desktop companion to the [al-control](https://github.com/assemblyline-sh/al-control) CLI. Both
read the same config and run the same probe, so they always agree on what is in a bin and what
is safe to delete.

**Beta.** macOS, Windows and Linux builds; the macOS build is unsigned (see Install).
[Docs](https://assemblyline.sh/docs) · [About](https://assemblyline.sh) · [Changelog](CHANGELOG.md)

## What it shows

- **Rail:** one host per window. Factories → lines → stations → bins → workpieces → files, with
  done, failed and output counts on every row, refreshed every 2 seconds.
- **Failures:** every failed workpiece on the host, grouped by error (the same grouping as
  `al-control workpieces errors`), including failed folders with no `pointer.json`.
- **Housekeeping:** clear done and finished workpieces by host, factory, line, bin or workpiece.
  Every clear is a dry run first, and it only ever deletes from `done` bins and a line's terminal
  `output`, never a bin the factory keeps or a bin a conveyor (`lib-factory:move_files`) drains.
- **Retry:** drag a failed or done workpiece back to its station's `input`.
- **Factory sessions:** pm2 start, stop and a live log tail.
- **Terminal:** a shell in a factory or workpiece folder, local or over `ssh`.

## How it works

```
             ~/.assemblyline/al-control/config.yml
             hosts → factories → paths   (shared with al-control)
                              │
                 Control Room (Tauri: Rust + Next.js)
                ┌─────────────┴──────────────┐
          host: local                  host: <ssh alias>
      reads the factory folders     ssh → node - (al-control's probe on stdin)
      pm2 directly                  ssh → pm2
                                    host needs node + pm2, nothing else
```

The probe is al-control's `src/probe.js`, bundled byte for byte. Remote calls share
al-control's SSH connection (`~/.assemblyline/al-control/ssh-%C`), so whichever signs in first,
the other rides along.

## Install

Download the build for your platform from
[Releases](https://github.com/assemblyline-sh/control-room/releases).

The macOS `.dmg` is unsigned, so Gatekeeper blocks the first launch. Clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine "/Applications/Control Room.app"
```

## Config

`~/.assemblyline/al-control/config.yml`, the same file as al-control:

```yaml
hosts:
  local:
    factories:
      factory-acme: ~/factories/factory-acme
  build-box:
    ssh: build-box            # alias from ~/.ssh/config
    node: /home/me/.nvm/versions/node/v22.21.0/bin/node   # if node/pm2 come from nvm
    factories:
      factory-globex:
        path: ~/factories/factory-globex
        keep: [VM5/done]      # bins a clear must never touch
```

With no factories anywhere, the app opens on a page to add local factory folders. Hosts and
remote factories can be added from the rail. The app never writes `current_host`: the host is
per window, so nothing in the app can retarget the CLI.

## Develop

Node.js 20+, a Rust toolchain and the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri:dev     # Next.js dev server and the native window
npm run tauri:build   # installers in src-tauri/target/release/bundle/
npm run typecheck
npm run lint
cd src-tauri && cargo test
```

See [CLAUDE.md](CLAUDE.md) for the architecture and the rules every change follows.

## Licence

Apache-2.0. Forked from fob-watch (FinOpsBricks); see [NOTICE](NOTICE).
