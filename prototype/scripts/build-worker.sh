#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
export XLOG_PORTABLE_ONLY=1
# Xcode's resource accessor searches Bundle.main.resourceURL, including the
# signed app's Contents/Resources. SwiftPM's native accessor instead searches
# the app root and its original CI build path, which breaks the installed worker.
worker_swift_build() {
  if [[ "$(uname -s)" == Darwin ]]; then
    swift build --build-system xcode "$@"
  else
    swift build "$@"
  fi
}
worker_swift_build --package-path "$repo_root" --scratch-path "$repo_root/.build/prototype-worker" -c release --product xlog-prototype-worker
binary_dir="$(worker_swift_build --package-path "$repo_root" --scratch-path "$repo_root/.build/prototype-worker" -c release --show-bin-path)"
"$binary_dir/xlog-prototype-worker" --self-test
printf 'Worker built: %s\n' "$binary_dir/xlog-prototype-worker" >&2
