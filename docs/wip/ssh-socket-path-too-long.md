# SSH socket path too long on macOS

## Status: NOT STARTED

Connecting to a remote host fails on a Mac with a long home path, because the SSH socket path
goes over the macOS limit. This WIP replaces ssh's 40-character `%C` hash in the socket name
with a 12-character hash computed by the app, in both control-room and al-control, and fixes
the length check that let the path through.

---

## Problem Statement

Adding `alex-linux-pc` as a host from a Mac fails on Test:

```
ssh to alex-linux-pc (alex-linux-pc) failed: unix_listener: path
"/Users/alex.vazhatharayil/.assemblyline/al-control/ssh-1dd49b6615c65871b00955f2ef67cc33f4dd99fa.s…"
too long for Unix domain socket
```

The failure is on the Mac. The remote host and the factory path are not involved.

**What the socket is.** The first call to a host opens a connection and leaves it running for
10 minutes (`ControlMaster` + `ControlPersist`). Later calls find the socket file and reuse the
connection: about 0.2s instead of 1s, and no repeat Tailscale check. The name only has to be
the same on every call. See al-control's `docs/architecture/ssh-connection-sharing.md`.

**Why it fails.**

- macOS allows 103 usable characters in a socket path (104 bytes with the terminating null).
- The path is 95 characters: 25 for the home path, 30 for
  `/.assemblyline/al-control/ssh-`, 40 for the hash.
- While opening the shared connection, ssh binds a temporary socket named
  `<path>.XXXXXXXXXXXXXXXX`, then renames it. That adds 17 characters, so the real length is 112.
- The check, `control_path.len() - 2 + 40 < 104`, doesn't count those 17, so it passes and
  ssh fails instead of the app skipping connection sharing.

The 17-character suffix comes from knowledge of OpenSSH's behaviour. The `.s…` after the hash in
the error fits it. It hasn't been reproduced on a Mac yet (Phase 4).

al-control has the same code, so the CLI should fail the same way on this Mac.

## Proposed Solution

Name the socket `ssh-<12 hex chars>`, where the 12 characters are the start of the SHA-256 of
the host's `ssh` value from the config, as written. Count the 17 extra characters in the check.

```
Now:    /Users/alex.vazhatharayil/.assemblyline/al-control/ssh-1dd49b6615c65871b00955f2ef67cc33f4dd99fa
After:  /Users/alex.vazhatharayil/.assemblyline/al-control/ssh-f7e2fc173405
```

The new path is 67 characters, 84 with the suffix. Sharing now works for any home path up to 44
characters; beyond that the app skips sharing, slower but no error.

### Key decisions

- **App-computed hash, not `%C`.** ssh always expands `%C` to 40 characters and can't shorten
  it, and the app never sees the value.
- **Derived from the alias, not random.** Every call must arrive at the same name to find the
  open connection.
- **SHA-256, first 12 hex characters.** 48 bits. With a handful of hosts, collisions can be
  ignored.
- **Hash the whole `ssh` value.** `bob@box` and `carol@box` get different sockets, so two users
  on one host never share a connection.
- **Keep the `al-control/` folder and the `ssh-` prefix.** The location convention stays.

### Options rejected

- **`ssh-%r@%n` (remote user and alias).** Works, and `ssh -G` expands it correctly, but the
  length varies and the app can't always know the remote user, so the check couldn't be exact.
- **Moving sockets up to `~/.assemblyline/ssh-…`.** Breaks the per-tool folder convention.
- **Renaming `~/.assemblyline` to `~/.al`.** Not needed for this bug, and that folder holds
  al-control's config and al-orc's credentials on every machine, so it would need a migration in
  three tools. Can be decided separately.
- **Only fixing the check.** Stops the error but turns sharing off on this Mac, so every call
  pays a new handshake and possibly a Tailscale check.

## Implementation Phases

### Phase 1: al-control ❌

al-control goes first, as with the probe. Reference implementation for control-room.

- [ ] `src/transport.js`, `sshArgs()`: build the name with `createHash('sha256')` from
      `node:crypto` over `host.ssh`, `.slice(0, 12)`
