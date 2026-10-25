# Installed macOS 1.3.20 — recording off

The operator explicitly authorized installing the existing 1.3.20 candidate, preserving the current log/settings/rollback, leaving recording off, with no audio tests or station actions.

On **25 October 2026, 15:08 Australia/Darwin**, the repository installer replaced `/Applications/OM0RX-xLog.app` with the previously verified candidate. Application source is unchanged: **`5e48489f6a1d2408920ed0a29d4d7da173a295d4`**. All six recorded component hashes match the candidate; both embedded source receipts match; Developer ID deep/strict signature verification passed. CDHash: `ea1e7a58f3c5ba5fea8e299885be0032ad72e434`.

The previous application was closed normally before the preservation snapshot. The current contest contains **376 QSOs**; the copied closed-app database passes SQLite integrity checking. Its contact identities, audit, session/draft and operation receipts are preserved. Full application data, preferences and WebKit settings were backed up and compared; their file hashes are **byte-for-byte unchanged after installation**.

- Private data/settings backup: `/Users/oliver/Documents/Backups/OM0RX-xLog-1.3.20-before-install-20261025T150739+0930`.
- Verified **1.3.18** rollback bundle: `/Applications/OM0RX-xLog-previous-20261025T053812Z-12663.app`. Its executable, worker and Info.plist hashes match the app that was replaced.
- All pre-existing rollback bundles remain present. The original recorder implementation checkpoint remains separate and preserved.

**Recording is off.** No recorder configuration existed at installation, and no recording setup was created or armed. The installed application was **left closed** so saved startup auto-connect settings could not initiate station activity. The operator controls the next normal launch.

No application executable, audio fixture, device enumeration, microphone/output stream, tune/PTT/CW/rotor control or other station test was run during this installation. Verification was limited to files, metadata, signatures and data preservation. Earlier candidate test evidence remains historical; physical recorder acceptance is still **NOT READY** until the connected-route tests and source soak are separately authorized.

[Installation and preservation receipt](evidence/1.3.20/installation-receipt.json). Private full file manifests and copied databases stay in the local backup folder; no contact data is published. No rebuild or application source change was needed.
