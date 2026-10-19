---
description: Release control-room — bumps version everywhere it lives, regenerates lockfiles correctly, updates CHANGELOG, tags, and pushes. Project-specific overrides for the user-level code:release.
---

# Release control-room

This command **overrides** the user-level `code:release` skill because control-room has version metadata in **four files** (not just `package.json`), and previous releases (v0.2.0 and v0.3.0) shipped with a broken CI build because of how easy it is to miss one. Follow these steps as written — every shortcut taken here has bitten us before.

## Where the version lives in this repo

| File | What it's for | Auto-synced by |
|---|---|---|
| `package.json` | Node package version | — (edit directly) |
| `package-lock.json` | npm lock (top-level + nested `packages."".version`) | `npm version` |
| `src-tauri/Cargo.toml` | Rust crate version (what `tauri build` reads) | — (edit directly) |
| `src-tauri/Cargo.lock` | Cargo lock | `cargo check` |
| `src-tauri/tauri.conf.json` | Tauri bundle metadata (drives installer filenames) | — (edit directly) |

**Pitfall caught in v0.3.0**: editing only `package.json` leaves `package-lock.json`'s version pinned at the previous release. `npm ci` in CI then refuses to install because the lock is stale, and the entire build fails. **Always use `npm version` to keep them in sync.**

## Step 1 — Review state

Run in parallel:

```bash
git status -s
git -C . log $(git describe --tags --abbrev=0)..HEAD --oneline
git -C . diff $(git describe --tags --abbrev=0)..HEAD --stat | tail -20
cat package.json | grep version
cat src-tauri/Cargo.toml | grep -E '^version'
cat src-tauri/tauri.conf.json | grep version
```

Confirm:
- Working tree is clean (no uncommitted changes that *aren't* part of this release). If dirty, ask the user before proceeding.
- All four version files agree on the current version. If they disagree, the previous release was broken — fix the desync first by bumping them all to match.
- There are commits since the last tag worth releasing. If not, refuse the release.

## Step 2 — Analyze + propose version bump

Pre-1.0 convention:
- **MINOR** (0.x.0) for new features, even ones with internal-restructure pain.
- **PATCH** (0.0.x) for bug fixes, polish, doc-only, CI fixes.
- Avoid MAJOR (1.0.0) unless the user explicitly says "this is the 1.0".

Categorize commits since the last tag into Added / Changed / Fixed / Removed. Present the analysis to the user in the form:

```
**Current version**: a.b.c
**Recommended bump**: a.b.c → a.b'.c' (MINOR/PATCH)
**Reasoning**: …

**Added**:
- …
**Changed**:
- …
**Fixed**:
- …

Proceed? (yes/no)
```

Wait for confirmation.

## Step 3 — Bump versions (all four files in lockstep)

Run these in order:

```bash
# 1. npm version updates package.json AND package-lock.json (top-level and nested).
#    --no-git-tag-version stops it from making the commit/tag — we do those manually.
npm version <NEW_VERSION> --no-git-tag-version

# 2. Cargo.toml — edit manually. Replace `version = "<OLD>"` → `version = "<NEW>"`.
#    The Edit tool, not `sed`, so the change is reviewable.

# 3. tauri.conf.json — edit manually. Replace `"version": "<OLD>"` → `"version": "<NEW>"`.

# 4. Sync Cargo.lock by running cargo check from src-tauri/.
cd src-tauri && cargo check --quiet 2>&1 | tail -3 && cd ..
```

After these four steps, verify:

```bash
git diff --stat
# Should show ~5 files: package.json, package-lock.json, src-tauri/Cargo.toml,
# src-tauri/Cargo.lock, src-tauri/tauri.conf.json. NOTHING ELSE in this diff.
```

If any other file appears, stop and investigate.

## Step 4 — Update CHANGELOG.md

The repo uses [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Pattern:

```markdown
## [Unreleased]

### Added

### Changed

### Fixed

### Removed

## [<NEW_VERSION>] - <YYYY-MM-DD>

### Added
- …

### Changed
- …

### Fixed
- …
```

Rules:
- Today's date in `YYYY-MM-DD`.
- Group entries by Added/Changed/Fixed/Removed. Drop empty groups.
- One bullet per logical change, not per commit. Be specific about *what* and *why* — readers shouldn't have to read the commits.
- For files that no one outside the team will read (internal refactors, doc-only), prefer terse bullets. For user-visible changes (new view, new shortcut, bug fix), spell out the impact.

## Step 5 — Commit

One commit, message format:

```
chore: release <NEW_VERSION>

<one-paragraph summary of what's in this release>

<optional bullet highlights — only for substantial releases>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Use a HEREDOC for proper newline preservation. Add the five version files + CHANGELOG.md explicitly — don't `git add -A` (might pick up stray files).

```bash
git add CHANGELOG.md package.json package-lock.json \
        src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "$(cat <<'EOF'
chore: release <NEW_VERSION>

<body>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Step 6 — Tag

Annotated tag (not lightweight), prefixed `v`:

```bash
git tag -a v<NEW_VERSION> -m "v<NEW_VERSION> — <one-line summary>"
```

Never force-move an existing tag. If a tag was already pushed and the release is broken, cut a patch release (e.g. `0.3.1`) rather than retagging — the public history shouldn't shift.

## Step 7 — Push branch, then tag

```bash
git push origin main
git push origin v<NEW_VERSION>
```

Order matters: push the branch first so the workflow has the matching commit to build. The release workflow at `.github/workflows/release.yml` fires on `v*` tag push.

## Step 8 — Verify CI started

```bash
sleep 8
gh run list --workflow=release.yml --limit 2
```

The newest entry should be `in_progress` against the new tag. If it's already `completed failure`, immediately `gh run view <id> --log-failed` and triage.

## Common failure modes (and what to check first)

- **`npm ci` fails with "Missing @<some-transitive> from lock file"** — package-lock.json drifted. Run `npm install` locally and commit the lockfile delta. If this happens during a release, cut a patch release with just the lock fix (don't retag).
- **`tauri build` fails because installer filenames clash** — version in `tauri.conf.json` wasn't bumped. The bundle uses that field for output paths.
- **Cargo refuses to build with "version mismatch"** — `Cargo.lock` and `Cargo.toml` disagree because `cargo check` wasn't run after editing `Cargo.toml`. Re-run `cargo check` in `src-tauri/`.
- **Tag pushed but no workflow ran** — workflow file may have a typo or missing `on: push: tags: ['v*']`. Inspect `.github/workflows/release.yml`.

## Edge cases

- **No commits since the last tag**: refuse. There's nothing to release.
- **First release ever (no tags)**: skip the "since last tag" comparison; categorize the full history. Likely 0.1.0.
- **Pre-existing uncommitted changes**: list them to the user and ask whether they belong in this release. Don't silently include or exclude.
- **A previous release was broken**: don't retag. Cut a patch release. Document the cause in the CHANGELOG's Fixed section.
