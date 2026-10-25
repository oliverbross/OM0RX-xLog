# Installed macOS 1.3.21 — contest restored, recording resumed

The operator explicitly authorized installing 1.3.21, preserving the log, settings and recordings, and restoring contest windows. After reopening, the operator separately requested starting the recorder. Normal saved station startup was already authorized; this installation did not change that preference or issue manual tune/PTT/CW/rotor commands. No playback or audio test was run.

On 25 October 2026, the verified candidate at source **`d2d9c90f5932b7ed6ce845e87986b739909301c1`** was installed at `/Applications/OM0RX-xLog.app`. Candidate component hashes match; Developer ID deep/strict signature verification passed. CDHash: `849ce80e27aecf8ba0926894ae976146cc8e8072`. No rebuild was used for installation.

The closed-app backup contains 844 files / 2,860,300,816 bytes. All protected files were byte-identical after installation and before reopening; the copied contest database passed SQLite integrity checking. All **443 pre-install contacts**, contact identities and audit rows remain unchanged after reopening. The operator resumed normal logging; the later verification snapshot contained 447 QSOs, so whole-database equality after launch is neither expected nor claimed. Core settings and recorder configuration remain unchanged.

The native Window menu confirmed all nine contest windows restored: Main Logging, Band Map, Callsign Details, Check Partial, Cluster, Log Display, Rates, Spots Map and Stats. The compact Main Logging recorder strip is visible in the installed app.

## Recording preservation and restart

Normal application quit did not finish the last recorder journal; the pre-install backup preserved the complete existing archive and partial original. Startup recovered its valid tail into a new `.recovered.wav`. All **64 original WAV/partial files** retain their pre-install SHA-256 hashes; the recovered PCM is byte-identical to the original partial payload. The archive now has 64 completed segments, **63 minutes 25.46 seconds** and all **62 prior QSO bookmarks** unchanged. The archive truthfully records the application interruption; the upgrade interval is not represented as recorded audio. This close/finalization limitation remains visible in the evidence and is not claimed fixed by the UI-only release.

Recording initially stayed stopped. Following the operator's explicit request, Start / Resume opened the saved CalDigit input at 48 kHz stereo in a new capture, `7ee48fe9-f10a-4118-aeea-9c5c81815fcd`. The installed strip showed an advancing synced duration. Read-only inspection verified **41.12 seconds synced**, no gaps in the new run, and non-silent PCM on both channels (recent peaks approximately 33%). Recording was left running. No listening route or transmit path was used by this check.

## Backup and rollback

- Full private data/settings/recordings snapshot: `/Users/oliver/Documents/Backups/OM0RX-xLog-1.3.21-before-install-20261025T164006+0930`.
- Verified 1.3.20 rollback: `/Applications/OM0RX-xLog-previous-20261025T071037Z-30555.app`; executable, worker and Info.plist match the replaced app.
- All earlier rollback applications remain present. The private backup includes the pre-install file manifest, database validation copy, installation comparison and restoration results. No production contact contents are published.

The [installation receipt](evidence/1.3.21/installation-receipt.json) records exact identity and preservation. [Candidate and layout evidence](UI_STRIP_1_3_21.md) remains separate from these installed-app results. Future installation/rollback must first stop and verify finalization of any active recording and preserve the latest log/settings/recordings; do not restore an older database over newly logged contacts.
