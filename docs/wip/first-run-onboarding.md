# First-run onboarding

## Status: IN PROGRESS (~25%)

Take someone who has just installed Control Room to a working factory view without a moment of
"what is this?" or "what do I do now?". This WIP replaces the local-only welcome page and the two
small rail forms with one guided flow: one question per screen, a smart default on each, a real
choice where there is one, and a next step on every screen, including when something fails.

---

## The bar

Written from Alex's brief (2026-11-05). Every screen is judged against these:

1. **Don't make me think.** Extra clicks are fine. A moment of "what is this?" is not.
2. **One question per screen,** in the user's words, saying why it's being asked.
3. **Smart defaults.** If the app can find the answer, it finds it and shows what it found.
4. **Choice stays.** A default can always be changed, and there is always a way to type your own.
5. **Never a dead end.** Every failure says what happened and what to do next, and offers a retry.
6. **No jargon before it's explained.** No `~/.ssh/config`, `node:` or `local` as the first thing
   a newcomer reads.

## Problem Statement

What a newcomer meets today, from reading the code and from adding `alex-linux-pc` on `ae-lp-3643`
this week.

### Dead ends

- **Factories only on another machine: stuck on the first screen.** `src/app/page.jsx` sends
  anyone with no factories to `/onboarding`. That page only adds local folders, and Done stays
  disabled until one exists. Add Host lives in the rail, inside the shell, which that page never
  reaches. Alex's own setup on `ae-lp-3643` is this case; it got past because the config was
  already there.
- **No factory yet: no way forward.** The page has no link to how to make one.
- **A host with no pm2 can't be saved.** Save needs a passing Test, and Test fails when pm2 is
  missing. The hint then says to set `node`, which doesn't help if pm2 isn't installed. Factories
  started outside pm2 are supported, so pm2 isn't strictly required.

### "What is this?" moments

- **The node field.** "node path on host (optional, for nvm)" asks for something a newcomer can't
  be expected to know. Alex typed the factory folder there, because nothing else on the form asks
  for the factory, and got `/bin/bash: ... factory-actual: Is a directory`.
- **The factory step is invisible.** The form doesn't say a factory comes next.
- **"ssh alias (from ~/.ssh/config)"** assumes the reader knows the term, and the app could list
  those names itself.
- **The welcome text** leads with `factory-*`, `~/.al/al-control/config.yml` and the `local` host.
- **Raw errors.** ssh and probe output is shown as is, for example `Unexpected output from the
  probe on alex-linux-pc: /bin/bash: line 1: ...`.

### Silent gaps

- **Sign-in during Test shows nothing.** `SignInBanner` watches the window's host, while Test's
  events carry the alias being tested, so a Tailscale sign-in leaves the button on "…" for up to
  120 seconds. From reading the code; confirm in Phase 2.
- **Any local folder is accepted.** `add_factory` doesn't check a local path, so a wrong folder is
  saved and fails later. The remote form does check.
- **Paths are typed even when the app knows them.** Test already gets running factories with their
  folders from the probe, then keeps only the names.

### What detection found on `alex-linux-pc`

Run from `ae-lp-3643`, the route the app uses:

| Where | `node` | Version | pm2 beside it |
|---|---|---|---|
| Plain ssh, login shell | `/usr/bin/node` | 18.19.1 | No |
| Interactive shell | `~/.nvm/versions/node/v22.21.0/bin/node` | 22.21.0 | **Yes** |
| nvm folder | v20.19.6, v24.18.1, v25.0.0 | as named | No |

So `which node` over ssh gives the wrong answer here. **Having pm2 beside it** is what identifies
the right `node`. All five running factories on that machine use 22.21.0.

Both Macs list their hosts in `~/.ssh/config`: 3 entries on `ae-lp-3643`, 8 or more on
`alexs-mbp-16`. Some aren't factory machines (`gitlab.atherengineering.in`), so the list is a
choice, not a guess.

## Proposed Solution

### The flow

One full-page flow at `/onboarding`, used for the first run and for every later add. Wording is a
draft; it gets tuned on the real screens.

**Screen 1: Where do your factories run?**

```
Control Room shows what your factories are doing, on this computer or on
others you can reach. A factory is a repo that runs your lines.

Where do your factories run?

  ( ) On this computer             1 factory running here
  ( ) On another computer          reached over SSH
  ( ) I don't have a factory yet   show me how to make one

                                                     [ Continue ]
```

Default: "this computer" when a factory is running here. Otherwise nothing is selected, so the
user is asked rather than steered.

**Screen 2a: Which factories? (this computer)**

Running factories are listed and ticked, with their folders. "Add a folder…" opens the picker, and
a folder that isn't a factory is refused with a reason. If none are running: "No factories running
here. Pick the folder of a factory repo."

**Screen 2b: Which computer?**

