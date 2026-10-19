# Clearing and Triage: Parity with al-control

control-room's Failures and Housekeeping tabs do what `al-control workpieces errors` and `workpieces clear` do. Both tools act on the same prod factories, so they must agree: the same failure lands in the same group, and the same bin is clearable or not in both.

## What has to match

| Rule | al-control | control-room | Checked by |
|---|---|---|---|
| Error key | `src/utils/failures.js` `errorKey` | `failures.rs` `error_key` (scanner; no regex crate, and the path rule needs a lookbehind) | its test vectors; `cargo test -- --ignored error_key_parity` runs `errorKey` with node over every real failure (322 identical, 2026-10-10) |
| Orphaned failures (failed folder, no `pointer.json`) | probe `state.orphans`; `count` adds to FAILED; `errors` lists | `local.rs` scan; rail failed counts; Failures group; failed bin rows | `probe_parity` compares `orphans` |
| Clearable | `done` anywhere, terminal `output` | `housekeeping.rs` `clearable_bins` | `plan_every_host` totals = `clear --bin done/finished` dry runs on every real factory |
| Skipped | config `keep`; `move_files` `source_bin` (first two segments) | `skip_for`, `drained_bins` | unit tests |
| Age | probe `ages`: later of folder and `log.jsonl` mtime | `Source::ages` (local port) | unit tests both sides |
| Delete guard | probe `remove`: temp/stations, done/output, not kept, has pointer.json, all-or-nothing | `local.rs` `remove_workpieces`; remotely the same probe | unit tests; `remote_clear_scratch` |

## Three layers, so one bug isn't a deletion

1. **Plan** (`plan_clear`) — read-only; what the dialog shows.
2. **Re-plan** (`clear_workpieces`) — reloads state and refuses the batch if any dir from JS isn't clearable *now* (moved, kept since, drained, gone, outside temp/stations). JS input is never trusted.
3. **Source** — the local port or the probe re-checks each dir before deleting any.

## Deliberate differences

- **No `-w` in the app.** The CLI requires a factory for `clear`; the app can clear a whole host because the dialog names every factory, bin and count, and the host is on the button.
- **Delete workpiece…** removes the one folder at the workpiece's position; the CLI's `clear <id>` removes every done and finished copy of the id.

## Related

- al-control `docs/decisions/0005-guarded-clear-of-done-and-finished.md`, `docs/architecture/clearing-workpieces-safely.md`
- `docs/wip/failure-triage-and-housekeeping.md`
