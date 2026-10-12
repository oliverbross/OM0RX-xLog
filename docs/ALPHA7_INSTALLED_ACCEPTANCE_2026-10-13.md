# Alpha.7 installed acceptance 13 October 2026

Alpha.7 is installed and its offline CW preference round-trip passed in the native
macOS application. Hardware, complete performance and alternate-OS acceptance
remain open.

## Exact package

- Source: `7ae632b8019adb857807d484b5a8f7f8edbceba0`, pushed to
  `codex/unified-xlog-integration-p2`; clean source at build.
- Developer ID build, worker self-test and strict deep signature verification
  passed. The existing Vite large-bundle warning remains.
- Apple notarization `6627a277-198e-4429-ad62-5a0d62b92c8f`: Accepted.
- Staple validation and Gatekeeper assessment passed for both the build and
  `/Applications/OM0RX-xLog Integration.app`.
- Archive SHA-256:
  `ea1734e0784c14eac33f5d0fc3c1a6e480e8d76a682b94fd8dc470ea08abcfc5`.
- Installed version is `0.4.0-alpha.7`; distribution metadata reports the exact
  source above and includes serialport 4.10.1 licence notices.
- Existing Integration quit normally and was updated in place. One Integration
  process and one associated worker were observed after both launches. No extra
  archived app copy was created.
- Original native xLog binary SHA-256 remains
  `7a2b244545c9eb2639cde5f0a152c9cfaf40e2e06fde9ad97fd3184e37efdb97`.

## Installed CW checks

The native Tauri window was inspected at 1440 by 940 pixels, not through the
synthetic browser fixture. The existing 67,846-contact workspace and blank draft
reopened. Radio, amplifier and rotor remained offline; ShackCQ automatically
reconnected after each restart and delivered new spots without Connect/Refresh.

- Settings → CW showed the five default macros, no assigned shortcuts, hidden
  desk row, radio output, and a resolved `CQ CQ DE OM0RX OM0RX K` preview.
- Temporarily changed the CQ label to `CQ check`, enabled the desk row and pressed
  Save settings. Operator Desk displayed all five disabled macro buttons, Arm off,
  Stop disabled and `CW disarmed`.
- Quit/reopened the exact installed app. `CQ check` and the visible row persisted;
  it still started disarmed. Settings confirmed the saved label/display values.
- Restored CQ label, hidden desk row and all shortcuts unassigned, then saved.
- Inspected Independent WinKeyer with empty port and unchecked consent. It showed
  disconnected, with Connect, release and speed actions disabled. Selecting via
  the native menu followed by Return also submitted the settings form; this was
  not an unsaved-selection test. Restored radio output and explicitly saved again.
- Did not invoke List ports, Connect, Arm, any macro, speed, Stop, RF controls,
  QSO logging or synchronization. Physical keyer/radio behavior is not inferred
  from these UI checks.

The default CW profile is now explicitly saved instead of absent. Its behavior
matches the original defaults; other station, equipment, logbook and credential
settings were not deliberately changed.

## Awards observations

On the first Awards visit in the second app process, progress totals were present
in the first accessibility observation 519 ms after initiating the click; the
catalogue still showed Loading. A later observation contained all 192 programmes
and AJA evidence-eligible count 1,473. That later observation was not sampled
tightly enough to establish load duration.

A warm return had the full catalogue, no loading state and the same totals in the
first observation 598 ms after initiating the click. These intervals include
automation and accessibility capture overhead; they are not input-to-paint
measurements, a median/p95 benchmark or proof of instant first-load performance.

## Remaining acceptance

- Accurate cold/warm and post-mutation latency measurements, startup cost and
  large-log UI responsiveness.
- Native armed/error-state and shortcut acceptance, assistive technology,
  physical WinKeyer/driver hotplug, connected supported radios, Windows/Linux.
- Responsive layout still has the earlier wrapped Monitor header at this size;
  no-scrollbar and physical high-DPI monitor acceptance are not closed.
- Full feature parity and the rest of the operator feedback tracker remain open.
