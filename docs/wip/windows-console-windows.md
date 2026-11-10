# Windows: no console flashes, and the parts that assume a Unix machine

## Status: IN PROGRESS (~35%)

On Windows the app flashes a console window about every 2 seconds, and Open in Terminal, the
local pm2 controls and connection sharing assume a Unix machine. This WIP hides the console of
every process the app starts, gives Windows its own terminal and local pm2 paths, turns off ssh
connection sharing there, adds a Windows compile check to CI, and releases 0.4.2.

---

## Problem Statement

Seen on `s0179` (Windows 11, 0.4.1 installed from the release `.exe`, factory
`factory-alex-win` on the local host):

- **The window flickers.** A console window opens and closes about every 2 seconds while the app
  is open. Windows gives every console program (`node`, `ssh`, `pm2`) its own console unless the
  parent passes `CREATE_NO_WINDOW`, and the app is a GUI process (`windows_subsystem =
  "windows"`), so it has none to share. No `Command` in `src-tauri/src` sets it. The probe
  (`source/probe.rs`, `run_local`) starts `node` on every refresh, so it flashes on every
  refresh.
- **Open in Terminal fails.** Every non-macOS build calls `x-terminal-emulator`, which exists only
  on Debian-family Linux.
- **Local pm2 can't run.** `pm2.rs`, `local_pm2`, runs `$SHELL -lc`, falling back to `/bin/sh`.
  Windows has neither, so `check_pm2_available` reports no pm2 and start, stop and logs fail.
- **Remote hosts fail.** `ssh_args` always adds `ControlMaster`. Windows OpenSSH has no
  connection sharing (no Unix sockets), and ssh fails with `getsockname failed: Not a socket`.
  Seen with al-control 0.4.1 on `s0179`; control-room builds the same options.
- **Finding node runs a login shell.** `probe.rs`, `login_shell_node`, runs `$SHELL -ilc`.
  Windows has no `$SHELL`, so it falls through to plain `node`, which is right there: an app
  started from the Start menu gets the user's PATH. It works, but by accident.

The CI only runs on Linux, so none of the Windows code is compiled until the release build.

## Proposed Solution

- **One way to start a process.** `src-tauri/src/process.rs`, `command(program)`: a
  `std::process::Command` that on Windows sets `CREATE_NO_WINDOW` (`0x0800_0000`) and elsewhere is
  plain `Command::new`. Every production `Command::new` goes through it. The `#[ignore]`d
  real-data tests in `failures.rs` and `housekeeping.rs` stay as they are.
- **Open in Terminal on Windows.** Local: `powershell.exe -NoExit` in the folder. Remote: `ssh -t
  …` itself. Both get `CREATE_NEW_CONSOLE` (`0x10`), a window of their own: Windows 11 opens it in
  the default terminal app. No argv quoting, no script file. The Linux build keeps
  `x-terminal-emulator`.
- **Local pm2 on Windows.** pm2's own script (`node_modules/pm2/bin/pm2` beside the `pm2.cmd`
  found on PATH) run with the probe's `node`, from `cwd`, no shell. Running node directly, not
  `pm2.cmd`, means killing a log tail kills pm2 itself, as `exec pm2` does on Unix; through
  `pm2.cmd` it would kill `cmd.exe` and leave `pm2 logs` running. Falls back to `pm2.cmd`.
- **No connection sharing on Windows.** `ssh_args` adds `ControlMaster` only on Unix. Every call
  pays a new handshake there.
- **No login-shell lookup on Windows.** `login_shell_node` returns `None` on Windows.
- **CI compiles the Windows build.** A `windows-latest` job runs `cargo check` (not `cargo test`:
  the tests use `/bin/sh` and Unix permissions).

### Key decisions

- **A constructor, not a flag at each call site.** A new spawn can't forget the flag if
  `process::command` is the way to make one.
- **`CREATE_NEW_CONSOLE` for Open in Terminal** rather than `cmd /c start` or `wt`: no quoting
  through `cmd`, and the user's default terminal app picks it up.
- **Release 0.4.2**, a patch: fixes only, nothing new for Mac users.

### Out of scope

