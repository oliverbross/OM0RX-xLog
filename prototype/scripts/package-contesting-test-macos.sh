#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
build_jobs=2
export CARGO_BUILD_JOBS="$build_jobs"
export XLOG_HAMLIB_BUILD_JOBS="$build_jobs"
cd "$root"
node --test prototype/scripts/mac-worker-packaging.check.mjs
bash prototype/scripts/build-worker.sh -j "$build_jobs"
node prototype/scripts/stage-worker.mjs
bash prototype/scripts/stage-hamlib-macos.sh
node prototype/scripts/distribution-metadata.mjs
cd prototype
npx tauri build --features contesting-test --config src-tauri/tauri.contesting-test.conf.json --bundles app

bundle="$root/prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog Contesting Test.app"
test -d "$bundle"
test "$(plutil -extract CFBundleIdentifier raw "$bundle/Contents/Info.plist")" = "com.oliverbross.xlog.contesting-test"
test "$(plutil -extract CFBundleDisplayName raw "$bundle/Contents/Info.plist")" = "OM0RX-xLog Contesting Test"
if plutil -extract CFBundleURLTypes xml1 -o - "$bundle/Contents/Info.plist" | grep -q '<string>om0rx-xlog</string>'; then
  printf 'Production URL scheme leaked into Contesting Test bundle.\n' >&2
  exit 1
fi

binary_dir="$(XLOG_PORTABLE_ONLY=1 swift build --build-system xcode -j "$build_jobs" --package-path "$root" --scratch-path "$root/.build/prototype-worker" -c release --show-bin-path)"
rm -rf "$bundle/Contents/Resources/OM0RXXLogPrototype_XLogCore.bundle" "$bundle/Contents/Resources/OM0RXXLogPrototype_XContestCore.bundle"
ditto "$binary_dir/OM0RXXLogPrototype_XLogCore.bundle" "$bundle/Contents/Resources/OM0RXXLogPrototype_XLogCore.bundle"
ditto "$binary_dir/OM0RXXLogPrototype_XContestCore.bundle" "$bundle/Contents/Resources/OM0RXXLogPrototype_XContestCore.bundle"
ditto "$root/prototype/src-tauri/binaries/hamlib-4.7.2-notices" "$bundle/Contents/Resources/Hamlib-Licenses"
ditto "$root/prototype/distribution-metadata" "$bundle/Contents/Resources/DistributionMetadata"

signing_identity="${CODE_SIGN_IDENTITY:--}"
codesign --force --identifier "com.oliverbross.xlog.contesting-test.worker" --sign "$signing_identity" --timestamp=none "$bundle/Contents/MacOS/xlog-prototype-worker"
codesign --force --sign "$signing_identity" --timestamp=none "$bundle"
codesign --verify --deep --strict "$bundle"
printf 'Isolated test bundle verified (not installed or launched): %s\n' "$bundle"
