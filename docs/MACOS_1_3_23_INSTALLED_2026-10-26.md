# Installed macOS 1.3.23 — contest input and SCP recovery

The operator explicitly authorized replacing the running application with the already verified candidate. On 26 October 2026 at approximately 00:20 Australia/Darwin, `/Applications/OM0RX-xLog.app` was replaced with version **1.3.23**, exact packaged source **`9c8d648caed13d24745392551c878c90b7a750fa`**. No rebuild was performed. The installed Info.plist, executable and worker hashes match the [verified candidate](MACOS_1_3_23_CANDIDATE_2026-10-26.md), and deep/strict signature verification passed.

The active recording was stopped through the Recorder window before quitting. The UI confirmed **Capture finalized**, 4,660 seconds synced / 223,713,280 frames, and 33 durable bookmarks in that archive. The application then quit normally. The finalized archive remains intact; the upgrade interval is a recording interruption, not recorded audio.

## Preservation and rollback

- Closed-app backup: `/Users/oliver/Documents/Backups/OM0RX-xLog-1.3.23-before-install-20261026T001939+0930`.
- It contains 347 protected files / 4,985,244,189 bytes covering the normal working copy, integration services/settings, app-support recordings, WebKit storage and existing preferences. Copied hashes matched, and these files remained byte-identical after installation and before launch.
- The initial backup omitted the separate `/Users/oliver/Library/Application Support/Contesting` root. This was corrected with a clearly separate **post-reopen** consistent SQLite online-backup supplement at `contest-data-after-reopen` inside the backup above. It contains 29 files, including the active contest store, other contest stores, SCP cache and host metadata. SQLite copies passed integrity checks; active-store counts were 588 DXLOG rows, 597 identity rows and 659 audit rows. This supplement is not represented as a pre-install snapshot.
- All 253 original WAV files retained their closed-app SHA-256 hashes after reopening.
- Replaced application retained for rollback: `/Applications/OM0RX-xLog-previous-20261025T144956Z-83965.app`.
- Candidate, installation, recording-preservation and contest-supplement receipts are retained privately beside the signed candidate at `/Users/oliver/Documents/Builds/OM0RX-xLog-1.3.23-contest-input`.

## Installed observations

Main Logging reopened in the same CQ WW SSB contest with **588 QSOs / 109 multipliers**, score **79,461**, matching the pre-install display. The operator's blank draft was restored initially; normal operator input resumed during verification. No test contact or manual tune/PTT/CW/rotor command was issued for acceptance.

Recording was resumed through Start / Resume to restore its pre-upgrade active state. The installed Recorder showed an advancing synced duration and input activity. Main Logging was left foreground with recording active (1:12 synced at the final observation). No listening playback was started, and listening-route verification was not changed.

This confirms package identity, preservation, session restoration and capture resumption. The cursor and SCP fault cases retain their automated/isolated-browser acceptance documented with the candidate; they were not injected into the operator's live draft. No RF/hardware acceptance or notarization is inferred. Future rollback must preserve newer contacts and recordings rather than restoring this snapshot over later work.
