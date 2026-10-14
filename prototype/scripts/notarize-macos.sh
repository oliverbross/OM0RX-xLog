#!/usr/bin/env bash
# Notarize the already-built shared app; never rebuild the stable native app.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
bundle="$root/prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app"
profile="${NOTARY_PROFILE:-OM0RX-notary}"
version="$(plutil -extract CFBundleShortVersionString raw "$bundle/Contents/Info.plist")"
archive="$root/dist/OM0RX-xLog-$version-macOS-arm64.zip"
codesign --verify --deep --strict "$bundle"
case "${1:-submit}" in
  submit)
    mkdir -p "$root/dist"
    ditto -c -k --sequesterRsrc --keepParent "$bundle" "$archive"
    # Asynchronous submission keeps long Apple queue waits out of build tools.
    # Only the Keychain profile name is passed, never credential values.
    xcrun notarytool submit "$archive" --keychain-profile "$profile" --output-format json
    ;;
  staple)
    # Stapler fails unless Apple has issued a ticket for this exact signed app.
    xcrun stapler staple "$bundle"
    xcrun stapler validate "$bundle"
    codesign --verify --deep --strict "$bundle"
    spctl --assess --type execute --verbose=2 "$bundle"
    ditto -c -k --sequesterRsrc --keepParent "$bundle" "$archive"
    shasum -a 256 "$archive"
    ;;
  *) printf 'Usage: %s [submit|staple]\n' "$0" >&2; exit 2 ;;
esac