- [ ] Same function: `multiplex = control_path.length + 17 < 104`, and update the comment to
      explain the 17 (ssh's temporary socket suffix)
- [ ] `tests/transport.test.js`: alias `prod-box` gives `ssh-61399a89f694`
- [ ] `tests/transport.test.js`: `bob@prod-box` and `carol@prod-box` give different sockets
- [ ] `tests/transport.test.js`: a home path just over the limit skips `ControlMaster`
      (set `HOME` to a long path under a temp dir, restore it after)
- [ ] `docs/architecture/ssh-connection-sharing.md`: new name, the 17-character suffix in
      "Socket location", and the **Close it** command, which can no longer use `%C`:
      ```bash
      ssh -O exit -o ControlPath=$HOME/.assemblyline/al-control/ssh-$(printf %s <alias> | shasum -a 256 | cut -c1-12) <alias>
      ```
- [ ] `CHANGELOG.md`: entry under `[Unreleased]`, `### Fixed`
- [ ] `npm test` passes

### Phase 2: control-room ❌

- [ ] `src-tauri/Cargo.toml`: add `sha2 = "0.10"`. It's already in `Cargo.lock` at 0.10.9 through
      another crate, so nothing new is downloaded or compiled
- [ ] `src-tauri/src/source/ssh.rs`, `ssh_args()`: the same hash and the same check, written the
      same way as `sshArgs()`
- [ ] `src-tauri/src/source/ssh.rs`: update the header comment (line 5) and the doc comment on
      `ssh_args`
- [ ] `src-tauri/src/source/ssh.rs` test: alias `prod-box` gives `ssh-61399a89f694`, the same
      expected value as al-control. This is what keeps the two in step
- [ ] `README.md` line 45: new socket name
- [ ] `CHANGELOG.md`: entry under `[Unreleased]`
- [ ] `cargo test`, `npm run typecheck` and `npm run lint` pass

The probe doesn't change, so there's no pin bump and no `check:probe` update: `sshArgs()` is in
`transport.js`, not `probe.js`.

### Phase 3: Workspace docs ❌

- [ ] `apps/assemblyline.sh/docs/wip/cli-architecture.md` line 305: new socket name

`apps/assemblyline.sh/docs/wip/worker-migrations.md` line 60 stays: it's about the old
`~/.fob/fob-factory` path.

### Phase 4: Verify on the Mac ❌

Needs the Mac: this Linux machine allows 107 usable characters and has a shorter home path, so
it can't show the failure.

- [ ] Reproduce first, on the current build: Test on `alex-linux-pc` shows the error
- [ ] Build control-room with the fix and repeat: Test succeeds
- [ ] Factories on `alex-linux-pc` load, and the terminal and pm2 logs work
- [ ] `ls ~/.assemblyline/al-control/` shows one `ssh-<12 chars>` socket
- [ ] Run an al-control command on that host while the app is open: `ps` still shows a single
      `[mux]` process, so the app and the CLI share the connection

### Phase 5: Release ❌

Needs a go-ahead before each step.

- [ ] Commit each repo
- [ ] Release al-control 0.3.2 (`code:release`)
- [ ] Release control-room 0.2.1 (`code:release`)
- [ ] Delete this WIP

## Known Limitations

Noted, not solved, per `principles/solve-problems-you-have-seen.md`.

- **Mixed versions.** An old CLI and a new app use different names, so each opens its own
  connection until both are updated. Both still work.
- **Old sockets.** Existing `ssh-<40 chars>` sockets are left in place. Their connections close
  after 10 minutes unused. No migration.
- **Two aliases for one machine.** They now get separate connections. `%C` hashed the resolved
  host, so it could share them.
- **Editing `~/.ssh/config`.** If an alias's `HostName` or `User` changes while a connection is
  open, calls keep using the old one until it closes. `%C` would have changed with the config.
  Close it with `ssh -O exit`.
- **Very long home paths.** Over 44 characters, sharing is skipped.

## Standards Read

- `principles/solve-problems-you-have-seen.md`
- `git-workflow/wip-files.md`
- `cli/README.md`, `cli/config-and-secrets.md`

## Related Files

- `src-tauri/src/source/ssh.rs` - `ssh_args()`, control-room's socket path and check
- `src-tauri/Cargo.toml` - adds `sha2`
- `README.md` - mentions the socket name
- `~/ec2code/assemblyline/cli/al-control/src/transport.js` - `sshArgs()`, the CLI's copy
- `~/ec2code/assemblyline/cli/al-control/tests/transport.test.js` - `sshArgs` tests
- `~/ec2code/assemblyline/cli/al-control/docs/architecture/ssh-connection-sharing.md` - the
  note on sharing, socket location and closing a connection
