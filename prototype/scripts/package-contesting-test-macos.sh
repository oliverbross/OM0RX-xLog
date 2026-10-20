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
# Force the application crate to re-embed the frontend selected by this source
# checkout even when the bundler reuses a content chunk filename.
cargo clean --manifest-path "$root/prototype/src-tauri/Cargo.toml" -p xlog-prototype
cd prototype
npx tauri build --features contesting-test --config src-tauri/tauri.contesting-test.conf.json --bundles app

bundle="$root/prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog Contesting Test.app"
bash "$root/prototype/scripts/stage-contest-python-macos.sh" "$bundle" "package-contesting-test-macos.sh"
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
  if file "$component" | grep -q 'Mach-O'; then
    if [ "$signing_identity" = - ]; then
      codesign --force --sign - --timestamp=none "$component"
    else
      codesign --force --options runtime --timestamp --sign "$signing_identity" "$component"
    fi
  fi
done < <(find "$bundle/Contents/Frameworks/Python.framework" -type f -print0)
sign_component "$bundle/Contents/Frameworks/Python.framework/Versions/3.12/Resources/Python.app" "com.oliverbross.xlog.contesting-test.python.helper"
sign_component "$bundle/Contents/Frameworks/Python.framework" "com.oliverbross.xlog.contesting-test.python"
"$bundle/Contents/Frameworks/Python.framework/Versions/3.12/bin/python3.12" -I -B \
  "$root/prototype/scripts/relocate-contest-python.py" --bundle "$bundle" --finalize-provenance \
  --packaging-script "package-contesting-test-macos.sh"
sign_component "$bundle/Contents/MacOS/xlog-prototype-worker" "com.oliverbross.xlog.contesting-test.worker"
sign_component "$bundle/Contents/MacOS/rigctld" "com.oliverbross.xlog.contesting-test.rigctld"
sign_component "$bundle/Contents/MacOS/rotctld" "com.oliverbross.xlog.contesting-test.rotctld"
sign_component "$bundle" "com.oliverbross.xlog.contesting-test"
codesign --verify --deep --strict "$bundle"
printf 'Isolated test bundle verified (not installed or launched): %s\n' "$bundle"
