#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
node --test prototype/scripts/mac-worker-packaging.test.mjs
bash prototype/scripts/build-worker.sh
node prototype/scripts/stage-worker.mjs
bash prototype/scripts/stage-hamlib-macos.sh
node prototype/scripts/distribution-metadata.mjs
cd prototype
npx tauri build --bundles app

# CI/development defaults to ad-hoc signing. An explicitly selected Developer
# ID identity enables hardened-runtime release signing; notarization remains a
# separate acceptance step, never inferred from a valid code signature.
bundle="$root/prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog Integration.app"
binary_dir="$(XLOG_PORTABLE_ONLY=1 swift build --build-system xcode --package-path "$root" --scratch-path "$root/.build/prototype-worker" -c release --show-bin-path)"
ditto "$binary_dir/OM0RXXLogPrototype_XLogCore.bundle" "$bundle/Contents/Resources/OM0RXXLogPrototype_XLogCore.bundle"
ditto "$root/prototype/src-tauri/binaries/hamlib-4.7.2-notices" "$bundle/Contents/Resources/Hamlib-Licenses"
ditto "$root/prototype/distribution-metadata" "$bundle/Contents/Resources/DistributionMetadata"
signing_identity="${CODE_SIGN_IDENTITY:--}"
for component in "$bundle/Contents/MacOS/xlog-prototype-worker" "$bundle/Contents/MacOS/rigctld" "$bundle/Contents/MacOS/rotctld" "$bundle"; do
  if [ "$signing_identity" = - ]; then
    codesign --force --sign - --timestamp=none "$component"
  else
    codesign --force --options runtime --timestamp --sign "$signing_identity" "$component"
  fi
done
codesign --verify --deep --strict "$bundle"
printf 'Integration bundle verified (notarization separate): %s\n' "$bundle"
