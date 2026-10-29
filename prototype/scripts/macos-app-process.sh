#!/usr/bin/env bash

# Match the installed executable path, not the application display name. Tauri
# launches xlog-prototype; using OM0RX-xLog as the process name misses it.
macos_app_pids() {
  local executable_path="$1" pid command inventory
  inventory="$(ps -axo pid=,comm=)" || return 1
  while read -r pid command; do
    [[ "$command" != "$executable_path" ]] || printf '%s\n' "$pid"
  done <<< "$inventory"
}

# Post-Quit acceptance must never ask an application binding for AX state or
# activate it. Inspect the executable path only; reopening is a separate action.
verify_macos_app_stopped() {
  local executable_path="$1" remaining
  remaining="$(macos_app_pids "$executable_path")" || return 1
  if [[ -n "$remaining" ]]; then
    printf 'Application remains running (no relaunch or signal issued): %s [%s]\n' "$executable_path" "$remaining" >&2
    return 1
  fi
}

# Installation must also refuse an orphaned worker, interpreter or helper.
# Match executable comm paths only within this exact bundle, never its siblings.
verify_macos_bundle_stopped() {
  local bundle_path="${1%/}" canonical_path pid command inventory result=0
  canonical_path="$bundle_path"
  if [[ -d "$bundle_path" ]]; then
    canonical_path="$(cd "$bundle_path" && pwd -P)" || return 1
  fi
  inventory="$(ps -axo pid=,comm=)" || {
    printf 'Process inventory unavailable; installation stopped before replacement: %s\n' "$bundle_path" >&2
    return 1
  }
  while read -r pid command; do
    if [[ "$command" == "$bundle_path/Contents/"* || "$command" == "$canonical_path/Contents/"* ]]; then
      printf 'Application remains running (no relaunch or signal issued): %s [%s]\n' "$command" "$pid" >&2
      result=1
    fi
  done <<< "$inventory"
  return "$result"
}

stop_macos_app() {
  local executable_path="$1" pid remaining attempt
  remaining="$(macos_app_pids "$executable_path")" || return 1
  while read -r pid; do
    [[ -z "$pid" ]] || kill -TERM "$pid" 2>/dev/null || true
  done <<< "$remaining"
  for attempt in {1..50}; do
    remaining="$(macos_app_pids "$executable_path")" || return 1
    [[ -n "$remaining" ]] || return 0
    sleep 0.1
  done
  printf 'Application is still running; installation stopped before replacement: %s\n' "$executable_path" >&2
  return 1
}
