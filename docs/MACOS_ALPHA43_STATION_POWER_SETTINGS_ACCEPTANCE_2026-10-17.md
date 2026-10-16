# macOS alpha.43 Station identity and measured-power acceptance — 2026-10-17

## Outcome

OM0RX-xLog `0.4.0-alpha.43` centers the Station identity labels and editable values and generalizes automatic transmit-power capture beyond the KPA500-specific contract.

## Behavior

- Station identity text and number values are centered without changing checkbox geometry.
- Automatic power accepts explicit measured-watt telemetry from a radio or amplifier provider through one freshness-, session- and provenance-checked pipeline.
- KPA500 output remains supported and retains amplifier-output provenance.
- A radio-provided output meter is retained with `radio_output` provenance.
- FLEX RF drive and other configured power levels remain control settings, not measured output watts.
- The configured default remains the fallback, and an operator-entered TX power remains a manual override.

## Source and verification

- Source commit: `a3555e6` (`Generalize measured power capture settings`)
- Branch: `codex/macos-alpha33-release`
- Settings tests: 27 of 27 passed.
- Draft-power UI tests: 65 of 65 passed.
- Native measured-power and canonical draft-power tests: 27 of 27 passed.
- Total focused tests: 119 of 119 passed.
- Production TypeScript/Vite build and detached-window bundle checks passed.
- The Impeccable layout detector returned no findings.
- macOS package build passed, including worker self-test, Hamlib helper verification and Developer ID signing.

## Bundle acceptance

- Installed bundle: `/Applications/OM0RX-xLog.app`
- Version: `0.4.0-alpha.43`
- Built-bundle native acceptance: 33 of 33 checks passed.
- Installed-bundle native acceptance: 33 of 33 checks passed.
- Acceptance scope: `integrated-local-ui`
- Embedded UI: true
- Worker: true
- Station I/O: false; synthetic acceptance did not send hardware or radio commands.
- Signing authority: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- Main executable SHA-256: `1d7e4d344a50af44850ee4c526d4c1147758ceb67106f5ac2dc44d08609a7208`
- Worker SHA-256: `5d1e0c271952fe837f47879e2a189304ae9ec142f601d9710ed5dd0502918a46`
- Installed and built executable hashes match.
- Runtime after installation: one main application process and one packaged worker process running.

## Evidence boundary

- The native tests prove that explicit radio output-meter telemetry is admitted and persisted through the same guarded path as amplifier output.
- Actual meter availability remains provider- and radio-dependent. A provider that reports only drive percentage cannot supply automatic measured watts.
- No live RF transmission was made during acceptance.

## Rollback

- Previous alpha.42 bundle: `/Users/oliver/Documents/OM0RX-xLog-PreAlpha43-Backup-20261016T173825Z/OM0RX-xLog.app`
- The rollback copy reports version `0.4.0-alpha.42` and passes strict deep signature verification.
- User contacts, credentials, station configuration and saved workspace data were not changed by installation.
