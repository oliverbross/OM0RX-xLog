# macOS alpha.42 Operator Desk map-return acceptance — 2026-10-17

## Outcome

OM0RX-xLog `0.4.0-alpha.42` fixes the repeated, compressed world-map rendering seen after leaving and returning to Operator Desk.

## Root cause and correction

- MapLibre could calculate an automatic route or data camera against its temporary 400 × 300 construction viewport while the returning Desk was still laying out.
- The existing resize owner correctly repaired the WebGL canvas, but intentionally preserved the already-calculated camera. On a wide, shallow Desk map this exposed multiple wrapped copies of the same world.
- The map now detects that fallback construction viewport and repeats only its automatic camera fit after the first settled visible resize.
- Ordinary window resizing, canvas resizing, map/logbook split changes and operator-controlled camera movement continue to preserve the current camera.
- Wrapped world copies are disabled for this world-overview surface, preventing duplicate geography even if another transient viewport is encountered.

## Source and verification

- Source commit: `5039203` (`Fix Operator Desk map after route return`)
- Branch: `codex/macos-alpha33-release`
- Focused map tests: 23 of 23 passed.
- Operator Canvas and Desk map/logbook tests: 34 of 34 passed.
- Total focused tests: 57 of 57 passed.
- The regression test reproduces a 400 × 300 construction viewport followed by a 1,440 × 260 settled Desk viewport and verifies the final route fit uses the settled dimensions.
- Production TypeScript/Vite build and detached-window bundle checks passed.
- The Impeccable layout detector returned no findings.
- macOS package build passed, including worker self-test, Hamlib helper verification and Developer ID signing.

## Bundle acceptance

- Installed bundle: `/Applications/OM0RX-xLog.app`
- Version: `0.4.0-alpha.42`
- Built-bundle native acceptance: 33 of 33 checks passed.
- Installed-bundle native acceptance: 33 of 33 checks passed.
- Acceptance scope: `integrated-local-ui`
- Embedded UI: true
- Worker: true
- Station I/O: false; the synthetic acceptance did not send hardware or radio commands.
- Signing authority: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- Main executable SHA-256: `3db17da023969109e0583632074c52fec35f2b4af11e53117381164338ca25aa`
- Worker SHA-256: `761f76b5b80020a1d605d1e1a25b3bc8b794a405f5acd83884c7d5cd34724552`
- Installed and built executable hashes match.
- Runtime after installation: one main application process and one packaged worker process running.

## Rollback

- Previous alpha.41 bundle: `/Users/oliver/Documents/OM0RX-xLog-PreAlpha42-Backup-20261016T172025Z/OM0RX-xLog.app`
- The rollback copy reports version `0.4.0-alpha.41` and passes strict deep signature verification.
- User contacts, credentials, station configuration and saved workspace data were not changed by installation.
