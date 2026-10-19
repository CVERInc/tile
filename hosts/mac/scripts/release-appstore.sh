#!/bin/bash
# Mac App Store release: build the sandboxed channel → embed the provisioning profile → sign →
# productbuild a signed .pkg → validate and upload to App Store Connect.
#
#   MARKTILE_APPSTORE_APP_IDENTITY="<Apple Distribution or 3rd Party Mac Developer Application certificate>" \
#   MARKTILE_APPSTORE_INSTALLER_IDENTITY="<3rd Party Mac Developer Installer certificate>" \
#   MARKTILE_APPSTORE_PROFILE=/path/to/marktile_AppStore.provisionprofile \
#   MARKTILE_ASC_KEY_ID=<API key id> MARKTILE_ASC_ISSUER_ID=<issuer id> \
#   ./scripts/release-appstore.sh <version> <build-number>
#
# Certificate names are parameters, not guesses: pass exactly what `security find-identity -v` shows.
# The upload authenticates with an App Store Connect API key; altool looks for its
# AuthKey_<key id>.p8 in ~/.appstoreconnect/private_keys (or ~/private_keys), so the key never
# appears here or on a command line. MARKTILE_UPLOAD=0 stops after the .pkg, for uploading with
# Transporter instead.
#
# The build number must go up on every upload — App Store Connect refuses a repeat.
# Until the certificates and profile exist this stops at the first check, and says which.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "✗ $*" >&2; exit 1; }

APP_IDENTITY="${MARKTILE_APPSTORE_APP_IDENTITY:-}"
PKG_IDENTITY="${MARKTILE_APPSTORE_INSTALLER_IDENTITY:-}"
PROFILE="${MARKTILE_APPSTORE_PROFILE:-}"
UPLOAD="${MARKTILE_UPLOAD:-1}"
[ -n "$APP_IDENTITY" ] || fail "MARKTILE_APPSTORE_APP_IDENTITY is not set: the App Store application-signing certificate (security find-identity -v -p codesigning)."
security find-identity -v -p codesigning | grep -qF "\"$APP_IDENTITY\"" \
  || fail "no valid signing identity named \"$APP_IDENTITY\" in the keychain."
[ -n "$PKG_IDENTITY" ] || fail "MARKTILE_APPSTORE_INSTALLER_IDENTITY is not set: the installer certificate that signs the .pkg."
# Installer certificates are not code-signing identities, so find-identity -p codesigning never lists them.
security find-certificate -c "$PKG_IDENTITY" >/dev/null 2>&1 \
  || fail "no certificate named \"$PKG_IDENTITY\" in the keychain."
[ -n "$PROFILE" ] || fail "MARKTILE_APPSTORE_PROFILE is not set: the Mac App Store provisioning profile for this app."
[ -f "$PROFILE" ] || fail "no provisioning profile at $PROFILE."
if [ "$UPLOAD" != "0" ]; then
  [ -n "${MARKTILE_ASC_KEY_ID:-}" ] && [ -n "${MARKTILE_ASC_ISSUER_ID:-}" ] \
    || fail "MARKTILE_ASC_KEY_ID and MARKTILE_ASC_ISSUER_ID are not set (or set MARKTILE_UPLOAD=0 to stop at the .pkg)."
fi

export MARKTILE_VERSION="${1:-${MARKTILE_VERSION:-0.1.0}}"
export MARKTILE_BUILD_NUMBER="${2:-${MARKTILE_BUILD_NUMBER:-1}}"
OUT="$PWD/.build/release-appstore"
APP="$OUT/marktile.app"
PKG="$OUT/marktile-$MARKTILE_VERSION-$MARKTILE_BUILD_NUMBER.pkg"
rm -rf "$OUT"
mkdir -p "$OUT"

# The profile is a signed plist; its entitlements say which app and team it is for.
security cms -D -i "$PROFILE" > "$OUT/profile.plist" || fail "could not decode $PROFILE."
pb() { /usr/libexec/PlistBuddy -c "Print :$1" "$OUT/profile.plist" 2>/dev/null; }
APP_ID="$(pb Entitlements:com.apple.application-identifier || pb Entitlements:application-identifier || true)"
TEAM_ID="$(pb Entitlements:com.apple.developer.team-identifier || true)"
[ -n "$APP_ID" ] && [ -n "$TEAM_ID" ] || fail "the profile names no application or team identifier."
# A development or Developer ID profile lists devices; one for the store does not.
if pb ProvisionedDevices >/dev/null || pb ProvisionsAllDevices >/dev/null; then
  fail "$PROFILE is not a Mac App Store distribution profile (it provisions devices)."
fi

./scripts/build-app.sh --channel appstore release "$APP"

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")"
[ "$APP_ID" = "$TEAM_ID.$BUNDLE_ID" ] \
  || fail "the profile is for $APP_ID; this app is $TEAM_ID.$BUNDLE_ID."
# App Store Connect rejects a bundle without an icon. build-app.sh puts one in; this catches a build
# that lost it, here rather than after an upload.
/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$APP/Contents/Info.plist" >/dev/null 2>&1 \
  || /usr/libexec/PlistBuddy -c 'Print :CFBundleIconName' "$APP/Contents/Info.plist" >/dev/null 2>&1 \
  || fail "the app has no icon (CFBundleIconFile / CFBundleIconName); App Store Connect will refuse it."

cp "$PROFILE" "$APP/Contents/embedded.provisionprofile"

# The committed entitlements plus the two identifiers only the profile knows. Signing with a
# sandbox but without these is the classic upload rejection: the profile and signature disagree.
ENT="$OUT/signing.entitlements"
cp entitlements/appstore.entitlements "$ENT"
/usr/libexec/PlistBuddy -c "Add :com.apple.application-identifier string $APP_ID" "$ENT"
/usr/libexec/PlistBuddy -c "Add :com.apple.developer.team-identifier string $TEAM_ID" "$ENT"

echo "▸ signing with $APP_IDENTITY"
codesign --force --timestamp --options runtime --entitlements "$ENT" --sign "$APP_IDENTITY" "$APP"
codesign --verify --strict --deep --verbose=2 "$APP"
codesign -d --entitlements - --xml "$APP" 2>/dev/null | plutil -p - | grep -q '"com.apple.security.app-sandbox" => true' \
  || fail "the signed app does not carry the App Sandbox entitlement."

echo "▸ productbuild with $PKG_IDENTITY"
productbuild --component "$APP" /Applications --sign "$PKG_IDENTITY" "$PKG"
pkgutil --check-signature "$PKG"

if [ "$UPLOAD" = "0" ]; then
  echo "✓ $PKG (not uploaded: MARKTILE_UPLOAD=0)"
  exit 0
fi
echo "▸ validating with App Store Connect"
xcrun altool --validate-app -f "$PKG" -t macos \
  --apiKey "$MARKTILE_ASC_KEY_ID" --apiIssuer "$MARKTILE_ASC_ISSUER_ID"
echo "▸ uploading"
xcrun altool --upload-app -f "$PKG" -t macos \
  --apiKey "$MARKTILE_ASC_KEY_ID" --apiIssuer "$MARKTILE_ASC_ISSUER_ID"
echo "✓ uploaded $PKG — it appears in App Store Connect after processing."
