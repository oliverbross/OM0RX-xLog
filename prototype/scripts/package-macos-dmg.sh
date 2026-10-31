#!/usr/bin/env bash
# Create a public installer from an already accepted application; never build here.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd -P)"
cd "$root"
test "$(uname -s)" = Darwin
test "$(git branch --show-current)" = main
git diff --quiet
git diff --cached --quiet
test -z "$(git ls-files --others --exclude-standard)"
bundle="${1:-$root/prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app}"
output="${2:-$root/prototype/dist-macos}"
profile="${XLOG_NOTARY_PROFILE:-OM0RX-notary}"
bundle="$(cd "$bundle" && pwd -P)"
test "$bundle" = "$root/prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app"
mkdir -p "$output"
output="$(cd "$output" && pwd -P)"
case "$output/" in "$bundle/"*) echo 'DMG output cannot be inside the accepted application' >&2; exit 1 ;; esac
version="$(plutil -extract CFBundleShortVersionString raw "$bundle/Contents/Info.plist")"
commit="$(git rev-parse HEAD)"
expected_version="$(node -p 'JSON.parse(require("fs").readFileSync("prototype/package.json","utf8")).version')"
test "$version" = "$expected_version"
python3 - "$bundle" "$commit" <<'PY'
import json, pathlib, sys
metadata = json.loads((pathlib.Path(sys.argv[1]) / 'Contents/Resources/DistributionMetadata/components.json').read_text())
assert metadata['sourceCommit'] == sys.argv[2], 'Application source differs from canonical checkout'
PY
codesign --verify --deep --strict "$bundle"
signing_info="$(codesign --display --verbose=4 "$bundle" 2>&1)"
grep -q '^Authority=Developer ID Application:' <<< "$signing_info"
app_team="$(sed -n 's/^TeamIdentifier=//p' <<< "$signing_info")"
[[ "$app_team" =~ ^[A-Z0-9]{10}$ ]]
main_executable="$(plutil -extract CFBundleExecutable raw "$bundle/Contents/Info.plist")"
lipo -verify_arch arm64 "$bundle/Contents/MacOS/$main_executable"
lipo -verify_arch arm64 "$bundle/Contents/MacOS/xlog-prototype-worker"
xcrun stapler validate "$bundle"
spctl --assess --type execute --verbose=2 "$bundle"
dmg="$output/OM0RX-xLog-$version-Beta-macOS-arm64.dmg"
test ! -e "$dmg"
python3 "$root/prototype/scripts/verify-release-payload.py" "$bundle" \
  --report "$output/OM0RX-xLog-$version-macOS-payload-privacy.json"
stage="$(mktemp -d "$output/.dmg-stage.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
ditto "$bundle" "$stage/OM0RX-xLog.app"
ln -s /Applications "$stage/Applications"
cat > "$stage/Install.txt" <<'TEXT'
Drag OM0RX-xLog to Applications, then launch it from Applications.
First launch asks for your station identity and optional radio, rotator and Wavelog setup.
This installer contains application files only. Existing logs and settings stay in your user profile.
Questions, improvements and bugs: Oliver Bross, OM0RX, oliver@bross.eu
TEXT
hdiutil create -volname "OM0RX-xLog $version Beta" -srcfolder "$stage" -ov -format UDZO "$dmg"
identity="${CODE_SIGN_IDENTITY:-}"
if [[ -z "$identity" ]]; then
  identity="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | grep -F "($app_team)" | sed -n '1p')"
fi
test -n "$identity"
codesign --force --sign "$identity" --timestamp "$dmg"
codesign --verify --strict "$dmg"
dmg_team="$(codesign --display --verbose=4 "$dmg" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
test "$dmg_team" = "$app_team"
xcrun notarytool submit "$dmg" --keychain-profile "$profile" --output-format json > "$dmg.notary-submission.json"
submission="$(python3 - "$dmg.notary-submission.json" <<'PY'
import json, sys
print(json.load(open(sys.argv[1]))['id'])
PY
)"
# Preserve the identity before waiting: a timeout must be resumed, never resubmitted.
xcrun notarytool wait "$submission" --keychain-profile "$profile" --timeout 20m --output-format json > "$dmg.notary-wait.json"
xcrun notarytool info "$submission" --keychain-profile "$profile" --output-format json > "$dmg.notary-info.json"
python3 - "$dmg.notary-info.json" <<'PY'
import json, sys
assert json.load(open(sys.argv[1]))['status'] == 'Accepted', 'DMG notarization was not accepted'
PY
xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
hdiutil verify "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
shasum -a 256 "$dmg" | sed "s|$output/||" > "$dmg.sha256"
python3 - "$dmg" "$version" "$commit" "$submission" <<'PY'
import hashlib, json, pathlib, sys
path = pathlib.Path(sys.argv[1])
report = {'schema': 1, 'product': 'OM0RX-xLog Beta', 'version': sys.argv[2], 'sourceCommit': sys.argv[3],
          'platform': 'macOS-arm64', 'installer': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
          'notarySubmission': sys.argv[4], 'signing': 'Developer ID Application; Apple notarized and stapled',
          'contents': 'Signed application, Applications shortcut, installation instructions; no operator profile data'}
path.with_suffix(path.suffix + '.provenance.json').write_text(json.dumps(report, indent=2) + '\n')
PY
printf 'Accepted macOS installer: %s\n' "$dmg"
