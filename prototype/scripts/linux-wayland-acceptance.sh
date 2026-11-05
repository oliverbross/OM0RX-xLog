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
# One supervisor retains original Popen ownership even if the first receipt
# write fails. It keeps DISPLAY for Weston and removes it only for the app tree.
python3 /qa/linux-process-receipts.py session "$package" "$report" \
  "$evidence/ui-wayland.log" "$evidence/ui-wayland.png" wayland
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
