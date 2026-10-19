#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
bundle="${1:-}"
case "$bundle" in
  "$repo_root"/prototype/src-tauri/target/release/bundle/macos/*.app) ;;
  *) printf 'Refusing unexpected contest runtime bundle: %s\n' "$bundle" >&2; exit 2 ;;
esac
[[ -d "$bundle/Contents" ]] || { printf 'Application bundle is missing: %s\n' "$bundle" >&2; exit 2; }

source_framework="${XLOG_PYTHON_FRAMEWORK:-/opt/homebrew/opt/python@3.12/Frameworks/Python.framework}"
source_python="$source_framework/Versions/3.12/bin/python3.12"
[[ -x "$source_python" ]] || { printf 'Pinned Python 3.12 framework is unavailable.\n' >&2; exit 2; }
python_version="$($source_python -I -c 'import platform; print(platform.python_version())')"
[[ "$python_version" == 3.12.* ]] || { printf 'Expected Python 3.12, found %s.\n' "$python_version" >&2; exit 2; }

framework="$bundle/Contents/Frameworks/Python.framework"
runtime="$framework/Versions/3.12"
host_root="$bundle/Contents/Resources/Not1MM/python"
rm -rf "$framework" "$host_root"
mkdir -p "$(dirname "$framework")" "$host_root"
ditto "$source_framework" "$framework"
rsync -a --exclude '__pycache__' --exclude '*.pyc' "$repo_root/python/" "$host_root/"

# Homebrew's framework launcher records its Cellar path. The installed copy is
# self-contained and must not depend on Homebrew or any user Python location.
launcher="$runtime/bin/python3.12"
old_python="$(otool -L "$launcher" | sed -n '2s/^[[:space:]]*\([^[:space:]]*Python\).*/\1/p')"
[[ -n "$old_python" ]] || { printf 'Could not identify Python framework linkage.\n' >&2; exit 2; }
install_name_tool -change "$old_python" '@executable_path/../Python' "$launcher"
install_name_tool -id '@rpath/Python' "$runtime/Python"
codesign --force --sign - --timestamp=none "$runtime/Python"
codesign --force --sign - --timestamp=none "$launcher"
if otool -L "$launcher" "$runtime/Python" | grep -Eq '/(opt/homebrew|usr/local)/(Cellar|opt)/python'; then
  printf 'Contest Python runtime still contains a package-manager linkage.\n' >&2
  exit 2
fi

test_root="$(mktemp -d /private/tmp/om0rx-not1mm-package.XXXXXX)"
trap 'rm -rf "$test_root"' EXIT
reply="$(printf '%s\n' '{"id":"package-test","method":"contest_catalog","params":{}}' |
  "$launcher" -I -B "$host_root/contest_host/launcher.py" --data-root "$test_root/data")"
printf '%s' "$reply" | grep -q '"engine":"not1mm-python"' || {
  printf 'Relocated contest Python runtime self-test failed.\n' >&2
  exit 2
}
printf 'Staged Not1MM host with bundled Python %s.\n' "$python_version"
