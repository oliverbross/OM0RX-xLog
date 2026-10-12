#!/usr/bin/env bash
# Native Linux helpers from the same pinned sources as the Mac package.
# Builds and --version checks only: no serial ports or hardware are opened.
set -euo pipefail
[[ "$(uname -s)" == Linux ]] || { echo 'Native Linux required' >&2; exit 2; }
version=4.7.2
sha256=ae1fcf2dbc80ea0786ea8f047b09399c3f7737d1930442f61a031708ed33e88f
usb_version=1.0.30
usb_sha256=fea36f34f9156400209595e300840767ab1a385ede1dc7ee893015aea9c6dbaf
url="https://github.com/Hamlib/Hamlib/releases/download/$version/hamlib-$version.tar.gz"
usb_url="https://github.com/libusb/libusb/releases/download/v$usb_version/libusb-$usb_version.tar.bz2"
script_dir="$(cd "$(dirname "$0")" && pwd)"
output_dir="$script_dir/../src-tauri/binaries"
target="$(rustc -vV | sed -n 's/^host: //p')"
[[ "$target" == *-unknown-linux-gnu ]] || { echo 'GNU Linux Rust host required' >&2; exit 2; }
work_dir="$(mktemp -d /tmp/xlog-hamlib-linux-XXXXXXXX)"
cleanup() { case "$work_dir" in /tmp/xlog-hamlib-linux-*) rm -rf -- "$work_dir" ;; esac; }
trap cleanup EXIT
curl --fail --location --silent --show-error --retry 3 "$url" -o "$work_dir/hamlib.tar.gz"
curl --fail --location --silent --show-error --retry 3 "$usb_url" -o "$work_dir/libusb.tar.bz2"
[[ "$(sha256sum "$work_dir/hamlib.tar.gz" | awk '{print $1}')" == "$sha256" ]] || { echo 'Hamlib source checksum mismatch' >&2; exit 1; }
[[ "$(sha256sum "$work_dir/libusb.tar.bz2" | awk '{print $1}')" == "$usb_sha256" ]] || { echo 'libusb source checksum mismatch' >&2; exit 1; }
tar -xzf "$work_dir/hamlib.tar.gz" -C "$work_dir"
tar -xjf "$work_dir/libusb.tar.bz2" -C "$work_dir"
mkdir -p "$work_dir/usb-build" "$work_dir/usb-install" "$work_dir/build" "$output_dir"
cd "$work_dir/usb-build"
"$work_dir/libusb-$usb_version/configure" --prefix="$work_dir/usb-install" --disable-shared --enable-static
make -s -j "$(nproc)"
make -s install
[[ -f "$work_dir/usb-install/lib/libusb-1.0.a" ]] || { echo 'Static libusb missing' >&2; exit 1; }
udev_pc="$(pkg-config --variable=pcfiledir libudev)/libudev.pc"
[[ -f "$udev_pc" ]] || { echo 'System libudev development metadata missing' >&2; exit 1; }
cp "$udev_pc" "$work_dir/usb-install/lib/pkgconfig/libudev.pc"
cd "$work_dir/build"
# Keep USB discovery via the OS udev runtime. Other optional pkg-config
# integrations cannot silently enter the build from the runner environment.
PKG_CONFIG_LIBDIR="$work_dir/usb-install/lib/pkgconfig" PKG_CONFIG_PATH= \
  CPPFLAGS="-I$work_dir/usb-install/include/libusb-1.0" \
  LDFLAGS="-L$work_dir/usb-install/lib" LIBS="-ludev -pthread" \
  "$work_dir/hamlib-$version/configure" --prefix="$work_dir/install" \
  --disable-shared --enable-static --enable-silent-rules | tee "$work_dir/configure.log"
grep -E 'Enable USB backends +yes' "$work_dir/configure.log" >/dev/null
make -s -j "$(nproc)"
for name in rigctld rotctld; do
  "$work_dir/build/tests/$name" --version | grep -F "Hamlib $version" >/dev/null
  install -m 755 "$work_dir/build/tests/$name" "$output_dir/$name-$target"
done
notice_dir="$output_dir/hamlib-$version-notices"
mkdir -p "$notice_dir"
for name in COPYING COPYING.LIB AUTHORS README; do
  [[ ! -f "$work_dir/hamlib-$version/$name" ]] || cp "$work_dir/hamlib-$version/$name" "$notice_dir/$name"
done
cp "$work_dir/libusb-$usb_version/COPYING" "$notice_dir/LIBUSB-COPYING"
printf '%s\n' "Hamlib version: $version" "Source archive: $url" "Source SHA-256: $sha256" \
  "libusb version: $usb_version" "libusb source archive: $usb_url" "libusb source SHA-256: $usb_sha256" \
  "Target: $target" 'Build: static Hamlib and libusb; system udev and pthread runtime' \
  > "$notice_dir/PROVENANCE.txt"
(cd "$output_dir" && sha256sum "rigctld-$target" "rotctld-$target") > "$output_dir/hamlib-$version-$target.sha256"
