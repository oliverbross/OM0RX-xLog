#!/usr/bin/env bash
# Isolated quality candidate. Never installs or publishes the daily logger.
set -euo pipefail
fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ $(uname -s) == Darwin && $(uname -m) == arm64 ]] || fail "Use the Apple Silicon release Mac."
[[ $# == 1 && $1 =~ ^[0-9a-f]{40}$ ]] || fail "Pass the exact committed 1.5.16 source SHA."
expected=$1
root=$(cd "$(dirname "$0")/../.." && pwd -P)
canonical=$(cd "$HOME/Documents/Projects/OM0RX-xLog" && pwd -P)
[[ "$root" == "$canonical" ]] || fail "Use the canonical checkout."
cd "$root"
[[ $(git branch --show-current) == main && $(git rev-parse HEAD) == "$expected" ]] || fail "Wrong branch/source."
[[ -z $(git status --porcelain) ]] || fail "Preserve changes; packaging requires clean source."
git merge-base --is-ancestor 26b32e8c1f5efedb78afa8b6dca64791e08fac79 HEAD
git merge-base --is-ancestor 1dd41330 HEAD
[[ $(node -p "require('./prototype/package.json').version") == 1.5.16 ]] || fail "Unexpected version."
identity=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | sed -n '1p')
[[ -n "$identity" ]] || fail "No Developer ID signing identity."
export CODE_SIGN_IDENTITY="$identity"
out="$root/.build/releases/1.5.16"
name=OM0RX-xLog-1.5.16-macOS-arm64.zip
mkdir -p "$root/.build/releases"
mkdir "$out" || fail "Candidate output exists; preserve the prior run."
work=$(mktemp -d "$out/.verify.XXXXXXXX")
printf 'source=%s\nversion=1.5.16\nplatform=macOS-arm64\nsigning_identity=%s\n' "$expected" "$identity" > "$out/build-input.txt"
bash prototype/scripts/package-macos.sh 2>&1 | tee "$out/build.log"
app=prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app
ditto -c -k --sequesterRsrc --keepParent "$app" "$work/$name"
ditto -x -k "$work/$name" "$work/extracted"
bundle="$work/extracted/OM0RX-xLog.app"
worker="$bundle/Contents/MacOS/xlog-prototype-worker"
codesign --verify --deep --strict "$bundle"
codesign -dv --verbose=4 "$bundle" 2> "$out/signature.txt"
grep -Fx "Authority=$identity" "$out/signature.txt" >/dev/null
codesign --verify --strict "$worker"
codesign -dv --verbose=4 "$worker" 2> "$out/worker-signature.txt"
grep -Fx "Authority=$identity" "$out/worker-signature.txt" >/dev/null
cp "$bundle/Contents/Resources/NativeBundleBuild.json" "$out/NativeBundleBuild.json"
cp prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog-payload-privacy.json "$out/payload-privacy.json"
(cd "$bundle/Contents/MacOS" && shasum -a 256 xlog-prototype xlog-prototype-worker) > "$out/executable-SHA256SUMS"
[[ $(plutil -extract CFBundleShortVersionString raw "$bundle/Contents/Info.plist") == 1.5.16 ]]
for executable in "$bundle/Contents/MacOS/xlog-prototype" "$worker"; do
  [[ $(lipo -archs "$executable") == arm64 ]] || fail "Unexpected architecture: $executable"
done
python3 - "$bundle/Contents/Resources/NativeBundleBuild.json" "$expected" <<'PY'
import json, sys
with open(sys.argv[1]) as stream:
    manifest = json.load(stream)
assert (manifest.get("sourceCommit"), manifest.get("version")) == (sys.argv[2], "1.5.16")
PY
XLOG_WORKER_BINARY="$worker" node --test Tests/XLogPrototypeTests/worker-process.test.mjs 2>&1 | tee "$out/signed-worker.tap"
[[ $(git rev-parse HEAD) == "$expected" && -z $(git status --porcelain) ]] || fail "Source changed during packaging."
(cd "$work" && shasum -a 256 "$name") > "$out/SHA256SUMS"
ln "$work/$name" "$out/$name"
rm -rf "$work"
printf 'Isolated candidate archive: %s/%s\n' "$out" "$name"
cat "$out/SHA256SUMS"
