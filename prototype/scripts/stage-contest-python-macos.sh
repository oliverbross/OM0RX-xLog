#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
bundle="${1:-}"
packaging_script="${2:-package-macos.sh}"
case "$bundle" in
  "$repo_root"/prototype/src-tauri/target/release/bundle/macos/*.app) ;;
  *) printf 'Refusing unexpected contest runtime bundle: %s\n' "$bundle" >&2; exit 2 ;;
esac
[[ -d "$bundle/Contents" ]] || { printf 'Application bundle is missing: %s\n' "$bundle" >&2; exit 2; }

if [[ -n "${XLOG_PYTHON_FRAMEWORK:-}" ]]; then
  source_framework="$XLOG_PYTHON_FRAMEWORK"
elif [[ -x /opt/local/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12 ]]; then
  source_framework=/opt/local/Library/Frameworks/Python.framework
else
  source_framework=/opt/homebrew/opt/python@3.12/Frameworks/Python.framework
fi
source_python="$source_framework/Versions/3.12/bin/python3.12"
[[ -x "$source_python" ]] || { printf 'Python 3.12 framework is unavailable.\n' >&2; exit 2; }
"$source_python" -I -B "$repo_root/prototype/scripts/test-contest-python-relocation.py" -q
"$source_python" -I -B "$repo_root/prototype/scripts/relocate-contest-python.py" \
  --bundle "$bundle" --source-framework "$source_framework" \
  --packaging-script "$packaging_script"
