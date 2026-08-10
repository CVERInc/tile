#!/bin/bash
# Build a double-clickable marktile.app — no Xcode needed.
#
#   ./scripts/build-app.sh                          # release → /Applications/marktile.app
#   ./scripts/build-app.sh debug                    # faster debug build
#   ./scripts/build-app.sh release /tmp/marktile.app
#
# Follows the same shape as andross/scripts/build-app.sh so the two apps release the same way.
set -euo pipefail
cd "$(dirname "$0")/.."

CONFIG="${1:-release}"
DEST="${2:-/Applications/marktile.app}"
VERSION="0.1.0"

# The engine is never committed under Resources/ — pull it from the repo's single sources first.
bash scripts/sync-engine.sh

echo "▸ swift build -c $CONFIG --product MarktileApp"
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

cat > "$DEST/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>marktile</string>
  <key>CFBundleDisplayName</key><string>marktile</string>
  <key>CFBundleIdentifier</key><string>net.cver.marktile</string>
  <key>CFBundleExecutable</key><string>MarktileApp</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>1</string>
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
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

# Ask the installed binary, from its install path, whether it can find its own engine — the exact
# lookup the app performs at launch, no window and no run loop (see EngineResources.swift).
#
# The check this replaces asserted that a path of the SCRIPT's choosing existed. It was green for
# months while the app was actually loading its engine out of the developer's .build directory,
# because nothing ever compared the script's idea of "installed" with the code's. A check whose
# subject is not the code cannot fail for the reason you care about.
echo "▸ verifying the app can load its engine from $DEST"
"$DEST/Contents/MacOS/MarktileApp" --verify-resources

echo "✓ built $DEST"
echo "  Double-click it in Finder (unsigned for now: right-click → Open the first time)."
