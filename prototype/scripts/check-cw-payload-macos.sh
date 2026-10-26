#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
fixture="$root/.build/cw-payload-fixture"
# This is a disposable native payload fixture, never an application candidate.
test ! -e "$fixture/Contents/Info.plist"
python3 prototype/scripts/cw-macos.py prepare "$@"
mkdir -p "$fixture/Contents/MacOS"
python3 prototype/scripts/cw-macos.py stage --bundle "$fixture"
codesign --force --sign - --timestamp=none "$fixture/Contents/Frameworks/libonnxruntime.dylib"
codesign --force --sign - --timestamp=none "$fixture/Contents/MacOS/xlog-cw-worker"
python3 prototype/scripts/cw-macos.py finalize --bundle "$fixture"
python3 prototype/scripts/cw-payload.check.py "$fixture"
