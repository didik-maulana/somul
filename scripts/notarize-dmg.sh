#!/usr/bin/env bash
#
# Notarizes and staples a built DMG.
#
# `tauri build` notarizes the .app and then wraps it in a disk image it only signs, so the file a
# user actually downloads carries a Developer ID signature and no ticket. Gatekeeper rejects it on
# the first open: `spctl` reports "Unnotarized Developer ID" even though the app inside is fine.
# This closes that gap, and refuses to exit clean until spctl agrees.
#
# Credentials come from whichever pair is set, App Store Connect API key first:
#
#   APPLE_API_KEY_PATH + APPLE_API_KEY + APPLE_API_ISSUER
#   APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID
#
#   ./scripts/notarize-dmg.sh src-tauri/target/universal-apple-darwin/release/bundle/dmg/Somul_1.0.0_universal.dmg

set -euo pipefail

DMG="${1:-}"

if [[ -z "${DMG}" || ! -f "${DMG}" ]]; then
  echo "Usage: $0 <path-to-dmg>" >&2
  exit 1
fi

if [[ -n "${APPLE_API_KEY_PATH:-}" && -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_ISSUER:-}" ]]; then
  auth=(--key "${APPLE_API_KEY_PATH}" --key-id "${APPLE_API_KEY}" --issuer "${APPLE_API_ISSUER}")
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  auth=(--apple-id "${APPLE_ID}" --password "${APPLE_PASSWORD}" --team-id "${APPLE_TEAM_ID}")
else
  echo "No notarization credentials. Set APPLE_API_KEY_PATH, APPLE_API_KEY and" >&2
  echo "APPLE_API_ISSUER, or APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID." >&2
  exit 1
fi

echo "Notarizing ${DMG}"
xcrun notarytool submit "${DMG}" "${auth[@]}" --wait

xcrun stapler staple "${DMG}"

# The check that matters. Everything above can report success while leaving a file Gatekeeper
# still turns away, and this is the one command that asks the question a user's Mac will ask.
if ! spctl -a -vvv -t open --context context:primary-signature "${DMG}"; then
  echo "Gatekeeper still rejects ${DMG} after stapling." >&2
  exit 1
fi
