#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
source_bundle="${1:-$root/prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app}"
destination="${2:-/Applications/OM0RX-xLog.app}"

verify_bundle() {
  local bundle="$1"
  test -d "$bundle/Contents/Resources/OM0RXXLogPrototype_XLogCore.bundle"
  test -d "$bundle/Contents/Resources/OM0RXXLogPrototype_XContestCore.bundle"
  test -x "$bundle/Contents/MacOS/xlog-prototype-worker"
  codesign --verify --deep --strict "$bundle"
  codesign --verify --strict "$bundle/Contents/MacOS/xlog-prototype-worker"
}

verify_bundle "$source_bundle"
destination_parent="$(dirname "$destination")"
stage_root="$(mktemp -d "$destination_parent/.om0rx-xlog-install.XXXXXX")"
staged="$stage_root/$(basename "$destination")"
backup=""

cleanup() {
  rm -rf "$stage_root"
}
trap cleanup EXIT

ditto "$source_bundle" "$staged"
verify_bundle "$staged"
source_worker_hash="$(shasum -a 256 "$source_bundle/Contents/MacOS/xlog-prototype-worker" | awk '{print $1}')"
staged_worker_hash="$(shasum -a 256 "$staged/Contents/MacOS/xlog-prototype-worker" | awk '{print $1}')"
test "$source_worker_hash" = "$staged_worker_hash"

if pgrep -x OM0RX-xLog >/dev/null 2>&1; then
  pkill -TERM -x OM0RX-xLog
  for _ in {1..50}; do
    pgrep -x OM0RX-xLog >/dev/null 2>&1 || break
    sleep 0.1
  done
  if pgrep -x OM0RX-xLog >/dev/null 2>&1; then
    printf 'OM0RX-xLog is still running; installation stopped before replacement.\n' >&2
    exit 1
  fi
fi

if [[ -e "$destination" ]]; then
  backup="${destination%.app}-previous-$(date -u +%Y%m%dT%H%M%SZ)-$$.app"
  mv "$destination" "$backup"
fi

if mv "$staged" "$destination" && verify_bundle "$destination"; then
  installed_worker_hash="$(shasum -a 256 "$destination/Contents/MacOS/xlog-prototype-worker" | awk '{print $1}')"
  if [[ "$installed_worker_hash" != "$source_worker_hash" ]]; then
    printf 'Installed worker hash changed during replacement.\n' >&2
  else
    printf 'Installed and verified: %s\n' "$destination"
    [[ -z "$backup" ]] || printf 'Recoverable previous application: %s\n' "$backup"
    exit 0
  fi
fi

failed="${destination%.app}-failed-$(date -u +%Y%m%dT%H%M%SZ)-$$.app"
[[ ! -e "$destination" ]] || mv "$destination" "$failed"
[[ -z "$backup" ]] || mv "$backup" "$destination"
printf 'Installation verification failed; the previous application was restored.\n' >&2
exit 1