```
Which computer are your factories on?

  [ alex-linux-pc                 v ]     from your SSH settings
                                          last option: Type a name…

Control Room connects the way `ssh alex-linux-pc` does in a terminal. That
needs to work without typing a password.

                                          [ Back ]  [ Connect ]
```

**Screen 3: Connecting**

Each check appears as it finishes, so a wait is never a blank screen.

```
Connecting to alex-linux-pc

  ✓ Reached alex-linux-pc
  ✓ Found Node 22.21.0
  ✓ Found pm2

                                          [ Back ]  [ Continue ]
```

| What happens | What the user sees |
|---|---|
| Sign-in needed | "alex-linux-pc needs you to sign in." with **Open sign-in page**; the check carries on after |
| One `node` has pm2 | Used, shown with its version. Nothing to answer |
| Several have pm2, or none does | A dropdown: versions listed, pm2 ones first, the best one selected, "Other path…" last |
| No `node` at all | "Node isn't installed on alex-linux-pc." with what to do, and Retry |
| No pm2 | A warning, not a stop: you can view factories but not start or stop them, with the install command. Continue stays available |

**Screen 4: Which factories? (that computer)**

As 2a. Running ones are listed and ticked. "Add by path" takes a path, checked over ssh, with a
plain message if it's missing or isn't a factory. If none are running, the path field is shown
straight away, with an example.

**Screen 5: You're set**

Lists what was added, shows "Saved to `~/.al/al-control/config.yml`, which the al-control CLI also
uses", and has one button: **Open Control Room**. It opens on the host just added.

**"I don't have a factory yet"** explains in two lines that a factory starts from
`factory-template`, links to the docs, and offers Back.

### Decisions

- **One flow, no separate forms.** The rail's `+` and "Add factory" open this flow at the right
  screen. `AddHostForm` and `AddRemoteFactoryForm` go away, so there is one path to keep clear.
- **`node` is detected, not asked.** The path field only appears under "Other path…".
- **`node:` is saved only when needed.** If the plain `node` over ssh is the right one, nothing is
  stored, so upgrading Node there can't break the host.
- **pm2 missing warns but doesn't block.** Viewing works without it. Start and stop already refuse
  a factory not under pm2.
- **The host is saved once its checks pass,** not at the end, because `check_factory_path` reads
  the host from the config. If someone quits before adding a factory, the next launch returns to
  the flow and the host is already in the dropdown.
- **Errors are translated, and the original stays under "Details".** Only errors we've seen:

| ssh or probe says | The user reads |
|---|---|
| `Connection refused` | It isn't accepting SSH connections. Is it on, with SSH enabled? |
| `Operation timed out` | It didn't answer. Is it on, awake and on your network? |
| `Could not resolve hostname` | Couldn't find a computer with that name. Check the spelling |
| `Host key verification failed` | This computer hasn't connected there before. Run `ssh <name>` once and answer yes |
| `Permission denied` | That computer didn't accept your SSH key. `ssh <name>` must work without a password |
| `does not permit you to SSH as user` | Tailscale refused that user. Try `user@<name>` |
| `node` exit 127 | Node isn't installed there, or isn't where we looked |
| A typed path that's a folder | That's a folder. Pick the `node` program, usually ending in `/bin/node` |

- **Words.** The flow says "computer". The rail keeps `HOST`, and the flow's first mention of it
  reads "computer (host)", so the two connect. The vocabulary in the workspace `CLAUDE.md` stands:
  factory, line, station.
- **Nothing changes for existing users.** A config with factories never sees the first-run screens,
  and the file format stays the same, so al-control needs no change.
- **The probe doesn't change.** Its `factories` query already returns each running factory's `cwd`,
  so the pin stays. Detection runs before `node` is known, so it's a small POSIX script over ssh.

### Node detection

A new `detect_node(ssh)` command makes one ssh call. For each candidate it reports path, version
and whether `pm2` sits beside it:

1. `command -v node` in the plain ssh shell
2. `command -v node` in `"$SHELL" -ilc`, with marker lines around the answer because interactive
   shells can print banners
3. `~/.nvm/versions/node/*/bin/node`

Duplicates are dropped. Then one with pm2 is picked if it's the only one; otherwise the dropdown
appears. After that, the existing `test_host` runs the real probe with the chosen `node`, so the
ticks mean it works, not just that a file exists.

## Implementation Phases

Each phase is committed on `alexs-mbp-16`. Git never runs on `alex-linux-pc`.

### Phase 1: Detection commands ✅
- [x] `detect_node(ssh)` in `host_commands.rs`, with the script from Node detection
- [x] Pure parse-and-rank function, with Rust tests: the table above, one with pm2, several, none,
      a banner around the markers
