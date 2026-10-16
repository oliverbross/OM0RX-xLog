# macOS alpha.41 QSO canvas acceptance — 2026-10-17

## Outcome

OM0RX-xLog `0.4.0-alpha.41` adds a persistent, operator-configurable canvas to the Log QSO workspace.

- Active contact, QSO details, Callsign intelligence, Previous QSOs, and Band / mode matrix can be moved and resized while **Arrange panels** is enabled.
- Panel geometry snaps to an 8 px grid, remains inside the canvas, and is restored after relaunch.
- Keyboard users can move the selected panel with the arrow keys; Shift uses 32 px steps and Escape cancels the current adjustment.
- **Reset layout** restores the supplied layout.
- Below 940 px, the workspace falls back to the normal stacked layout and disables arrangement so narrow windows remain usable.
- Settings → Display now controls 33 optional QSO-detail fields, grouped by purpose, with **Show all** and **Hide all optional fields** actions. Callsign, frequency, band, mode, reports, and UTC remain permanently visible.
- Hiding a field changes presentation only; its stored value is not deleted. Preference changes propagate to other open application windows.
- The detached QSO window continues to load the core editor without the canvas implementation.

## Source and automated verification

- Source commit: `299492d` (`Add configurable QSO canvas and fields`)
- Branch: `codex/macos-alpha33-release`
- Focused and regression tests: 139 of 139 passed across ten QSO, settings, detached-window, and preference suites.
- Production frontend build: passed, including TypeScript and detached-window bundle gates.
- QSO startup bundle: 402,057 bytes; gzip 130,828 bytes.
- Settings startup bundle: 402,646 bytes; gzip 124,691 bytes.
- The Impeccable mechanical layout check returned no findings.
- macOS package build: passed, including worker self-test, Hamlib helper verification, and Developer ID signing.

## Bundle acceptance

- Built bundle version: `0.4.0-alpha.41`
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Built-bundle acceptance: passed, 33 of 33 checks.
- Installed-bundle acceptance: passed, 33 of 33 checks.
- Acceptance scope: `integrated-local-ui`
- Embedded UI: true
- Worker: true
- Station I/O: false; hardware and live radio commands were not exercised by this synthetic acceptance run.
- Signing authority: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- Main executable SHA-256: `2986508cd667cf1a3187a5b3c3921e8687574272ad1becef99a4630bf8a95988`
- Worker SHA-256: `680b5807ada8bda98619e02a3b2db8ee4659df62ef9cda806161e253902d0390`
- Installed and built executable hashes match.
- Runtime after installation: one main application process and one packaged worker process running.

The desktop automation inventory sees the installed application running, but cannot attach to its window because archived builds share the same bundle identifier and its application-path lookup retains a stale identifier. Layout behavior is covered by focused component and geometry tests; the exact signed package is covered by built and installed native acceptance.

## Installation and rollback

- Installed app: `/Applications/OM0RX-xLog.app`
- Previous alpha.40 bundle: `/Users/oliver/Documents/OM0RX-xLog-PreAlpha41-Backup-20261016T170644Z/OM0RX-xLog.app`
- The backup reports version `0.4.0-alpha.40` and passes strict deep signature verification.
- User contacts, logbook mode, credentials, station settings, and saved workspace data were not modified by packaging or installation.
