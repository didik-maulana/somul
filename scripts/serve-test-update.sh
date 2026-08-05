#!/usr/bin/env bash
#
# Stands up a local release feed so the updater can be exercised end to end.
#
# The real endpoint cannot be used for this. Its manifest is signed with a key held in CI, and the
# updater refuses any artifact whose signature does not match the public key compiled into the
# app - which is the whole point of the feature and not something to weaken for a test.
#
# So this script builds against its own throwaway key instead. Both the endpoint and the public
# key are supplied through a generated override config passed to `tauri build --config`, so the
# committed `tauri.conf.json` is never edited and a test build can never be mistaken for a real
# one: the two disagree about who is allowed to sign a release.
#
#   ./scripts/serve-test-update.sh --install     # build 1.0.0, put it in /Applications
#   # bump `version` in src-tauri/tauri.conf.json and src-tauri/Cargo.toml to 1.1.0
#   ./scripts/serve-test-update.sh --slow        # build 1.1.0, publish it, serve it slowly
#   # launch the installed 1.0.0 from /Applications - the banner appears
#
# The banner comes from the *installed* build, not from this checkout, so testing a change to the
# update UI means installing a build that contains it and then publishing something newer still.
#
# Only the *check* needs this rig. To see the banner and the settings row without building
# anything, `SOMUL_FAKE_UPDATE=9.9.9 npm run tauri dev` announces a version instead.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_PATH="${SOMUL_TEST_KEY:-${HOME}/.tauri/somul-test.key}"
KEY_PASSWORD="${SOMUL_TEST_KEY_PASSWORD:-}"
OVERRIDE_CONFIG="${REPO_ROOT}/src-tauri/tauri.updater-test.conf.json"
SERVE_DIR="${REPO_ROOT}/src-tauri/target/updater-test"
BUNDLE_DIR="${REPO_ROOT}/src-tauri/target/release/bundle/macos"
PORT="${SOMUL_TEST_PORT:-8000}"

should_install=false
should_build=true
should_serve=true
# Fast enough not to be a wait, slow enough that the panel's progress bar has a middle. A local
# feed at full speed finishes before the bar can be looked at.
throttle_kbps=0

for argument in "$@"; do
  case "${argument}" in
    --install) should_install=true ;;
    --serve-only) should_build=false ;;
    --no-serve) should_serve=false ;;
    --slow) throttle_kbps=512 ;;
    --slow=*) throttle_kbps="${argument#--slow=}" ;;
    *)
      echo "Unknown option: ${argument}" >&2
      echo "Usage: $0 [--install] [--serve-only] [--no-serve] [--slow[=kbps]]" >&2
      exit 1
      ;;
  esac
done

cd "${REPO_ROOT}"

version="$(node -p "require('./src-tauri/tauri.conf.json').version")"

case "$(uname -m)" in
  arm64) target_key="darwin-aarch64" ;;
  x86_64) target_key="darwin-x86_64" ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

if [[ ! -f "${KEY_PATH}" ]]; then
  echo "Generating a throwaway signing key at ${KEY_PATH}"
  mkdir -p "$(dirname "${KEY_PATH}")"
  # An empty password keeps the build non-interactive. The key signs nothing anyone else runs.
  npx tauri signer generate --ci --password "${KEY_PASSWORD}" --write-keys "${KEY_PATH}" >/dev/null
fi

# The key is checked against the password here rather than during the build. A mismatch surfaces
# from the bundler as "incorrect updater private key password" — after a full release compile, and
# pointing at nothing the reader can act on.
probe_file="$(mktemp)"
trap 'rm -f "${probe_file}" "${probe_file}.sig"' EXIT

if ! TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${KEY_PASSWORD}" \
  npx tauri signer sign -f "${KEY_PATH}" -p "${KEY_PASSWORD}" "${probe_file}" >/dev/null 2>&1; then
  echo "The key at ${KEY_PATH} does not open with the password this script has." >&2
  echo "Either export SOMUL_TEST_KEY_PASSWORD with the right one, or delete the key and" >&2
  echo "re-run to generate a fresh throwaway pair." >&2
  exit 1
fi

public_key="$(cat "${KEY_PATH}.pub")"

# `dangerousInsecureTransportProtocol` is what lets the endpoint be plain http. It exists in the
# override config alone, so the flag cannot follow a build out of this rig.
cat >"${OVERRIDE_CONFIG}" <<JSON
{
  "plugins": {
    "updater": {
      "endpoints": ["http://localhost:${PORT}/latest.json"],
      "dangerousInsecureTransportProtocol": true,
      "pubkey": "${public_key}"
    }
  }
}
JSON

if [[ "${should_build}" == true ]]; then
  echo "Building Somul ${version} against the local feed"

  # `--bundles app` on purpose. The updater ships the `.app.tar.gz`, never the disk image, and
  # `bundle_dmg.sh` fails outright whenever an earlier run left a volume mounted under /Volumes —
  # so building the DMG here only adds a way for a test to fail at something it does not use.
  TAURI_SIGNING_PRIVATE_KEY="$(cat "${KEY_PATH}")" \
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${KEY_PASSWORD}" \
    npm run tauri build -- --bundles app --config "${OVERRIDE_CONFIG}"

  if [[ ! -f "${BUNDLE_DIR}/Somul.app.tar.gz.sig" ]]; then
    echo "Build produced no signature next to Somul.app.tar.gz." >&2
    echo "Check that ${KEY_PATH} is readable and that createUpdaterArtifacts is on." >&2
    exit 1
  fi

  mkdir -p "${SERVE_DIR}"
  cp "${BUNDLE_DIR}/Somul.app.tar.gz" "${SERVE_DIR}/"

  # Newlines are stripped rather than trusted away: a signature carrying one would be pasted into
  # the manifest as a raw line break, and the failure that follows is a JSON parse error that says
  # nothing about signatures at all.
  signature="$(tr -d '\n' <"${BUNDLE_DIR}/Somul.app.tar.gz.sig")"

  cat >"${SERVE_DIR}/latest.json" <<JSON
{
  "version": "${version}",
  "notes": "Local updater test build",
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platforms": {
    "${target_key}": {
      "signature": "${signature}",
      "url": "http://localhost:${PORT}/Somul.app.tar.gz"
    }
  }
}
JSON

  echo "Published ${version} for ${target_key}"
fi

if [[ "${should_install}" == true ]]; then
  echo "Replacing /Applications/Somul.app with this build"
  rm -rf "/Applications/Somul.app"
  cp -R "${BUNDLE_DIR}/Somul.app" "/Applications/Somul.app"
fi

if [[ ! -f "${SERVE_DIR}/latest.json" ]]; then
  echo "Nothing published yet — run without --serve-only first." >&2
  exit 1
fi

if [[ "${should_serve}" == false ]]; then
  echo "Published to ${SERVE_DIR}. Re-run with --serve-only to serve it."
  exit 0
fi

echo
echo "Publishing $(node -p "require('${SERVE_DIR}/latest.json').version")"
echo "Launch /Applications/Somul.app to see the check hit this feed. Ctrl-C to stop."
echo

node "${REPO_ROOT}/scripts/serve-updater-feed.mjs" "${SERVE_DIR}" "${PORT}" "${throttle_kbps}"
