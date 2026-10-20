#!/bin/bash
# Developer ID release: build → sign with the hardened runtime → notarize → staple → zip.
#
#   MARKTILE_DEVELOPER_ID="Developer ID Application: <name> (<TEAM ID>)" \
#   MARKTILE_NOTARY_PROFILE=<profile> \
#   ./scripts/release-direct.sh [version] [build-number]
#
# No secret is written here or passed on a command line. The certificate lives in the login
# keychain; the notary credentials are a keychain profile, created once with
#
#   xcrun notarytool store-credentials <profile> --apple-id <id> --team-id <TEAM ID>
#
# (or --key/--key-id/--issuer for an App Store Connect API key), which asks for the password itself.
# Until a Developer ID certificate exists this stops at the first check, and says which.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "✗ $*" >&2; exit 1; }

IDENTITY="${MARKTILE_DEVELOPER_ID:-}"
NOTARY_PROFILE="${MARKTILE_NOTARY_PROFILE:-}"
[ -n "$IDENTITY" ] || fail "MARKTILE_DEVELOPER_ID is not set: the full name of a 'Developer ID Application' certificate (security find-identity -v -p codesigning lists what this keychain has)."
case "$IDENTITY" in
  "Developer ID Application:"*) ;;
  *) fail "\"$IDENTITY\" is not a Developer ID Application certificate; outside the App Store, Gatekeeper accepts nothing else." ;;
esac
security find-identity -v -p codesigning | grep -qF "\"$IDENTITY\"" \
  || fail "no valid signing identity named \"$IDENTITY\" in the keychain."
[ -n "$NOTARY_PROFILE" ] || fail "MARKTILE_NOTARY_PROFILE is not set: a keychain profile made with xcrun notarytool store-credentials."

export MARKTILE_VERSION="${1:-${MARKTILE_VERSION:-0.1.0}}"
export MARKTILE_BUILD_NUMBER="${2:-${MARKTILE_BUILD_NUMBER:-1}}"
OUT="$PWD/.build/release-direct"
APP="$OUT/marktile.app"
rm -rf "$OUT"
mkdir -p "$OUT"

./scripts/build-app.sh --channel direct release "$APP"

echo "▸ signing with $IDENTITY"
codesign --force --timestamp --options runtime \
  --entitlements entitlements/direct.entitlements --sign "$IDENTITY" "$APP"
codesign --verify --strict --deep --verbose=2 "$APP"

echo "▸ notarizing (this waits for Apple; minutes, usually)"
ditto -c -k --keepParent "$APP" "$OUT/notarize.zip"
# notarytool can exit 0 with a rejected submission, so the status is read, not the exit code.
RESULT="$(xcrun notarytool submit "$OUT/notarize.zip" --keychain-profile "$NOTARY_PROFILE" \
  --wait --output-format json)" || fail "notarytool submit did not complete."
STATUS="$(plutil -extract status raw -o - - <<<"$RESULT" 2>/dev/null || echo unknown)"
SUBMISSION="$(plutil -extract id raw -o - - <<<"$RESULT" 2>/dev/null || echo unknown)"
rm -f "$OUT/notarize.zip"
if [ "$STATUS" != "Accepted" ]; then
  echo "✗ notarization: $STATUS (submission $SUBMISSION). Apple's log:" >&2
  xcrun notarytool log "$SUBMISSION" --keychain-profile "$NOTARY_PROFILE" >&2 || true
  exit 1
fi

echo "▸ stapling"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
# The question a downloaded copy will be asked, asked here first.
spctl --assess --type execute --verbose=2 "$APP"

ZIP="$OUT/marktile-$MARKTILE_VERSION.zip"
ditto -c -k --keepParent "$APP" "$ZIP"
echo "✓ notarized and stapled: $ZIP"
