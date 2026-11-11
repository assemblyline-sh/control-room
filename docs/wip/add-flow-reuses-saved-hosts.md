# Add flow reuses a saved host

## Status: IN PROGRESS (~75%)

Adding a computer that's already in the config fails with "A host named '…' already exists" when
it's typed as `user@name`, or when the host already has factories. This WIP makes the add flow
offer every saved host and recognise one however it's typed, and lets it open a saved host with
nothing new to add. Release 0.4.3.

---

## Problem Statement

Seen on `s0179` with 0.4.2. The config has:

```yaml
alexs-mbp-16:
  ssh: alexs-mbp-16
  node: /Users/alex/.nvm/versions/node/v22.23.3/bin/node
  factories:
    factory-alex-mac: ~/ec2code/assemblyline/factories/factory-alex-mac
```

The user opens + (add a computer), and Connect ends in:

```
Something went wrong with alexs-mbp-16
Details: A host named 'alexs-mbp-16' already exists
```

Why:

- **The saved host isn't offered.** `StepComputer` lists saved hosts only when they have no
  factories (`h.factories.length === 0`), so the user types the name, most likely as
  `alex@alexs-mbp-16`, which is how they ssh.
- **A typed name only matches by exact `ssh` value.** `StepConnecting` names a new host by dropping
  the user (`alex@alexs-mbp-16` → `alexs-mbp-16`) but looks for an existing one with `h.ssh ===
  ssh`. `alexs-mbp-16` ≠ `alex@alexs-mbp-16`, so it calls `add_host`, and the config refuses the
  duplicate name.
- **A saved host with nothing new can't be opened.** `StepFactories` enables Continue only when a
  new factory is ticked, so reaching a host whose running factories are all added is a dead end.

## Proposed Solution

- **`src/lib/saved-host.js`, `savedHostFor(hosts, typed)`:** the saved remote host a typed name
  means, or `null`. It matches the host's `ssh` or name exactly, or the same computer with the user
  dropped on either side (`alex@box` and `box` are one computer). Used by both screens.
- **`StepComputer`:** offer every saved remote host as "(already added)", and send a typed name
  or ssh-config alias that `savedHostFor` recognises to that host's factories instead of
  connecting again.
- **`StepConnecting`:** the existing-host check on Continue uses `savedHostFor` too, so it never
  calls `add_host` for a name the config already has.
- **`StepFactories`:** when the host already has factories, Continue works with nothing new
  ticked and reads "Open <computer>". `AddFlow` then finishes straight to that host's window (no
  "You're set" with an empty list).

### Key decisions

- **Same computer, different user is reused.** The saved host keeps its own `ssh` value, so
  typing `bob@box` when `box` is saved opens `box` as configured. Two users on one computer can't
  both be hosts through the add flow, which already holds: the host's name drops the user, and
  names are unique.
- **No change to `add_host`.** Its duplicate check stays as the last guard.

## Implementation Phases

### Phase 1: Reuse a saved host ✅

- [x] `src/lib/saved-host.js`: `savedHostFor`, and `computerOf` (the `user@` drop
      `StepConnecting` already did, now shared)
- [x] `tests/saved-host.test.mjs`: exact ssh, exact name, `user@` typed, `user@` saved, local
      ignored, no match
- [x] `StepComputer.jsx`: offer every saved remote host; typed or alias → saved host, with a note
      and "Next" instead of "Connect"
- [x] `StepConnecting.jsx`: existing host through `savedHostFor`
- [x] `StepFactories.jsx`: "Open <computer>" with nothing new when the host has factories
- [x] `AddFlow.jsx`: nothing added → `onFinish(host)` directly
- [x] `npm test` (15 pass), `npm run typecheck` pass; `npm run lint` 0 errors, its 9 warnings are
      all in files this doesn't touch

### Phase 2: Docs ✅

- [x] `CHANGELOG.md`: `[Unreleased]`, `### Fixed`
- [x] `README.md`: First run says a saved computer can be picked again

### Phase 3: Release 0.4.3 and install on s0179 ❌

- [x] Bump the five version files and date the CHANGELOG; `chore: release 0.4.3`
- [ ] Push `main` (CI green), tag `v0.4.3`; the Release workflow builds the draft
- [ ] Publish the draft
- [ ] Install the `.exe` on `s0179`: the hash matches the release digest
- [ ] Verify on `s0179`: + → `alex@alexs-mbp-16` opens `alexs-mbp-16`, no error
- [ ] Delete this WIP

## Related Files

- `src/lib/saved-host.js` - new: `savedHostFor`
- `src/components/AddFlow/StepComputer.jsx` - which computers are offered
- `src/components/AddFlow/StepConnecting.jsx` - `next()`, the existing-host check
- `src/components/AddFlow/StepFactories.jsx` - Continue / Open
- `src/components/AddFlow/AddFlow.jsx` - `onAdded` with nothing added
- `src-tauri/src/central_config.rs` - `add_host`'s duplicate-name check (unchanged)
