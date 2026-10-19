#!/usr/bin/env bash
# Install or update Control Room on macOS from the latest GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/assemblyline-sh/control-room/main/install.sh | bash
#
# The macOS build isn't notarized yet. A browser download is quarantined and
# Gatekeeper refuses to open it; a curl download isn't, so this opens normally.
# Installs to /Applications, or ~/Applications when /Applications isn't
# writable. Set CONTROL_ROOM_DIR to choose another folder.

set -euo pipefail

REPO="assemblyline-sh/control-room"
ASSET="Control.Room_universal.app.tar.gz"
APP="Control Room.app"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script installs the macOS app. For Windows, download the installer from" >&2
  echo "https://github.com/$REPO/releases/latest" >&2
  exit 1
fi

dir="${CONTROL_ROOM_DIR:-/Applications}"
if [ -z "${CONTROL_ROOM_DIR:-}" ] && [ ! -w "$dir" ]; then
  dir="$HOME/Applications"
fi
mkdir -p "$dir"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading the latest Control Room..."
curl -fsSL "https://github.com/$REPO/releases/latest/download/$ASSET" -o "$tmp/app.tar.gz"
tar -xzf "$tmp/app.tar.gz" -C "$tmp"
if [ ! -d "$tmp/$APP" ]; then
  echo "The download didn't contain $APP." >&2
  exit 1
fi

if pgrep -xq control-room; then
  echo "Quitting the running Control Room..."
  osascript -e 'quit app "Control Room"' >/dev/null 2>&1 || true
  sleep 2
fi

rm -rf "${dir:?}/$APP"
mv "$tmp/$APP" "$dir/"
# In case an earlier browser download left the flag on files we just replaced.
xattr -dr com.apple.quarantine "$dir/$APP" 2>/dev/null || true

version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$dir/$APP/Contents/Info.plist" 2>/dev/null || echo '?')"
echo "Installed Control Room $version in $dir. Open it from there or with: open -a \"Control Room\""
