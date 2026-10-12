#!/usr/bin/env bash
# Run within Xvfb + dbus-run-session. Weston presents native Wayland clients
# through its X11 backend; the outer X11 screenshot captures that compositor.
set -euo pipefail
package="$1"
evidence="$2"
report="$evidence/ui-wayland.json"
[[ ! -e "$report" ]] || { echo "Report already exists: $report" >&2; exit 1; }
runtime_dir="$(mktemp -d /tmp/xlog-wayland-runtime.XXXXXX)"
chmod 700 "$runtime_dir"
export XDG_RUNTIME_DIR="$runtime_dir" WAYLAND_DISPLAY=xlog-accept GDK_BACKEND=wayland
export LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1
app_pid=""
weston_pid=""
cleanup() {
  # Only reap helpers started by this bounded harness; keep logs/runtime dir.
  for pid in "$app_pid" "$weston_pid"; do
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null || true
      for count in $(seq 1 20); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.1
      done
      kill -KILL "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT
weston --version > "$evidence/weston-version.txt"
weston --backend=x11 --renderer=pixman --no-config --idle-time=0 \
  --width=1600 --height=1100 --socket="$WAYLAND_DISPLAY" \
  --log="$evidence/weston.log" > "$evidence/weston-process.log" 2>&1 &
weston_pid=$!
for count in $(seq 1 40); do
  [[ -S "$runtime_dir/$WAYLAND_DISPLAY" ]] && break
  kill -0 "$weston_pid" 2>/dev/null || { echo 'Weston exited before socket readiness' >&2; exit 1; }
  sleep 0.25
done
[[ -S "$runtime_dir/$WAYLAND_DISPLAY" ]] || { echo 'Weston socket readiness timed out' >&2; exit 1; }
# Weston retains DISPLAY for its X11 backend. The application cannot fall back
# to X11: its entire Tauri/GTK/WebKit process tree inherits no DISPLAY variable.
env -u DISPLAY timeout --kill-after=5 100 "$package/launch" --acceptance-report "$report" \
  > "$evidence/ui-wayland.log" 2>&1 &
app_pid=$!
for count in $(seq 1 200); do
  if [[ -s "$report" ]]; then
    # Weston may still be fading the closed monitor when the report is written.
    sleep 1
    import -window root "$evidence/ui-wayland.png"
    break
  fi
  kill -0 "$app_pid" 2>/dev/null || break
  kill -0 "$weston_pid" 2>/dev/null || { echo 'Weston exited during app acceptance' >&2; exit 1; }
  sleep 0.5
done
wait "$app_pid"
app_pid=""
python3 - "$report" "$evidence" <<'PY'
import json, sys
from pathlib import Path
report, evidence = map(Path, sys.argv[1:])
value = json.loads(report.read_text())
assert value['schema'] == 1 and value['status'] == 'passed'
assert value['embeddedUi'] is True and value['worker'] is True
assert value['platform'] == 'linux'
assert len(value['checks']) >= 14 and all(check is True for check in value['checks'].values())
assert (evidence / 'ui-wayland.png').stat().st_size > 0
(evidence / 'wayland-session.json').write_text(json.dumps({
    'schema': 1, 'status': 'passed', 'applicationBackend': 'wayland',
    'applicationDisplayVariablePresent': False, 'compositor': 'Weston',
    'compositorBackend': 'x11', 'compositorRenderer': 'pixman',
    'capture': 'outer Xvfb X11 root showing nested Weston compositor',
    'physicalDesktop': False, 'directHeadlessCompositor': False,
    'report': report.name, 'checkCount': len(value['checks'])}, indent=2) + '\n')
PY
