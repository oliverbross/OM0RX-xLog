#!/usr/bin/env bash
# Run only on the native Ubuntu 24.04 amd64 build runner after tauri --no-bundle.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo 'Ubuntu 24.04 amd64 required' >&2; exit 1; }
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || { echo 'Ubuntu 24.04 required' >&2; exit 1; }
for tool in python3 ldd readelf dpkg-deb swift sha256sum git tar; do command -v "$tool" >/dev/null; done
[[ -z "$(git -C "$root" status --porcelain --untracked-files=normal)" ]] || { echo 'Release packaging requires a clean source checkout' >&2; exit 1; }
sha="$(git -C "$root" rev-parse HEAD)"
version="$(python3 "$root/prototype/scripts/linux-runtime.py" version "$root")"
out="$root/prototype/dist-linux/$sha"
[[ ! -e "$out" ]] || { echo "Output already exists: $out" >&2; exit 1; }
mkdir -p "$out"
swift_root="$(cd "$(dirname "$(readlink -f "$(command -v swift)")")/../.." && pwd)"
python3 "$root/prototype/scripts/linux-runtime.py" package "$root" "$out" "$swift_root" "$sha"
stage="$out/om0rx-xlog-prototype-linux-amd64"
artifact="OM0RX-xLog-${version}-Beta-Linux-x64"
# Reports stay outside both payloads. Any finding prevents either archive.
python3 "$root/prototype/scripts/verify-release-payload.py" "$stage" --report "$out/$artifact-payload-scan.json"
python3 "$root/prototype/scripts/verify-release-payload.py" "$out/deb-root" --report "$out/$artifact-deb-payload-scan.json"
tar -C "$out" -czf "$out/$artifact.tar.gz" "$(basename "$stage")"
dpkg-deb --root-owner-group --build "$out/deb-root" "$out/$artifact.deb"
(cd "$out" && sha256sum ./*.deb ./*.tar.gz > packages.sha256)
printf 'Linux runtime packages and loader audit: %s\n' "$out"
