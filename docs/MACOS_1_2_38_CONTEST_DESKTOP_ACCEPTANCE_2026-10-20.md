# OM0RX-xLog 1.2.38 contest desktop acceptance — 2026-10-20

## Installed build

- Branch: `codex/not1mm-contesting`
- Exact packaged source commit, pushed before packaging: `f086fbb11256e61e53ae42f14056ebec0bcdc9bf`
- This acceptance record follows the packaged source commit on the same pushed branch; it does not alter the installed bundle.
- Runtime provenance: the installed `Not1MM/python-runtime.json` records that source commit with `sourceChanges: []` and `hashPhase: final-component-signatures-before-outer-app-signature`.
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Version and build: `1.2.38`
- Bundle identifier: `com.oliverbross.xlog.integration`
- Developer ID: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- CDHash: `ccb65024cd6cd50c746257b18eaacd0c95280eb7`
- `CodeResources` SHA-256: `c6108539d969ba697aa02c93d8bd3e71b3f8ca928a3493085ad207adca46714b`
- Strict deep signature verification passed for the packaged candidate and installed application.
- Gatekeeper reports `Unnotarized Developer ID`; notarization remains a separate release step.

## Recovery and data preservation

The prior installed application and discovered xLog/contest data were preserved under:

`/Users/oliver/Documents/Backups/OM0RX-xLog-before-1.2.36-20261019T151013Z`

That recovery set contains the original 1.2.35 application plus the preserved 1.2.36 and rejected 1.2.37 intermediate applications. The 1.2.38 replacement did not replace or migrate the normal-log database.

The active normal-log database remains:

`/Users/oliver/Library/Application Support/OM0RX-xLog-Integrated Preview/OM0RX-xLog.sqlite`

After the final installed-app shutdown it reports:

- `PRAGMA quick_check = ok`
- `68,319` total rows
- `68,318` active rows
- `1` deleted row
- QSO revision `100625`
- retained draft `DB3KE`, 20 m SSB, `14,166,000 Hz`
- compact Operator Desk logbook `1–15 of 68,318`

The two newest station-log contacts, VE2BJG and K8NVR, predated this installation; the packaged application performed only its normal background reconciliation. Acceptance did not create, edit, delete, import, or export a normal-log QSO.

Contest storage remains separate from the normal log. The original CQ WW database is healthy and unchanged at session revision `1`, `0` QSOs, operator `OM0RX`, sent exchange `15`, and manual frequency `14,025,125 Hz`. The empty database left by the earlier rejected-create path is retained, remains healthy, and is ignored read-only by session discovery.

During final installed UI acceptance, the New Contest submit path reached the real Python host and created a second empty CQ WW session. That acceptance artifact was archived recoverably under `acceptance-artifacts-1.2.38` in the recovery set rather than left in the active contest list or deleted: session `fbe19482-fff4-4715-82c7-42ba7ad40df7`, revision `2`, `0` QSOs, operator `OM0RX`, sent exchange `15`, and manual frequency `14,025,125 Hz`. No contest QSO was logged. A final installed-app restart recovered the original CQ WW session automatically.

## Actual packaged desktop behavior

Acceptance used the exact installed signed Tauri application, not mocked UI requests.

The normal application loaded the retained `DB3KE` draft, OM0RX station identity, cluster connection, and full station Logbook. The original station logging workflow remains in the main application. The earlier Normal Logging/Contesting mode buttons are absent.

The native macOS **Contest** menu contains:

- Contest Setup
- Main Logging
- Stats
- Logbook
- Band Map
- Cluster
- Check Partial
- Rates
- DXCC
- Zone
- Rotator
- Remote VFO

Contest Setup, Main Logging, Statistics, contest Logbook, and Check Partial were each opened and observed as independent, repositionable native windows. The service-owned Band Map, Cluster, Rotator, and Remote VFO menu routes reuse xLog's existing station windows.

The installed Main Logging window displayed the connected CQ WW Python session with `14,025.13 kHz`, CW, operator OM0RX, Run/S&P state, callsign/SNT/RCV/CQ Zone fields, CW speed, 12 function-key macros, contact heading, and QSO/multiplier/score footer. Statistics displayed the verified score projection. Contest Log displayed the Not1MM column layout and `No contacts`. Check Partial displayed the Log, Master, Telnet, and Call history surfaces.

Contest Setup recovered the original valid CQ WW session despite the adjacent empty rejected-create database. Choose a Contest listed valid sessions only. New Contest loaded the real Python plugin catalog and submitted through the native-command/Python/SQLite path. Setup exposes the Not1MM station, contest, configuration, macro, and key editors while using xLog visual styling.

The session-discovery repair is read-only: corrupt, empty, foreign, and structurally invalid stores are skipped without mutation. A stale remembered session auto-recovers only when exactly one valid session exists; with multiple valid sessions the app waits for an operator choice rather than selecting arbitrarily.

## Verification

- Actual installed Tauri UI acceptance: passed for the main station log, native Contest menu, Contest Setup, Main Logging, Statistics, contest Logbook, and Check Partial.
- Frontend/Node regression: `258` test files, `3,555` tests passed.
- Python Not1MM host regression: `68` tests passed.
- TypeScript: `tsc --noEmit` passed.
- Production packaging build and detached-window bundle check: passed.
- macOS package preflight: `4` checks passed.
- Packaged worker self-test: passed.
- Installed bundle signature/provenance verification: passed.

The installed app was quit cleanly after acceptance; no `OM0RX-xLog`, packaged worker, or contest-host process remained.

## Exact remaining limitations

- This is not yet the complete Not1MM port. The Python host currently covers CQ WW, WPX, Sweepstakes, and ICWC MST; the remaining Not1MM plugins and their contest-specific windows/workflows still have to be carried through the same host.
- SSB/digital and multi-operator behavior are not complete.
- The Sound configuration tab is unavailable until contest audio has a single service owner.
- ICWC MST uses a unique-call multiplier model, so generic DXCC and Zone projections are not applicable; its remaining packed-exchange editing is still generic.
- No RF transmission, CW output, PTT, amplifier action, rotor command, or real-radio QSO was initiated during acceptance.
- The app is Developer ID signed but not notarized.

This is an installed CQ WW desktop checkpoint and a preserved-data replacement, not a declaration that the complete Not1MM port is finished.
