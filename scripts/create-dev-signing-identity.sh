#!/usr/bin/env bash
#
# Creates a local, self-signed code-signing identity for development builds.
#
# Somul needs a *stable* code signature, not a distributable one. macOS attaches the audio-capture
# permission to the signature, and an ad-hoc signed binary is identified by its code hash - which
# changes on every rebuild, so the grant in System Settings silently stops matching the app and
# every tap goes back to returning silence.
#
# This identity belongs to no Apple team. It cannot be notarised or distributed, which is fine:
# its whole job is to keep saying "this is the same app" across rebuilds.
#
#   ./scripts/create-dev-signing-identity.sh
#   APPLE_SIGNING_IDENTITY="Somul Dev" npm run tauri build

set -euo pipefail

IDENTITY_NAME="${1:-Somul Dev}"
KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"
WORKDIR="$(mktemp -d)"

trap 'rm -rf "${WORKDIR}"' EXIT

if security find-identity -v -p codesigning | grep -q "${IDENTITY_NAME}"; then
  echo "Identity '${IDENTITY_NAME}' already exists. Nothing to do."
  exit 0
fi

echo "Creating a self-signed code-signing certificate: ${IDENTITY_NAME}"

# `basicConstraints=CA:true` is what lets the certificate act as its own root. A self-signed leaf
# without it leaves codesign unable to build a chain, which it reports as an unrelated error.
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "${WORKDIR}/key.pem" \
  -out "${WORKDIR}/cert.pem" \
  -subj "/CN=${IDENTITY_NAME}/O=${IDENTITY_NAME}/C=US" \
  -addext "basicConstraints=critical,CA:true" \
  -addext "keyUsage=critical,digitalSignature,keyCertSign" \
  -addext "extendedKeyUsage=critical,codeSigning" >/dev/null 2>&1

# Legacy algorithms on purpose. OpenSSL 3 defaults to AES-256-CBC with a SHA-256 MAC, and the
# macOS keychain importer cannot read that - it fails claiming the password is wrong, whatever
# the password is.
openssl pkcs12 -export -legacy \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -inkey "${WORKDIR}/key.pem" \
  -in "${WORKDIR}/cert.pem" \
  -out "${WORKDIR}/identity.p12" \
  -passout pass:somul >/dev/null 2>&1

# `-A` lets any tool use the key. Without it macOS prompts for the keychain password on every
# single signing operation, which turns every build into a dialog. Acceptable for a local
# development certificate that signs nothing anyone else will ever run.
security import "${WORKDIR}/identity.p12" -k "${KEYCHAIN}" -P somul -A >/dev/null

echo "Trusting it for code signing (macOS will ask for your password)"
security add-trusted-cert -r trustRoot -p codeSign -k "${KEYCHAIN}" "${WORKDIR}/cert.pem"

echo
security find-identity -v -p codesigning | grep "${IDENTITY_NAME}" || true
echo
echo "Now build with it:"
echo "  APPLE_SIGNING_IDENTITY=\"${IDENTITY_NAME}\" npm run tauri build"
