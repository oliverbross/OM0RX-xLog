#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
node --test prototype/scripts/mac-worker-packaging.check.mjs
bash prototype/scripts/build-worker.sh
node prototype/scripts/stage-worker.mjs
bash prototype/scripts/stage-hamlib-macos.sh
node prototype/scripts/distribution-metadata.mjs
cd prototype
npx tauri build --bundles app

# Prefer a stable Developer ID requirement when this Mac has one. Keychain ACLs
# otherwise bind saved workspace credentials to each changing ad-hoc CDHash and
# ask the operator to authorize the rebuilt worker again. CI and unsigned
# development hosts still fall back to ad-hoc signing; notarization remains a
# separate acceptance step, never inferred from a valid code signature.
bundle="$root/prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app"
binary_dir="$(XLOG_PORTABLE_ONLY=1 swift build --build-system xcode --package-path "$root" --scratch-path "$root/.build/prototype-worker" -c release --show-bin-path)"
ditto "$binary_dir/OM0RXXLogPrototype_XLogCore.bundle" "$bundle/Contents/Resources/OM0RXXLogPrototype_XLogCore.bundle"
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
sign_component "$bundle/Contents/MacOS/xlog-prototype-worker" "com.oliverbross.xlog.integration.worker"
sign_component "$bundle/Contents/MacOS/rigctld" "com.oliverbross.xlog.integration.rigctld"
sign_component "$bundle/Contents/MacOS/rotctld" "com.oliverbross.xlog.integration.rotctld"
if [ "$signing_identity" = - ]; then
  codesign --force --sign - --timestamp=none "$bundle"
else
  codesign --force --options runtime --timestamp --sign "$signing_identity" "$bundle"
fi
codesign --verify --deep --strict "$bundle"
printf 'OM0RX-xLog bundle verified (notarization separate): %s\n' "$bundle"