- **The probe on Windows.** al-control's probe (`resources/probe.js`) throws `Process detection
  requires macOS or Linux` for the `factories` and `procs` queries on win32, so pm2 status, start,
  stop and logs still fail for a local Windows factory, and adding running factories on this
  computer finds none. The probe is al-control's, byte for byte: the fix goes to al-control first
  (find processes from `pm2 jlist` on win32), then a pin bump here.
- **A Windows machine as a remote host.** The remote commands are POSIX (`PATH=… node`, `exec
  "${SHELL:-/bin/sh}" -lc`), and Windows' ssh shell is PowerShell or cmd. Needs al-control and the
  probe first.
- **al-control's own `sshArgs`** has the same `ControlMaster` problem on a Windows client.
- **Signing the Windows installer**, so SmartScreen stops warning.

## Implementation Phases

### Phase 1: No console windows 🔄

- [x] `src-tauri/src/process.rs`: `command(program)`, `CREATE_NO_WINDOW` on Windows; `mod
      process;` in `lib.rs`
- [x] `source/probe.rs`: `run_local` and `login_shell_node` through `process::command`
- [x] `source/ssh.rs`: `run` through `process::command`
- [x] `pm2.rs`: `local_pm2` and the remote log tail through `process::command`
- [x] `.github/workflows/ci.yml`: `windows-check` job, `cargo check` on `windows-latest`
- [x] `cargo test` passes on the Mac (45 passed, 12 ignored, no warnings)
- [ ] The Windows check passes in CI (runs on the push in Phase 4)

### Phase 2: Terminal, pm2, ssh and node on Windows ❌

- [ ] `host_commands.rs`: `spawn_terminal_at` / `spawn_terminal_running` for Windows with
      `CREATE_NEW_CONSOLE`; the `x-terminal-emulator` pair becomes Unix-only (not macOS)
- [ ] `pm2.rs`: `local_pm2` for Windows: `node <pm2 script>`, `current_dir`, fallback `pm2.cmd`
- [ ] `source/ssh.rs`: `ssh_args` shares connections only on Unix; comment says why
- [ ] `source/probe.rs`: `login_shell_node` returns `None` on Windows
- [ ] CI passes on both

### Phase 3: Docs ❌

- [ ] `CHANGELOG.md`: `[Unreleased]`, `### Fixed`
- [ ] `README.md`: what works on Windows and what doesn't yet
- [ ] `CLAUDE.md`: start processes through `process::command`

### Phase 4: Release 0.4.2 and install on s0179 ❌

- [ ] Bump `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
      `src-tauri/tauri.conf.json`; date the CHANGELOG section; `chore: release 0.4.2`
- [ ] Push `main` and tag `v0.4.2`; the Release workflow builds the draft
- [ ] Publish the draft release
- [ ] Install the `.exe` on `s0179`: the hash matches the release digest
- [ ] Verify on `s0179`: no flicker with the app open; the EX line shows; Open in Terminal opens
      PowerShell in `factory-alex-win`
- [ ] Delete this WIP

## Known Limitations

- **No connection sharing on Windows.** Each remote call opens a new ssh connection: slower, and
  Tailscale SSH's check mode may ask more often.
- **An ssh terminal window closes when ssh exits,** so an error it printed goes with it.
- **pm2 for a local Windows factory** still fails until the probe supports win32 (Out of scope).

## Related Files

- `src-tauri/src/process.rs` - new: `command()`, the one way to start a process
- `src-tauri/src/source/probe.rs` - `run_local`, `local_node`, `login_shell_node`
- `src-tauri/src/source/ssh.rs` - `ssh_args`, `run`
- `src-tauri/src/pm2.rs` - `local_pm2`, `start_log_tail`
- `src-tauri/src/host_commands.rs` - `spawn_terminal_at`, `spawn_terminal_running`
- `src-tauri/src/terminal.rs` - integrated terminal (portable-pty; ConPTY on Windows, no change)
- `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- `~/ec2code/assemblyline/cli/al-control/src/probe.js` - `listRunningFactories`, win32 throws
- `~/ec2code/assemblyline/cli/al-control/src/transport.js` - `sshArgs`, same `ControlMaster`
