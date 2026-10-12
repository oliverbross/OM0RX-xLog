#!/usr/bin/env bash
# Run only on the native Ubuntu 24.04 amd64 build runner after tauri --no-bundle.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo 'Ubuntu 24.04 amd64 required' >&2; exit 1; }
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || { echo 'Ubuntu 24.04 required' >&2; exit 1; }
for tool in python3 ldd readelf dpkg-deb swift sha256sum; do command -v "$tool" >/dev/null; done
sha="$(git -C "$root" rev-parse HEAD)"
out="$root/prototype/dist-linux/$sha"
[[ ! -e "$out" ]] || { echo "Output already exists: $out" >&2; exit 1; }
mkdir -p "$out"
swift_root="$(cd "$(dirname "$(readlink -f "$(command -v swift)")")/../.." && pwd)"
python3 "$root/prototype/scripts/linux-runtime.py" package "$root" "$out" "$swift_root" "$sha"
stage="$out/om0rx-xlog-prototype-linux-amd64"
tar -C "$out" -czf "$out/om0rx-xlog-prototype_${sha}_linux-amd64.tar.gz" "$(basename "$stage")"
dpkg-deb --root-owner-group --build "$out/deb-root" "$out/om0rx-xlog-prototype_${sha}_amd64.deb"
(cd "$out" && sha256sum ./*.deb ./*.tar.gz > packages.sha256)
printf 'Linux runtime packages and loader audit: %s\n' "$out"
