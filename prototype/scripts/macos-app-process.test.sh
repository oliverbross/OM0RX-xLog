#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/macos-app-process.sh"

# A renamed display bundle still runs xlog-prototype. Only the destination
# executable may be stopped; the worker and a separate test build are excluded.
processes=$'101 /Applications/OM0RX-xLog.app/Contents/MacOS/xlog-prototype\n102 /Applications/OM0RX-xLog.app/Contents/MacOS/xlog-prototype-worker\n103 /tmp/OM0RX Test.app/Contents/MacOS/xlog-prototype'
ps() { printf '%s\n' "$processes"; }
terminated=""
kill() {
  [[ "$1" == '-TERM' && "$2" == '101' ]]
  terminated="$2"
  processes=$'102 /Applications/OM0RX-xLog.app/Contents/MacOS/xlog-prototype-worker\n103 /tmp/OM0RX Test.app/Contents/MacOS/xlog-prototype'
}
sleep() { :; }
stop_macos_app '/Applications/OM0RX-xLog.app/Contents/MacOS/xlog-prototype'
[[ "$terminated" == '101' ]]
[[ "$(macos_app_pids '/tmp/OM0RX Test.app/Contents/MacOS/xlog-prototype')" == '103' ]]
verify_macos_app_stopped '/Applications/OM0RX-xLog.app/Contents/MacOS/xlog-prototype'
if verify_macos_app_stopped '/tmp/OM0RX Test.app/Contents/MacOS/xlog-prototype' 2>/dev/null; then exit 1; fi

# A process that ignores TERM prevents replacement instead of continuing with
# the old executable still mapped from the rollback bundle.
kill() { :; }
if stop_macos_app '/tmp/OM0RX Test.app/Contents/MacOS/xlog-prototype' 2>/dev/null; then
  printf 'Expected the still-running application to block replacement.\n' >&2
  exit 1
fi

# Installation checks every executable rooted inside the exact destination,
# including an orphaned worker/interpreter, without sending any signal.
terminated=""
kill() { terminated="unexpected"; return 1; }
processes=$'102 /Applications/OM0RX-xLog.app/Contents/MacOS/xlog-prototype-worker\n104 /Applications/OM0RX-xLog.app/Contents/Frameworks/Python.framework/Versions/3.12/bin/python3.12\n105 /Applications/OM0RX-xLog.app-other/Contents/MacOS/xlog-prototype'
if verify_macos_bundle_stopped '/Applications/OM0RX-xLog.app' 2>/dev/null; then exit 1; fi
[[ -z "$terminated" ]]
processes=$'103 /tmp/OM0RX Test.app/Contents/MacOS/xlog-prototype\n105 /Applications/OM0RX-xLog.app-other/Contents/MacOS/xlog-prototype\n106 /Applications/OM0RX-xLog.app/ContentsExtra/not-an-owner'
verify_macos_bundle_stopped '/Applications/OM0RX-xLog.app'
[[ -z "$terminated" ]]

ps() { return 1; }
if verify_macos_app_stopped '/Applications/OM0RX-xLog.app/Contents/MacOS/xlog-prototype'; then exit 1; fi
if verify_macos_bundle_stopped '/Applications/OM0RX-xLog.app' 2>/dev/null; then exit 1; fi
if stop_macos_app '/Applications/OM0RX-xLog.app/Contents/MacOS/xlog-prototype'; then
  printf 'Expected failed process inventory to stop installation.\n' >&2
  exit 1
fi
printf 'macOS installer process checks passed.\n'