- [x] `list_ssh_hosts()`: `Host` lines from `~/.ssh/config`, skipping wildcards, with tests
- [x] `test_host` returns running factories with their folders as well as names
- [x] Wrappers in `src/lib/tauri-api.js`
- [x] Real check: `detect_node` from `ae-lp-3643` picks 22.21.0 on `alex-linux-pc`

### Phase 2: Errors that say what to do ✅
- [x] `explainError` (`src/lib/explain-error.js`) mapping the table above, keeping the original for
      Details, with tests on `node --test`, added to CI (this repo had no JS tests)
- [x] Missing sign-in prompt confirmed from the code; `SignInPrompt` takes any host name, used by
      the Connecting screen in Phase 4
- [x] Each ssh error reproduced on `alexs-mbp-16`; the Tailscale one is from `ae-lp-3643`. That
      added `Host key verification failed`, which `BatchMode=yes` causes on any first connection

### Phase 3: The flow, this computer ❌
- [ ] Rebuild `/onboarding` as steps: Where, Which factories, You're set
- [ ] Local running factories from the probe, ticked by default
- [ ] Local folders checked as factories (the probe's `factories` query with a candidate path)
- [ ] "I don't have a factory yet" screen, with its docs link checked
- [ ] Welcome copy per The bar; config path moved to You're set

### Phase 4: The flow, another computer ❌
- [ ] Which computer: dropdown from `list_ssh_hosts`, "Type a name…", saved hosts included
- [ ] Connecting screen with live checks and every row of its table
- [ ] `node` dropdown and "Other path…", with a typed path checked before use
- [ ] Which factories: running ones ticked, "Add by path" checked over ssh
- [ ] `node:` saved only when needed
- [ ] Finish opens on the added host, including when `local` has no factories

### Phase 5: One way in ❌
- [ ] Rail `+` opens Which computer; "Add factory" opens the host's Which factories
- [ ] Delete `AddHostForm.jsx` and `AddRemoteFactoryForm.jsx`; move shared styles if still used
- [ ] Rail's empty state ("No factories on X.") says what to do and links to the flow

### Phase 6: A newcomer's run ❌
- [ ] Before and after screenshots of each screen and failure, read back (`scripts/browser-mock.js`)
- [ ] Empty-config run on a Mac: `HOME=/tmp/cr` with the built app. Keep the path short for the
      socket limit
- [ ] Walk the four routes: factory here, factory elsewhere, no factory, and a host that fails
- [ ] Alex tries it on `ae-lp-3643`, with the question: where did you stop and wonder?
- [ ] README: Install and first run match the flow
- [ ] CHANGELOG, release, install on both Macs, delete this WIP

## Open Questions

None block Phase 1, and each has a default we can change after seeing it.

- **"Computer" or "host" in the flow?** Default: "computer". Decide on the real screens.
- **Window size.** The flow is a centred card; check it at the app's smallest window.

## Known Limitations

Noticed but not seen as a problem yet, so not being built:

- Stopped factories aren't discovered, only running ones. Add by path covers them. Scanning folders
  would need a probe change.
- Only nvm is searched by folder. fnm, volta and asdf are found only if the shell's PATH has them,
  and "Other path…" covers the rest.
- `Include` lines in `~/.ssh/config` aren't followed, and Tailscale peers aren't listed. "Type a
  name…" covers both.
- An nvm upgrade that removes a saved `node:` path fails with the plain `node` message. There is no
  screen yet to re-detect it for an existing host.
- An interactive shell that hangs would use the 120-second timeout.
- The Windows app hasn't been tried with this flow; `~/.ssh/config` there is under the user folder.

## Standards Read

`git-workflow/wip-files.md`, `principles/solve-problems-you-have-seen.md`,
`principles/try-it-to-decide.md`, `ui/README.md`, `ui/change-scope.md`,
`ui/visual-verification.md`. The phone and tablet widths don't apply to a desktop window, and this
app has no Storybook. The `ux-designer` routing covers FinOpsBricks apps, so this work stays in the
main session unless Alex says otherwise.

## Related Files

- `src/app/page.jsx` - routes to onboarding when no host has a factory
- `src/app/onboarding/page.jsx` - the page this rebuilds
- `src/components/Rail/Rail.jsx` - the add entry points and empty state
- `src/components/Rail/AddHostForm.jsx`, `AddRemoteFactoryForm.jsx` - replaced by the flow
- `src/components/SignInBanner.jsx`, `src/state/ssh-context.jsx` - sign-in prompt and ssh state
- `src/lib/tauri-api.js` - new command wrappers
- `src-tauri/src/host_commands.rs` - `test_host`, `check_factory_path`, new `detect_node`
- `src-tauri/src/source/probe.rs`, `source/ssh.rs` - the probe call, its errors, `ssh::run`
- `src-tauri/src/windows.rs` - which host a window opens on
- `README.md` - Install and first run
