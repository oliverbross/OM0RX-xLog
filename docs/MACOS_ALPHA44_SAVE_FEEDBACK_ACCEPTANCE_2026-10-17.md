# macOS alpha.44 save-feedback acceptance — 2026-10-17

## Outcome

Save acknowledgements no longer occupy document flow. Successful saves now show
a small fixed confirmation overlay for 1.5 seconds, using page-specific text such
as `Settings saved`, `Cluster settings saved`, or `Rotor settings saved`. Save
failures use the same fixed overlay treatment for five seconds with alert
semantics, so they remain visible without moving the page.

Persistent recovery controls and non-save operational state remain inline where
the operator must act on them.

## Coverage

The shared save-feedback component is used by Settings and Backups, credentials,
online logs, radio-spot settings, reference schedules, rotor settings, workspace
settings, Sync configuration, spot bridge, WSJT-X, cluster settings and password,
saved logbook filters, agent connection setup, alert rules, and station-agent
configuration.

## Source and package

- Source commit: `976418554a783ec1c4e3a4a21b3cbe0a482c3689`
- Branch: `codex/macos-alpha33-release`
- Version: `0.4.0-alpha.44`
- Installed app: `/Applications/OM0RX-xLog.app`
- Developer ID: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- Installed main binary SHA-256: `7b47a0b648a8466c9e5160c4f2c501bc47fb93db7143d46168a088733e11edd0`
- Installed worker SHA-256: `6088004c24a3e8f5a345e9dcad0c1cc62300cb30e3ebdc8c21a57f02a7f167bd`

The packaged and installed binary hashes match. Both bundles pass strict deep
code-signature verification.

## Verification

- Focused affected UI suite: 14 files, 161 tests passed.
- Supplemental save-surface suite: 94 tests passed. This overlaps the focused
  suite and is not added to its count.
- TypeScript typecheck: passed.
- Production Vite build and window-bundle checks: passed.
- macOS packaging checks: passed.
- Packaged-app native acceptance: 33/33 checks, `status: passed`,
  `scope: integrated-local-ui`, `embeddedUi: true`, `worker: true`,
  `station_io: false`.
- Installed-app native acceptance: the same 33/33 checks and flags passed from
  `/Applications/OM0RX-xLog.app`.

## Rollback

The previously installed, strictly signed `0.4.0-alpha.43` app was moved intact
to:

`/Users/oliver/Documents/OM0RX-xLog-PreAlpha44-Backup-20261017T033100ACST/OM0RX-xLog.app`
