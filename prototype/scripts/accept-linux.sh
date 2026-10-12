#!/usr/bin/env bash
# Installed runtime gate. Container invocation must have --network none.
set -euo pipefail
package="${1:-/opt/om0rx-xlog-prototype}"
evidence="${2:-/evidence}"
[[ "$(id -u)" != 0 ]] || { echo 'Acceptance must run as a regular user' >&2; exit 1; }
mkdir -p "$evidence"
for tool in swift swiftc rustc cargo node npm clang gcc cc make cmake; do
  if command -v "$tool" >/dev/null; then echo "Unexpected development tool: $tool" >&2; exit 1; fi
done
export PATH=/usr/bin:/bin
unset LD_PRELOAD LD_LIBRARY_PATH
export LD_LIBRARY_PATH="$package/lib"
export GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1
(cd "$package" && sha256sum --check payload.sha256) > "$evidence/payload-hash-check.txt"
python3 /qa/linux-runtime.py audit "$package" "$evidence/native-loader-audit.txt"
python3 /qa/linux-worker-acceptance.py "$package/bin/xlog-prototype-worker" "$evidence/worker.json"
dpkg-query -W > "$evidence/installed-packages.tsv"
cp /etc/os-release "$evidence/os-release.txt"
id > "$evidence/user.txt"
relocated="$(mktemp -d /tmp/xlog-relocated.XXXXXX)"
tar -xzf /qa/runtime.tar.gz -C "$relocated"
for attempt in 1 2 3; do
  launch_package="$package"
  if [[ "$attempt" == 3 ]]; then
    launch_package="$relocated/om0rx-xlog-prototype-linux-amd64"
    (cd "$launch_package" && sha256sum --check payload.sha256) > "$evidence/archive-payload-hash-check.txt"
    python3 /qa/linux-runtime.py audit "$launch_package" "$evidence/archive-loader-audit.txt"
  fi
  report="$evidence/ui-$attempt.json"
  [[ ! -e "$report" ]] || { echo "Report already exists: $report" >&2; exit 1; }
  # Xvfb and dbus are QA harness dependencies. They are not application deps.
  xvfb-run -a -s '-screen 0 1600x1100x24' dbus-run-session -- bash -c '
    set -euo pipefail
    timeout 100 "$1/launch" --acceptance-report "$2" > "$3" 2>&1 &
    pid=$!
    for count in $(seq 1 200); do
      if [[ -s "$2" ]]; then
        import -window root "$4"
        break
      fi
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    wait "$pid"
  ' qa "$launch_package" "$report" "$evidence/ui-$attempt.log" "$evidence/ui-$attempt.png"
  python3 - "$report" <<'PY'
import json, sys
with open(sys.argv[1]) as stream:
    value = json.load(stream)
assert value['schema'] == 1 and value['status'] == 'passed'
assert value['embeddedUi'] is True and value['worker'] is True
assert value['platform'] == 'linux'
PY
  [[ -s "$evidence/ui-$attempt.png" ]]
done
xvfb-run -a -s '-screen 0 1600x1100x24' dbus-run-session -- \
  bash /qa/linux-wayland-acceptance.sh "$package" "$evidence"
python3 - "$package" "$evidence" <<'PY'
import json, sys
from pathlib import Path
package, evidence = map(Path, sys.argv[1:])
manifest = json.loads((package / 'runtime-manifest.json').read_text())
(evidence / 'acceptance.json').write_text(json.dumps({
    'schema': 1, 'status': 'passed', 'commit': manifest['commit'],
    'platform': 'ubuntu-24.04-amd64', 'developmentToolchainsPresent': False,
    'nonRoot': True, 'framingTestCount': 2, 'embeddedUiLaunchCount': 4,
    'installedDebLaunchCount': 3, 'relocatedArchiveLaunchCount': 1,
    'x11LaunchCount': 3, 'waylandLaunchCount': 1,
    'waylandCompositorBackend': 'Weston nested X11 with pixman renderer',
    'scope': 'Synthetic core and embedded UI under Xvfb and nested Wayland; no hardware/accounts'}, indent=2) + '\n')
PY
printf 'Linux clean-container acceptance passed: %s\n' "$evidence"
