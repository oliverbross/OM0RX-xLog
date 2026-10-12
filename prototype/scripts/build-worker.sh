#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
export XLOG_PORTABLE_ONLY=1
swift build --package-path "$repo_root" --scratch-path "$repo_root/.build/prototype-worker" -c release --product xlog-prototype-worker
binary_dir="$(swift build --package-path "$repo_root" --scratch-path "$repo_root/.build/prototype-worker" -c release --show-bin-path)"
"$binary_dir/xlog-prototype-worker" --self-test
printf 'Worker built: %s\n' "$binary_dir/xlog-prototype-worker" >&2
