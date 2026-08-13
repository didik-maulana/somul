#!/usr/bin/env bash
#
# Puts this Mac back to the state a first-time user's would be in.
#
# "Fresh install" is more than deleting the app. Somul leaves six traces, and the two that matter
# most are invisible: the audio-capture grant lives in macOS's TCC database, and a marker file
# records that capture once worked here. Miss either and the next launch skips exactly the code
# path a new user hits first — the panel behaves, and the bug ships anyway.
#
#   ./scripts/reset-local-state.sh            # wipe everything, keep /Applications/Somul.app
#   ./scripts/reset-local-state.sh --uninstall # also remove the installed app
#
# Destructive by design: saved volumes, the chosen hotkey, and the theme all go. That is the
# point. It touches nothing outside Somul's own files and Somul's own TCC entry.

set -euo pipefail

BUNDLE_ID="com.somul.app"
should_uninstall=false

for argument in "$@"; do
  case "${argument}" in
    --uninstall) should_uninstall=true ;;
    *)
      echo "Unknown option: ${argument}" >&2
      echo "Usage: $0 [--uninstall]" >&2
      exit 1
      ;;
  esac
done

echo "Quitting Somul"
pkill -f "Somul.app/Contents/MacOS/somul" 2>/dev/null || true
sleep 1

# The permission. Reset before anything else: while the app is registered, macOS keeps the entry
# alive and a later reset can silently no-op.
#
# `ScreenCapture` is the service, despite the name. System audio capture and screen recording
# share one TCC entry on macOS — the pane is "Screen & System Audio Recording" — which is also why
# `CGPreflightScreenCaptureAccess` looks like a way to read it and is not (it reports only the
# screen half).
echo "Revoking the audio-capture permission"
tccutil reset ScreenCapture "${BUNDLE_ID}" >/dev/null 2>&1 || true

# Everything Somul itself wrote. `capture-proven` is the one worth naming: it records that capture
# has worked on this Mac at least once, and while it exists the panel will never again ask about
# the permission — so a test run with it in place cannot see the first-run experience at all.
for path in \
  "${HOME}/Library/Application Support/${BUNDLE_ID}" \
  "${HOME}/Library/Preferences/${BUNDLE_ID}.plist" \
  "${HOME}/Library/WebKit/${BUNDLE_ID}" \
  "${HOME}/Library/Caches/${BUNDLE_ID}" \
  "${HOME}/Library/HTTPStorages/${BUNDLE_ID}" \
  "${HOME}/Library/Saved Application State/${BUNDLE_ID}.savedState"
do
  if [ -e "${path}" ]; then
    echo "Removing ${path}"
    rm -rf "${path}"
  fi
done

# Launch-at-login is a LaunchAgent rather than a file Somul owns, so it survives everything above.
AGENT="${HOME}/Library/LaunchAgents/${BUNDLE_ID}.plist"
if [ -e "${AGENT}" ]; then
  echo "Removing the login item"
  launchctl unload "${AGENT}" 2>/dev/null || true
  rm -f "${AGENT}"
fi

if [ "${should_uninstall}" == true ] && [ -e "/Applications/Somul.app" ]; then
  echo "Removing /Applications/Somul.app"
  rm -rf "/Applications/Somul.app"
fi

echo
echo "Done. The next launch is a first launch:"
echo "  - macOS will ask for the audio-capture permission again"
echo "  - no remembered volumes, default hotkey, system theme"
echo
echo "Verify before shipping: the permission notice must NOT appear while nothing is playing."
