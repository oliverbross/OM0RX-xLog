#!/usr/bin/env bash
# One macOS arm64 candidate, built from the canonical clean main checkout.
set -euo pipefail
fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ $(uname -s) == Darwin && $(uname -m) == arm64 ]] || fail "Use the Apple Silicon release Mac."
[[ $# == 1 && $1 =~ ^[0-9a-f]{40}$ ]] || fail "Pass the exact 1.5.5 release source commit."
expected=$1
root=$(cd "$(dirname "$0")/../.." && pwd -P)
canonical=$(cd "$HOME/Documents/Projects/OM0RX-xLog" && pwd -P)
[[ "$root" == "$canonical" ]] || fail "Use the canonical OM0RX-xLog checkout."
cd "$root"
[[ $(git branch --show-current) == main && $(git rev-parse HEAD) == "$expected" ]] || fail "Wrong branch or source commit."
[[ -z $(git status --porcelain) ]] || fail "Preserve existing changes; the release checkout must be clean."
git merge-base --is-ancestor 2a865d392d577d7d48096a91eca767d4c2e864d5 HEAD
[[ $(node -p "require('./prototype/package.json').version") == 1.5.5 ]] || fail "Unexpected version."

# Keep the established Developer ID requirement; do not silently fall back to ad hoc.
identity=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | sed -n '1p')
[[ -n "$identity" ]] || fail "No usable Developer ID Application signing identity in the release keychain."
export CODE_SIGN_IDENTITY="$identity"

out="$root/.build/releases/1.5.5"
name=OM0RX-xLog-1.5.5-macOS-arm64.zip
mkdir -p "$root/.build/releases"
mkdir "$out" || fail "Release directory exists. Preserve it and inspect the prior run."
work=$(mktemp -d "$out/.verify.XXXXXXXX")
printf 'source=%s\nversion=1.5.5\nplatform=macOS-arm64\nsigning_identity=%s\n' "$expected" "$identity" > "$out/build-input.txt"
printf 'Building from %s; logs in %s\n' "$expected" "$out"

bash prototype/scripts/package-macos.sh 2>&1 | tee "$out/build.log"
app=prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app
ditto -c -k --sequesterRsrc --keepParent "$app" "$work/$name"
ditto -x -k "$work/$name" "$work/extracted"
bundle="$work/extracted/OM0RX-xLog.app"
worker="$bundle/Contents/MacOS/xlog-prototype-worker"
codesign --verify --deep --strict "$bundle"
codesign -dv --verbose=4 "$bundle" 2> "$out/signature.txt"
grep -Fx "Authority=$identity" "$out/signature.txt" >/dev/null
[[ $(plutil -extract CFBundleShortVersionString raw "$bundle/Contents/Info.plist") == 1.5.5 ]]
for executable in "$bundle/Contents/MacOS/xlog-prototype" "$worker"; do
  [[ $(lipo -archs "$executable") == arm64 ]] || fail "Unexpected architecture: $executable"
done
python3 - "$bundle/Contents/Resources/NativeBundleBuild.json" "$expected" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    manifest = json.load(f)
if (manifest.get("sourceCommit"), manifest.get("version")) != (sys.argv[2], "1.5.5"):
    raise SystemExit("The extracted app does not match the release source/version.")
PY
# First invocation of the final signed worker uses the established isolated protocol.
XLOG_WORKER_BINARY="$worker" node --test Tests/XLogPrototypeTests/worker-process.test.mjs 2>&1 | tee "$out/signed-worker.tap"
[[ $(git rev-parse HEAD) == "$expected" && -z $(git status --porcelain) ]] || fail "Source changed during packaging."
(cd "$work" && shasum -a 256 "$name") > "$out/SHA256SUMS"
# Hard link publishes the verified ZIP without overwriting any existing download.
ln "$work/$name" "$out/$name"
rm -rf "$work"
printf 'Verified app archive: %s/%s\n' "$out" "$name"
cat "$out/SHA256SUMS"
