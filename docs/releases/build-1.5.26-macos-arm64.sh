#!/usr/bin/env bash
# Isolated quality candidate. Never installs or publishes the daily logger.
set -euo pipefail
fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ $(uname -s) == Darwin && $(uname -m) == arm64 ]] || fail "Use the Apple Silicon release Mac."
[[ $# == 1 && $1 =~ ^[0-9a-f]{40}$ ]] || fail "Pass the exact committed 1.5.26 source SHA."
expected=$1
root=$(cd "$(dirname "$0")/../.." && pwd -P)
canonical=$(cd "$HOME/Documents/Projects/OM0RX-xLog" && pwd -P)
[[ "$root" == "$canonical" ]] || fail "Use the canonical checkout."
cd "$root"
[[ $(git branch --show-current) == main && $(git rev-parse HEAD) == "$expected" ]] || fail "Wrong branch/source."
[[ -z $(git status --porcelain) ]] || fail "Preserve changes; packaging requires clean source."
git merge-base --is-ancestor 59cf0cfaef8ab47de2b3f8c6e6424f353c5f55d3 HEAD
git merge-base --is-ancestor 1dd4133057688969100e963f8216da07c8f01651 HEAD
git merge-base --is-ancestor 0d6ebf2aca01f233ec97758940c19a7666d7893e HEAD
git merge-base --is-ancestor 7798da53ca74c3d694833dd2b394b0fff30e6330 HEAD
git merge-base --is-ancestor d2d22afb419fe13710f71d36a27281e6879970a0 HEAD
git merge-base --is-ancestor cc2149ab974627388f4d2862d1996636e644cadd HEAD
git merge-base --is-ancestor e42d26d6adf8391a2c2a67584ec1a8b186e96a96 HEAD
git merge-base --is-ancestor d66fd267eeabc9a7c14ff3d0e3d3d0fee4b79d48 HEAD
git merge-base --is-ancestor 16c1b6f8a6959c6eea5940605a754e1122dbd997 HEAD
linux_cleanup_commit=795f77c2a48302fda632b6e7434f9e511423fb55
[[ "$linux_cleanup_commit" =~ ^[0-9a-f]{40}$ ]] || fail "Fill the exact pushed Linux cleanup QA commit before packaging."
git merge-base --is-ancestor "$linux_cleanup_commit" HEAD
git merge-base --is-ancestor d2f22973b86b6530acc7455aef694994478a603f HEAD
git merge-base --is-ancestor f53ab0ed27444d9280485489b70c1656713ee625 HEAD
git merge-base --is-ancestor 5eb2111735c1e4abf828980a1d397f26b662874a HEAD
git merge-base --is-ancestor c98a386a6612b9d6bdce8f4835163dd96345c5dc HEAD
git merge-base --is-ancestor e7fce13b093ccaa8b9c0a6e343aea3d162987f04 HEAD
[[ $(node -p "require('./prototype/package.json').version") == 1.5.26 ]] || fail "Unexpected version."
identity=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | sed -n '1p')
[[ -n "$identity" ]] || fail "No Developer ID signing identity."
export CODE_SIGN_IDENTITY="$identity"
out="$root/.build/releases/1.5.26"
name=OM0RX-xLog-1.5.26-macOS-arm64.zip
mkdir -p "$root/.build/releases"
mkdir "$out" || fail "Candidate output exists; preserve the prior run."
work=$(mktemp -d "$out/.verify.XXXXXXXX")
printf 'source=%s\nversion=1.5.26\nplatform=macOS-arm64\nsigning_identity=%s\n' "$expected" "$identity" > "$out/build-input.txt"
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
[[ $(plutil -extract CFBundleShortVersionString raw "$bundle/Contents/Info.plist") == 1.5.26 ]]
for executable in "$bundle/Contents/MacOS/xlog-prototype" "$worker"; do
  [[ $(lipo -archs "$executable") == arm64 ]] || fail "Unexpected architecture: $executable"
done
python3 - "$bundle/Contents/Resources/NativeBundleBuild.json" "$expected" <<'PY'
import json, sys
with open(sys.argv[1]) as stream:
    manifest = json.load(stream)
assert (manifest.get("sourceCommit"), manifest.get("version")) == (sys.argv[2], "1.5.26")
PY
XLOG_WORKER_BINARY="$worker" node --test Tests/XLogPrototypeTests/worker-process.test.mjs 2>&1 | tee "$out/signed-worker.tap"
[[ $(git rev-parse HEAD) == "$expected" && -z $(git status --porcelain) ]] || fail "Source changed during packaging."
(cd "$work" && shasum -a 256 "$name") > "$out/SHA256SUMS"
ln "$work/$name" "$out/$name"
rm -rf "$work"
printf 'Isolated candidate archive: %s/%s\n' "$out" "$name"
cat "$out/SHA256SUMS"
