#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
bash prototype/scripts/build-worker.sh
node prototype/scripts/stage-worker.mjs
cd prototype
npx tauri build --bundles app

# Developer-only, ad-hoc signing. This does not use Apple credentials and is
# not Developer ID signing, notarization or clean-machine acceptance.
bundle="$root/prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog Prototype.app"
codesign --force --sign - --timestamp=none "$bundle/Contents/MacOS/xlog-prototype-worker"
codesign --force --sign - --timestamp=none "$bundle"
codesign --verify --deep --strict "$bundle"
printf 'Development prototype verified: %s\n' "$bundle"
