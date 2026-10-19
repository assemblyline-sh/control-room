# macOS Signing and Notarization

## Status: NOT STARTED — waiting on Apple Developer Program enrolment

Sign the macOS release builds with a Developer ID certificate and notarize them with Apple in CI, so a downloaded control-room opens without Gatekeeper blocking it.

---

## Problem Statement

A `.dmg` downloaded from a GitHub release won't open. macOS shows **"control-room" Not Opened — Apple could not verify "control-room" is free of malware**, with only *Done* and *Move to Bin*.

Cause, checked on the fob-watch 0.6.0 release build in `/Applications`:
- The download carries `com.apple.quarantine` (set by the browser).
- The app is only ad-hoc signed (`codesign -dv` → `Signature=adhoc`, `TeamIdentifier=not set`) and not notarized.
- `.github/workflows/release.yml` runs `tauri-apps/tauri-action@v0` with no Apple signing secrets, so every release is built this way.

Gatekeeper blocks any quarantined app it can't verify. A locally built app has no quarantine flag, so it opens fine, which is why this only shows up on downloads.

**Workaround until this lands** (only for our own builds): System Settings → Privacy & Security → **Open Anyway** next to "control-room was blocked…", or `xattr -dr com.apple.quarantine /Applications/control-room.app`. On recent macOS, right-click → Open no longer gets past this dialog.

## Proposed Solution

**Account.** An **Individual** Apple Developer Program membership ($99/year), in Alex's own name. Decided over Organization: quicker to set up, with no D-U-N-S number or legal-entity verification. Trade-offs we accept:
- Builds are signed "Developer ID Application: <legal name> (<TEAM_ID>)", so users see a person, not the company.
- Only one person on the account.

Apple can convert an individual membership to an organization later, and Developer ID apps can be re-signed under a new identity, so this isn't a one-way door. The same membership also covers App Store publishing (iOS and the other Apple platforms) if that's ever needed.

**CI.** `tauri-action` signs and notarizes on its own when these environment variables are set. They're Tauri's documented names; check them against the current Tauri docs when wiring this up:

| Secret | What it is |
|---|---|
| `APPLE_CERTIFICATE` | The Developer ID Application certificate and its private key, exported as `.p12`, base64-encoded |
| `APPLE_CERTIFICATE_PASSWORD` | The password set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | The certificate's full name, e.g. `Developer ID Application: Your Name (ABCDE12345)` |
| `APPLE_ID` | The Apple ID email of the membership |
| `APPLE_PASSWORD` | An **app-specific password** for that Apple ID (not the account password) |
| `APPLE_TEAM_ID` | The 10-character Team ID from Membership details |

They're passed to the `tauri-action` step's `env:` on the macOS matrix entry only.

**Security.** The `.p12` can sign software as Alex. Keep it only in GitHub secrets and a password manager; never commit it.

**Out of scope:**
- Windows SmartScreen. It needs a separate Windows code-signing certificate; the Apple membership doesn't help.
- The Mac App Store. Its sandbox doesn't fit an app that spawns `ssh`, `pm2` and a PTY.

## Implementation Phases

### Phase 1: Enrol ❌
- [ ] Apple ID in own legal name, two-factor authentication on (personal email if it should stay separate from work)
- [ ] Enrol as **Individual / Sole Proprietor**: Apple Developer app (Account → Enroll) or developer.apple.com/programs/enroll; pay $99/year
- [ ] Membership approved; note the Team ID

### Phase 2: Certificate and secrets ❌
- [ ] Create a **Developer ID Application** certificate (Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application)
- [ ] Keychain Access → My Certificates → export it as `.p12` with a password (it must include the private key); store the `.p12` and password in a password manager
- [ ] Create an app-specific password at account.apple.com → Sign-In and Security → App-Specific Passwords
- [ ] Add the six secrets to `assemblyline-sh/control-room` (Settings → Secrets and variables → Actions). `APPLE_CERTIFICATE` = `base64 -i cert.p12 | pbcopy`

### Phase 3: Wire up the release workflow ❌
- [ ] `release.yml`: pass the six secrets in the `tauri-action` step's `env:`, macOS entry only (Windows builds must not fail without them)
- [ ] Check whether `tauri.conf.json` needs `bundle.macOS` settings for notarization: hardened runtime (Tauri's default), and any entitlements for what the app does (spawning `ssh` / `pm2` / `node`, PTY for the integrated terminal, the webview)
- [ ] Bump `actions/setup-node` from `20` if needed: Next 16 needs Node 20.9+ (the latest 20.x already satisfies this)

### Phase 4: Verify ❌
- [ ] Trigger the workflow (`workflow_dispatch` or a test tag) and confirm the macOS job signs and notarizes (the `tauri-action` log shows notarization submitted and accepted)
- [ ] Download the `.dmg` from the draft release in a browser, install, and open it without the Gatekeeper dialog
- [ ] `codesign -dv --verbose=2 /Applications/control-room.app` shows `Authority=Developer ID Application: …` and the Team ID; `spctl -a -vv /Applications/control-room.app` says `accepted`, `source=Notarized Developer ID`
- [ ] The signed app's features work under hardened runtime: local factories, ssh hosts, pm2 start/stop/logs, integrated terminal

### Phase 5: Docs ❌
- [ ] README: drop any "Open Anyway" first-launch note once releases are notarized (until then, add one)
- [ ] CHANGELOG entry for the first signed release

## Related Files

- `.github/workflows/release.yml` - Release build (`tauri-apps/tauri-action@v0`, macOS universal + Windows)
- `src-tauri/tauri.conf.json` - Bundle config; `bundle.macOS` if entitlements or other settings are needed
- `README.md` - First-launch instructions
