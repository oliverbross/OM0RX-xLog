# OM0RX-xLog 1.2.35 contest desktop acceptance — 2026-10-20

## Installed build

- Branch: `codex/not1mm-contesting`
- Exact source and pushed branch head: `0d369c5c4b355e877eb939ed3a5409705626bdf2`
- Runtime provenance: the bundled `Not1MM/python-runtime.json` records that source commit with `sourceChanges: []` and `hashPhase: final-component-signatures-before-outer-app-signature`.
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Version: `1.2.35`
- Bundle identifier: `com.oliverbross.xlog.integration`
- Developer ID: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- CDHash: `1bdceb3d8112069b944bee2df3cbd6a9a1d13e88`
- `CodeResources` SHA-256: `fac738d78c7273715eb7b157e1beb643cf9e90525dd6c74ae41ab27b63deae59`
- Strict deep signature verification passed before and after installation.
- Gatekeeper reports `Unnotarized Developer ID`; notarization remains a separate release step.

## Recovery and data preservation

The prior 1.2.28 application and all discovered xLog, xCluster, contest, bundle-support, and preference data were copied to:

`/Users/oliver/Documents/Backups/OM0RX-xLog-before-1.2.35-20261020T000550`

The backup is 1.4 GB. Its prior app signature verifies, its normal database reports `quick_check=ok`, and its contest database reports `quick_check=ok`. The original installed bundle was also moved into that backup during the recoverable swap.

The normal-log database is:

`/Users/oliver/Library/Application Support/OM0RX-xLog-Integrated Preview/OM0RX-xLog.sqlite`

The similarly named zero-byte file under `OM0RX-xLog Integration Services` is not the active normal-log store. The active database was identified from the packaged worker's open files and checked directly.

Before replacement and after the final installed-app shutdown, the active normal database had identical results:

- `68,317` total rows
- `68,316` active rows
- `1` deleted row
- QSO revision `100620`
- retained draft `DB3KE` at `14,166,000 Hz`
- `PRAGMA quick_check = ok`

The CQ WW contest database also remained unchanged:

- `0` contest QSOs
- session revision `1`
- `CQ WW CW`, operator `OM0RX`
- retained manual frequency `14,025,125 Hz`
- `PRAGMA quick_check = ok`

No QSO was created, edited, deleted, imported, or exported during acceptance. No setup, macro, or key change was saved.

## Actual packaged desktop behavior

Acceptance used the signed packaged candidate and then the exact installed bundle, not mocked UI requests.

The normal application loaded the retained `DB3KE` draft, OM0RX station identity, cluster connection, and full Logbook. The full Logbook displayed `Local working copy · 68,316 contacts`, rows beyond the first 100, and the existing import/export controls.

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

Each destination opened as a separate repositionable native window. The contest-owned windows received their Tauri event capability; the rejected 1.2.34 candidate's `plugin:event|listen not allowed by ACL` error is absent.

The installed Main Logging window displayed the connected CQ WW context: `14,025.13 kHz`, CW, operator OM0RX, Run/S&P state, callsign/SNT/RCV/CQ Zone entry, 12 function-key macros, contact heading, and QSO/multiplier/score footer. Stats, contest Logbook, Check Partial, Rates, DXCC, and Zone rendered their Not1MM data projections. Band Map, Cluster, Rotator, and Remote VFO opened the existing xLog service windows.

Contest Setup opened the saved CQ WW session and its Not1MM configuration surfaces:

- Station Settings
- New Contest
- Choose a Contest
- Edit Current Contest
- Configuration Settings: Lookup, Sound, CAT, CW, Rotator, Cluster, Group, N1MM, Bands, and Options
- Run and S&P macro editor
- key binding editor

The fields, tables, defaults, and controls follow the Not1MM operating layout while using xLog styling and service handoffs.

## Verification

- Focused native navigation/capability tests: `7 passed`
- Contest frontend contract suites: `73 passed`
- Production TypeScript/Vite build and detached-window bundle check: passed
- macOS package preflight: `4 passed`
- Packaged worker build and self-test: passed
- Relocated Python 3.12 runtime validation: passed
- Signed packaged candidate desktop acceptance: passed
- Exact installed bundle smoke test: passed

The installed app was quit cleanly after acceptance; no app, worker, or contest-host process remained.

## Exact remaining limitations

- This is not yet the complete Not1MM catalog port. The actual Python host currently covers CQ WW, WPX, and Sweepstakes; the remaining Not1MM plugins, their contest-specific configuration fields, and their workflows still have to be carried through the same host.
- SSB/digital and multi-operator behavior are not complete.
- No RF transmission, CW output, PTT, amplifier action, rotor command, or real-radio QSO was initiated during this acceptance.
- On the first installed launch, the compact Operator Desk logbook subpane briefly showed `Operation failed` and zero contacts while the 308 MB store was attaching. Opening the full Logbook route immediately loaded all 68,316 contacts. The preserved database was healthy before and after the run; the transient compact-pane startup retry remains a reliability item.
- The app is Developer ID signed but not notarized.

This acceptance is an installed CQ WW desktop checkpoint, not a declaration that the complete Not1MM port is finished.
