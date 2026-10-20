#!/bin/bash
# Build a double-clickable marktile.app — no Xcode needed.
#
#   ./scripts/build-app.sh                          # release → /Applications/marktile.app
#   ./scripts/build-app.sh debug                    # faster debug build
#   ./scripts/build-app.sh release /tmp/marktile.app
#   ./scripts/build-app.sh --channel appstore       # sandboxed → .build/appstore/marktile.app
#
# Two channels, one binary. `appstore` is what ships: the App Sandbox. `dev` (the default) is the same
# binary without it — for working on the app, never released. The only difference this script makes
# is which file under entitlements/ goes into the signature; the code asks the running process whether
# it is sandboxed (FolderAccess.swift), so nothing else can drift between the two.
#
# The signature made here is ad-hoc (`codesign -s -`): enough to run locally with the channel's real
# entitlements, and replaced by scripts/release-appstore.sh with a real identity.
#
# Follows the same shape as andross/scripts/build-app.sh so the two apps release the same way.
set -euo pipefail
cd "$(dirname "$0")/.."

CHANNEL="dev"
POSITIONAL=()
while [ $# -gt 0 ]; do
  case "$1" in
    --channel) CHANNEL="${2:-}"; shift 2 ;;
    --channel=*) CHANNEL="${1#*=}"; shift ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done
set -- ${POSITIONAL[@]+"${POSITIONAL[@]}"}
case "$CHANNEL" in
  dev)      DEFAULT_DEST="/Applications/marktile.app" ;;
  # Not /Applications: two apps with one bundle identifier in the same place is how Finder ends up
  # opening a .md in the one you did not mean to test.
  appstore) DEFAULT_DEST="$PWD/.build/appstore/marktile.app" ;;
  *) echo "✗ --channel must be dev or appstore (got '$CHANNEL')" >&2; exit 2 ;;
esac

CONFIG="${1:-release}"
DEST="${2:-$DEFAULT_DEST}"
ENTITLEMENTS="entitlements/$CHANNEL.entitlements"
# CFBundleShortVersionString is the version people see; CFBundleVersion is the build number, which
# App Store Connect requires to go up on every upload. The release scripts pass both.
VERSION="${MARKTILE_VERSION:-0.1.0}"
BUILD_NUMBER="${MARKTILE_BUILD_NUMBER:-1}"

# The engine is never committed under Resources/ — pull it from the repo's single sources first.
bash scripts/sync-engine.sh

# Every language the engine speaks, with every key English has — before spending a build on it.
python3 scripts/check-l10n.py

echo "▸ [$CHANNEL] swift build -c $CONFIG --product MarktileApp"
swift build -c "$CONFIG" --product MarktileApp
BIN=".build/$CONFIG/MarktileApp"

rm -rf "$DEST"
mkdir -p "$DEST/Contents/MacOS" "$DEST/Contents/Resources"
cp "$BIN" "$DEST/Contents/MacOS/MarktileApp"

# SwiftPM resource bundles carry Web/ and Engine/ — without them the app still runs on the machine
# that built it (Bundle.module quietly falls back to .build/) and shows a blank window everywhere
# else, which is the only kind of machine a release lands on.
for bundle in ".build/$CONFIG"/*.bundle; do
  [ -e "$bundle" ] && cp -R "$bundle" "$DEST/Contents/Resources/"
done

# The icon is generated (icon/make-icon.swift) and the result committed, so a build needs no drawing.
cp icon/AppIcon.icns "$DEST/Contents/Resources/AppIcon.icns"

# Localizations go in the MAIN bundle: AppKit's own menu items and the system's per-app language list
# both follow the main bundle's .lproj folders (see Localization.swift). CFBundleLocalizations is
# derived from the same folders so the two cannot disagree.
cp -R Localization/*.lproj "$DEST/Contents/Resources/"
LOCALIZATIONS=""
for lproj in Localization/*.lproj; do
  LOCALIZATIONS="$LOCALIZATIONS<string>$(basename "$lproj" .lproj)</string>"
done

cat > "$DEST/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>marktile</string>
  <key>CFBundleDisplayName</key><string>marktile</string>
  <key>CFBundleIdentifier</key><string>net.cver.marktile</string>
  <key>CFBundleExecutable</key><string>MarktileApp</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleLocalizations</key><array>${LOCALIZATIONS}</array>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${BUILD_NUMBER}</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>ITSAppUsesNonExemptEncryption</key><false/>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHumanReadableCopyright</key><string>© CVER Inc.</string>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>Markdown Document</string>
      <key>CFBundleTypeRole</key><string>Editor</string>
      <key>LSHandlerRank</key><string>Default</string>
      <key>NSDocumentClass</key><string>MarkdownDocument</string>
      <key>LSItemContentTypes</key>
      <array><string>net.daringfireball.markdown</string></array>
    </dict>
  </array>
  <key>UTImportedTypeDeclarations</key>
  <array>
    <dict>
      <key>UTTypeIdentifier</key><string>net.daringfireball.markdown</string>
      <key>UTTypeDescription</key><string>Markdown Document</string>
      <key>UTTypeConformsTo</key>
      <array><string>public.plain-text</string></array>
      <key>UTTypeTagSpecification</key>
      <dict>
        <key>public.filename-extension</key>
        <array>
          <string>md</string><string>markdown</string>
          <string>mdown</string><string>mkd</string><string>mdtext</string>
        </array>
        <key>public.mime-type</key><array><string>text/markdown</string></array>
      </dict>
    </dict>
  </array>
</dict>
</plist>
PLIST

chmod +x "$DEST/Contents/MacOS/MarktileApp"
python3 scripts/check-l10n.py "$DEST"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

# Sign BEFORE the checks below, so they run the binary as it will ship: with the hardened runtime,
# and — for appstore — inside the sandbox. An unsigned run would pass checks the signed app fails.
echo "▸ signing ad-hoc with $ENTITLEMENTS"
codesign --force --sign - --options runtime --entitlements "$ENTITLEMENTS" "$DEST"
codesign --verify --strict --deep "$DEST"

# Ask the installed binary, from its install path, whether it can find its own engine — the exact
# lookup the app performs at launch, no window and no run loop (see EngineResources.swift).
#
# The check this replaces asserted that a path of the SCRIPT's choosing existed. It was green for
# months while the app was actually loading its engine out of the developer's .build directory,
# because nothing ever compared the script's idea of "installed" with the code's. A check whose
# subject is not the code cannot fail for the reason you care about.
echo "▸ verifying the app can load its engine from $DEST"
"$DEST/Contents/MacOS/MarktileApp" --verify-resources

# The entitlements in the signature are a claim; whether the sandbox applied is something only the
# running process knows. Ask it, and refuse a build where the two disagree.
SANDBOX_REPORT="$("$DEST/Contents/MacOS/MarktileApp" --report-sandbox)"
echo "$SANDBOX_REPORT" | sed 's/^/  /'
WANT="no"; [ "$CHANNEL" = "appstore" ] && WANT="yes"
if ! echo "$SANDBOX_REPORT" | grep -qx "sandboxed: $WANT"; then
  echo "✗ $CHANNEL build should run with sandboxed: $WANT" >&2
  exit 1
fi

echo "✓ built $DEST ($CHANNEL, ad-hoc signed)"
if [ "$CHANNEL" = "dev" ]; then
  echo "  Double-click it in Finder (ad-hoc signed: right-click → Open the first time on another Mac)."
else
  echo "  Sandboxed. To ship it: scripts/release-appstore.sh (needs the certificates; see README)."
fi
