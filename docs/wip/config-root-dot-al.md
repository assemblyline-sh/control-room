# Config root moves from ~/.assemblyline to ~/.al

## Status: IN PROGRESS (~90%)

Every al-<tool> keeps its config under `~/.al/<tool>/` instead of `~/.assemblyline/<tool>/`, in
al-control, al-orc and control-room. The first run of an updated tool moves the existing folder,
so nobody loses a config or a login. Alex chose `.al` on 2026-11-05.

Some of this was written before this WIP existed. It sits uncommitted in the four repos, and
Alex has said to keep it. The phases below finish, test and commit it.

---

## Problem Statement

`~/.assemblyline` is long to type and read, and its length breaks SSH on a Mac. Adding
`alex-linux-pc` as a host from a Mac whose home is `/Users/alex.vazhatharayil` fails with `too long
for Unix domain socket`.

ssh binds a temporary socket, `<ControlPath>.XXXXXXXXXXXXXXXX`, and macOS allows 103 characters.
On that Mac the length is:

| Root | Length with suffix | Fits |
|---|---|---|
| `.assemblyline` | 112 | No |
| `.aline` | 105 | No |
| `.line` | 104 | No |
| `.al` | 102 | Yes |

The folder holds al-control's config, al-orc's credentials and the SSH sockets. Changing the path
alone would make every install look unconfigured, and al-orc look logged out.

## Proposed Solution

One function per tool returns the root and does the move:

- `~/.al` missing and `~/.assemblyline` present: rename the folder, then leave a
  `~/.assemblyline → .al` symlink.
- `~/.al` present: nothing moves.
- Neither present: nothing moves; `~/.al` is created on first write, as before.

| Tool | Function | Used by |
|---|---|---|
| al-control | `familyRoot()` in `src/config.js` | `configDir()`, `sshArgs()` |
| al-orc | `familyRoot()` in `src/cli/config-store.js` | `CONFIG_DIR` |
| control-room | `family_root()` in `central_config.rs` | `config_path()`, `ssh_args()` |

### Key decisions

- **`.al`, not `.aline` or `.line`.** Alex's choice. It matches `al-<tool>` and `AL_*`, and it is
  the only option that fits the socket limit today. Recorded in al-control decision 0007.
- **Automatic move, not a manual `mv`.** The earlier move to `~/.assemblyline` was a manual
  breaking change. This one would look like a lost login, and this change causes that, so it is
  handled here.
- **One rename for the whole folder.** The first updated tool moves it for all three.
- **Symlink left behind.** The tools update separately. al-control 0.3.1 next to a new control-room
  must still find its config.
- **`AL_CONTROL_CONFIG_DIR` and `AL_ORC_CONFIG_DIR` are unchanged.** al-orc skips the move when
  its override is set. al-control's `sshArgs()` still runs it, because sockets always live under
  the home folder.
- **`familyRoot(home = homedir())`.** Under jest `os.homedir()` ignores a changed `process.env.HOME`,
  so tests pass a temp folder. Rust does the same with `family_root_in(home)`.
- **Move written three times.** The tools share no package. It is a few lines, and goes away when
  every machine has moved.
- **The probe is not involved.** It reads no config, so no pin bump and no probe copy.

### Not changing

- `CHANGELOG.md` history, finished WIPs and other WIP records keep the old path.
- `engineering-standards/cli/` still describes `~/.fob`, the FinOpsBricks root.

### Known limitations

- `.al` leaves one character to spare on that Mac; a home path two characters longer still fails.
  `ssh-socket-path-too-long.md` fixes that properly and is still needed.
- A `~/.al` made by another program stops the move, and the tools then find no config. Not seen.
- Running the test suites with a real `HOME` does the real move, the same as a first run. al-control's
  `sshArgs()` tests call `familyRoot()`, and importing al-orc's config store does too.
- Don't run al-control's probe tests with an empty temp `HOME`: `pm2 jlist` starts a new daemon
  there and hangs. Set `PM2_HOME` to the real one.

## Implementation Phases

Phases 2 to 5 are one commit each, in their own repo. Stage named files only: `install.sh` and
`image.png` here, `bin/al-control.js` in al-control and the two scripts in skills are not part of this
work. Nothing is pushed or released as part of these phases.

### Phase 1: WIP ✅
- [x] This file
- [x] Commit: `docs: add WIP for config-root-dot-al`

### Phase 2: al-control ✅
- [x] `familyRoot()`; `configDir()` and `sshArgs()` use it
- [x] `README.md`, `docs/architecture/` paths, `CHANGELOG.md` under `[Unreleased]`
- [x] Decision `0007-config-root-is-dot-al.md`
- [x] `familyRoot(home = homedir())`; tests pass a temp folder
- [x] Decision 0007 notes that a shorter socket name would lift the length limit on the name
- [x] `tests/config.test.js`: moved with symlink; existing `~/.al` left alone; fresh machine moves nothing
- [x] All suites pass, in a scratch copy (no `node_modules` in the repo here)
- [x] Commit: `feat(config): the config root is ~/.al; move ~/.assemblyline on first run`

### Phase 3: al-orc ✅
- [x] `familyRoot()`; `CONFIG_DIR` uses it
- [x] `README.md`, `SECURITY.md`, `.env.example`, comments, `CHANGELOG.md`
- [x] `familyRoot(home = homedir())`
- [x] `tests/cli/config-store.test.js`: same three cases as al-control
- [x] All suites pass, with a temp `HOME`
- [x] Commit: `feat(config): the config root is ~/.al; move ~/.assemblyline on first run`

### Phase 4: control-room ✅
- [x] `family_root()`; `config_path()` and `ssh_args()` use it
- [x] Two Rust tests for the move
- [x] `README.md`, `CLAUDE.md`, UI path strings, comments, `CHANGELOG.md`
- [x] `ssh-socket-path-too-long.md`: the rejected-rename bullet
- [x] `grep` finds no live `~/.assemblyline` reference outside changelogs and WIPs
- [x] Commit: `feat(config): the config root is ~/.al; move ~/.assemblyline on first run`

`cargo` and `node_modules` aren't on alex-linux-pc, so Rust and the typecheck run in Phase 6.

### Phase 5: skills ✅
- [x] `migrate-worker-to-factory/cutover.md` and `name-map.md`
- [x] Commit: `docs(migrate-worker-to-factory): al-orc config is under ~/.al`

### Phase 6: Check on the Mac ❌

Needs Alex's Mac. Nothing here is checked until it has been run.

- [ ] `cargo test` in `src-tauri` and `npm run typecheck`
- [ ] Open control-room: `~/.al/al-control/config.yml` exists, `~/.assemblyline` is a symlink, the
      hosts still show
- [ ] `al-orc status` still shows the logged-in profile
- [ ] Add `alex-linux-pc` as a host: Test passes with no socket error
- [ ] Delete this WIP: `docs: remove completed WIP config-root-dot-al`

## Related Files

- `cli/al-control/src/config.js`, `src/transport.js` - root, config path, socket folder
- `cli/al-control/docs/decisions/0007-config-root-is-dot-al.md` - the decision
- `cli/al-orc/src/cli/config-store.js` - root and credentials path
- `src-tauri/src/central_config.rs`, `src-tauri/src/source/ssh.rs` - control-room's copy
- `docs/wip/ssh-socket-path-too-long.md` - the socket fix, in the same lines; lands after this
