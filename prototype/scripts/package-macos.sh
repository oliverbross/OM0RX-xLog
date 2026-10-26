#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
test "$(git branch --show-current)" = main
git diff --quiet
git diff --cached --quiet
test -z "$(git ls-files --others --exclude-standard)"
export XLOG_SOURCE_COMMIT="$(git rev-parse HEAD)"
node --test prototype/scripts/mac-worker-packaging.check.mjs
python3 prototype/scripts/cw-macos.py prepare
bash prototype/scripts/build-worker.sh
node prototype/scripts/stage-worker.mjs
bash prototype/scripts/stage-hamlib-macos.sh
node prototype/scripts/distribution-metadata.mjs
# Tauri embeds the built frontend in the application crate. Cargo can otherwise
# reuse a release executable when a content-changed chunk keeps the same name.
cargo clean --manifest-path "$root/prototype/src-tauri/Cargo.toml" -p xlog-prototype
cd prototype
npx tauri build --bundles app

# Prefer a stable Developer ID requirement when this Mac has one. Keychain ACLs
# otherwise bind saved workspace credentials to each changing ad-hoc CDHash and
# ask the operator to authorize the rebuilt worker again. CI and unsigned
# development hosts still fall back to ad-hoc signing; notarization remains a
# separate acceptance step, never inferred from a valid code signature.
bundle="$root/prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app"
test "$(plutil -extract NSMicrophoneUsageDescription raw "$bundle/Contents/Info.plist")" = \
  "OM0RX-xLog records an operator-selected contest audio input and optional local voice-keyer messages."
bash "$root/prototype/scripts/stage-contest-python-macos.sh" "$bundle"
python3 "$root/prototype/scripts/cw-macos.py" stage --bundle "$bundle"
binary_dir="$(XLOG_PORTABLE_ONLY=1 swift build --build-system xcode --package-path "$root" --scratch-path "$root/.build/prototype-worker" -c release --show-bin-path)"
rm -rf "$bundle/Contents/Resources/OM0RXXLogPrototype_XLogCore.bundle" "$bundle/Contents/Resources/OM0RXXLogPrototype_XContestCore.bundle"
ditto "$binary_dir/OM0RXXLogPrototype_XLogCore.bundle" "$bundle/Contents/Resources/OM0RXXLogPrototype_XLogCore.bundle"
ditto "$binary_dir/OM0RXXLogPrototype_XContestCore.bundle" "$bundle/Contents/Resources/OM0RXXLogPrototype_XContestCore.bundle"
ditto "$root/prototype/src-tauri/binaries/hamlib-4.7.2-notices" "$bundle/Contents/Resources/Hamlib-Licenses"
ditto "$root/prototype/distribution-metadata" "$bundle/Contents/Resources/DistributionMetadata"
signing_identity="${CODE_SIGN_IDENTITY:-}"
if [[ -z "$signing_identity" ]]; then
  identity_output="$(security find-identity -v -p codesigning 2>/dev/null || true)"
  signing_identity="$(printf '%s\n' "$identity_output" | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | sed -n '1p')"
fi
signing_identity="${signing_identity:--}"
sign_component() {
  local component="$1"
  local identifier="$2"
  if [ "$signing_identity" = - ]; then
    codesign --force --identifier "$identifier" --sign - --timestamp=none "$component"
  else
    codesign --force --identifier "$identifier" --options runtime --timestamp --sign "$signing_identity" "$component"
  fi
}
while IFS= read -r -d '' component; do
  case "$component" in
    *.a|*.o) continue ;;
  esac
  if file "$component" | grep -q 'Mach-O'; then
    if [ "$signing_identity" = - ]; then
      codesign --force --sign - --timestamp=none "$component"
    else
      codesign --force --options runtime --timestamp --sign "$signing_identity" "$component"
    fi
  fi
done < <(find "$bundle/Contents/Frameworks/Python.framework" -type f -print0)
sign_component "$bundle/Contents/Frameworks/Python.framework/Versions/3.12/Resources/Python.app" "com.oliverbross.xlog.integration.python.helper"
sign_component "$bundle/Contents/Frameworks/Python.framework" "com.oliverbross.xlog.integration.python"
"$bundle/Contents/Frameworks/Python.framework/Versions/3.12/bin/python3.12" -I -B \
  "$root/prototype/scripts/relocate-contest-python.py" --bundle "$bundle" --finalize-provenance
sign_component "$bundle/Contents/MacOS/xlog-prototype-worker" "com.oliverbross.xlog.integration.worker"
sign_component "$bundle/Contents/Frameworks/libonnxruntime.dylib" "com.oliverbross.xlog.integration.cw.runtime"
sign_component "$bundle/Contents/MacOS/xlog-cw-worker" "com.oliverbross.xlog.integration.cw.worker"
python3 "$root/prototype/scripts/cw-macos.py" finalize --bundle "$bundle"
sign_component "$bundle/Contents/MacOS/rigctld" "com.oliverbross.xlog.integration.rigctld"
sign_component "$bundle/Contents/MacOS/rotctld" "com.oliverbross.xlog.integration.rotctld"
if [ "$signing_identity" = - ]; then
  codesign --force --entitlements "$root/prototype/src-tauri/Recorder.entitlements" --sign - --timestamp=none "$bundle"
else
  codesign --force --options runtime --entitlements "$root/prototype/src-tauri/Recorder.entitlements" --timestamp --sign "$signing_identity" "$bundle"
fi
codesign --verify --deep --strict "$bundle"
python3 "$root/prototype/scripts/cw-macos.py" verify --bundle "$bundle"
printf 'OM0RX-xLog bundle verified (notarization separate): %s\n' "$bundle"
