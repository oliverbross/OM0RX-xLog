#!/bin/sh
# Build the pinned upstream Hamlib release for xLog's managed local helpers.
# This script never opens a radio, serial device, or daemon port.
set -eu

if [ "$(uname -s)" != Darwin ]; then
  echo 'stage-hamlib-macos.sh requires macOS' >&2
  exit 2
fi

version=4.7.2
sha256=ae1fcf2dbc80ea0786ea8f047b09399c3f7737d1930442f61a031708ed33e88f
archive="hamlib-$version.tar.gz"
url="https://github.com/Hamlib/Hamlib/releases/download/$version/$archive"
usb_version=1.0.30
usb_sha256=fea36f34f9156400209595e300840767ab1a385ede1dc7ee893015aea9c6dbaf
usb_archive="libusb-$usb_version.tar.bz2"
usb_url="https://github.com/libusb/libusb/releases/download/v$usb_version/$usb_archive"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
output_dir="$script_dir/../src-tauri/binaries"
build_jobs=${XLOG_HAMLIB_BUILD_JOBS:-$(sysctl -n hw.ncpu)}
case "$build_jobs" in
  ''|*[!0-9]*|0) echo 'XLOG_HAMLIB_BUILD_JOBS must be a positive integer' >&2; exit 2 ;;
esac
target=$(rustc -vV | sed -n 's/^host: //p')
if [ -z "$target" ]; then
  echo 'Could not determine Rust host target' >&2
  exit 2
fi

# Reuse only helpers built by this exact recipe for this host. A fresh runner
# still builds the pinned source; local UI rebuilds need not rebuild all radios.
recipe_sha=$(shasum -a 256 "$script_dir/stage-hamlib-macos.sh" | awk '{print $1}')
manifest="$output_dir/hamlib-$version-$target.sha256"
recipe_stamp="$output_dir/hamlib-$version-$target.recipe"
if [ -f "$manifest" ] && [ -f "$recipe_stamp" ] &&
   [ "$(cat "$recipe_stamp")" = "$recipe_sha" ] &&
   [ -f "$output_dir/hamlib-$version-notices/PROVENANCE.txt" ] &&
   [ -f "$output_dir/hamlib-$version-notices/LIBUSB-COPYING" ] &&
   (cd "$output_dir" && shasum -a 256 -c "$(basename "$manifest")" >/dev/null 2>&1); then
  printf 'Verified cached Hamlib %s helpers for %s\n' "$version" "$target"
  exit 0
fi

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/xlog-hamlib-XXXXXXXX")
cleanup() {
  case "$work_dir" in "${TMPDIR:-/tmp}/xlog-hamlib-"*) rm -rf -- "$work_dir" ;; esac
}
trap cleanup EXIT HUP INT TERM

curl --fail --location --silent --show-error --retry 3 "$url" -o "$work_dir/$archive"
curl --fail --location --silent --show-error --retry 3 "$usb_url" -o "$work_dir/$usb_archive"
actual_sha=$(shasum -a 256 "$work_dir/$archive" | awk '{print $1}')
if [ "$actual_sha" != "$sha256" ]; then
  echo "Hamlib source checksum mismatch: $actual_sha" >&2
  exit 1
fi
actual_usb_sha=$(shasum -a 256 "$work_dir/$usb_archive" | awk '{print $1}')
if [ "$actual_usb_sha" != "$usb_sha256" ]; then
  echo "libusb source checksum mismatch: $actual_usb_sha" >&2
  exit 1
fi

tar -xzf "$work_dir/$archive" -C "$work_dir"
tar -xjf "$work_dir/$usb_archive" -C "$work_dir"
source_dir="$work_dir/hamlib-$version"
build_dir="$work_dir/build"
install_dir="$work_dir/install"
usb_build_dir="$work_dir/usb-build"
usb_install_dir="$work_dir/usb-install"
mkdir -p "$build_dir" "$install_dir" "$usb_build_dir" "$usb_install_dir" "$output_dir"
cd "$usb_build_dir"
"$work_dir/libusb-$usb_version/configure" --prefix="$usb_install_dir" --disable-shared --enable-static > "$work_dir/usb-configure.log"
make -s -j "$build_jobs"
make -s install
if [ ! -f "$usb_install_dir/lib/libusb-1.0.a" ]; then
  echo 'Static libusb build is missing' >&2
  exit 1
fi
cd "$build_dir"

# Only the source-built libusb is visible to Hamlib's optional dependency probe.
PKG_CONFIG_LIBDIR="$usb_install_dir/lib/pkgconfig" PKG_CONFIG_PATH= \
  CPPFLAGS="-I$usb_install_dir/include/libusb-1.0" \
  LDFLAGS="-L$usb_install_dir/lib -framework IOKit -framework CoreFoundation -framework Security" \
  "$source_dir/configure" \
  --prefix="$install_dir" --disable-shared --enable-static \
  --enable-silent-rules > "$work_dir/hamlib-configure.log"
if ! grep -E 'Enable USB backends +yes' "$work_dir/hamlib-configure.log" >/dev/null; then
  echo 'Hamlib USB backend detection failed' >&2
  exit 1
fi
make -s -j "$build_jobs"

for name in rigctld rotctld; do
  # With shared libraries disabled these are the final static-linked helpers.
  # Installing every Hamlib backend, manual and development header is not
  # needed to stage the two runtime executables.
  source_binary="$build_dir/tests/$name"
  if [ ! -x "$source_binary" ]; then
    echo "Hamlib did not build $name" >&2
    exit 1
  fi
  dependencies=$(otool -L "$source_binary")
  printf '%s\n' "$dependencies" | sed -n '2,$p' | awk '{print $1}' | while IFS= read -r dependency; do
    case "$dependency" in
      /usr/lib/*|/System/Library/Frameworks/*) ;;
      *) echo "$name has a non-system dynamic dependency: $dependency" >&2; exit 1 ;;
    esac
  done
  if ! "$source_binary" --version | grep -F "Hamlib $version" >/dev/null; then
    echo "$name version does not match pinned Hamlib $version" >&2
    exit 1
  fi
  install -m 755 "$source_binary" "$output_dir/$name-$target"
done

notice_dir="$output_dir/hamlib-$version-notices"
mkdir -p "$notice_dir"
for notice in COPYING COPYING.LIB AUTHORS README; do
  if [ -f "$source_dir/$notice" ]; then cp "$source_dir/$notice" "$notice_dir/$notice"; fi
done
if [ -f "$work_dir/libusb-$usb_version/COPYING" ]; then
  cp "$work_dir/libusb-$usb_version/COPYING" "$notice_dir/LIBUSB-COPYING"
fi
cat > "$notice_dir/PROVENANCE.txt" <<EOF
Hamlib version: $version
Source archive: $url
Source SHA-256: $sha256
Target: $target
libusb version: $usb_version
libusb source archive: $usb_url
libusb source SHA-256: $usb_sha256
Build: libusb configure --disable-shared --enable-static; make; make install
Build: Hamlib configure --disable-shared --enable-static; make; stage tests/rigctld and tests/rotctld
macOS static libusb link: IOKit, CoreFoundation and Security system frameworks
Optional pkg-config libraries: source-built libusb only
EOF
for name in rigctld rotctld; do
  shasum -a 256 "$output_dir/$name-$target"
  otool -L "$output_dir/$name-$target"
done
(cd "$output_dir" && shasum -a 256 "rigctld-$target" "rotctld-$target") > "$manifest"
printf '%s\n' "$recipe_sha" > "$recipe_stamp"
