# Not1MM operator acceptance — updated 21 October 2026

This checkpoint records demonstrated desktop behavior for the original executable
Not1MM Python/SQLite host inside xLog. It is not a claim that the complete Not1MM
port or a public macOS release is finished.

## Candidate identity and installation

- Installed version/build: `1.2.86`.
- Exact application source: `ed669dcf89d3d0c9e4c8a0f7dad994cace45a9e5`
  on `codex/not1mm-contesting`, pushed to GitHub with a clean working tree.
- The production and isolated Contesting Test bundles both embed that source
  commit and record an empty `sourceChanges` array. Distribution metadata lists
  344 resolved components.
- `codesign --verify --deep --strict` accepted both bundles. The production app
  is signed by Developer ID team `4WCMQ4U946`.
- `/Applications/OM0RX-xLog.app` was replaced with the exact production bundle.
  Version 1.2.81 remains recoverable at
  `/Applications/OM0RX-xLog-1.2.81-pre-1.2.86-20261021.app`.
- Application Support, contest databases, normal logs and settings were not
  moved, replaced or deleted during installation.
- Gatekeeper reports `Unnotarized Developer ID`; notarization is therefore still
  required before this candidate can be called a public macOS release.

Acceptance hashes:

- Production executable: `5d169f138f14188908de795374a294a13000a88493fe3effed600227806b9e9b`
- Production Swift worker: `4b11acac48ae0707b93034e889c3f4b189b69beb63ab3995aaea655d7ca5e617`
- Production Python manifest: `c3de7ed0963b85b8e44663e3b3745a6f01d70fe8a345636d1aa5dec7de5f1c80`
- Contesting Test executable: `92c113b231eb1989b58a4c482ae32149ac68f63b2c76d14ace485311d44866cf`
- Contesting Test Swift worker: `b4dc862385b403311206af5e539cad0204705560686666fbc103b9ddf11211e6`
- Contesting Test Python manifest: `7c9d5e2e4b2b5a2609eba0d480c0cdd001c8d4bb38e3dbe7caa34990c1606405`

## Packaged native acceptance

The actual packaged 1.2.86 Contesting Test executable completed its native
acceptance harness with exit code zero. The fresh report at
`/private/tmp/om0rx-xlog-1.2.86-native-acceptance-20261021.json` records schema 1,
status `passed`, `embeddedUi: true`, `worker: true`, `station_io: false`, and all
35 checks true.

The passing checks include native menu routes, keyboard logging/focus/clear,
contact edit/delete/undo, ADIF transfer, Settings save/readback, native Logbook,
Awards and Band Map windows, saved window lifecycle, and Spot History continuing
to read its 137-row SQLite fixture after the main renderer was destroyed and then
docking back without changing the operator draft.

The combined Contesting Test/local-acceptance startup defect was fixed in
`2f22b7cf`. A second defect found by the packaged run was fixed in `0c883fc0`:
the Contesting Test method gate had rejected safe Spot History reads after the
stricter synthetic acceptance whitelist had already admitted them. Normal
Contesting Test operation remains unable to call live station or external-service
methods.

## Demonstrated contest workflows

All contest workflows below used separate native windows and the isolated
nontransmitting test facilities. No QSO was transmitted over RF.

### CQ WPX SSB

- Opened a CQ WPX SSB session and invoked F3 through the authentic Python plugin.
  The UI confirmed `SSB · Exch 59 001`; no QSO was logged by the macro action.
- Tab advanced from Callsign to SNT.
- Logged `K1ABC` in S&P with received serial 100 and `DL1ABC` in Run with received
  serial 200. A duplicate `K1ABC` attempt was blocked.
- Corrected the historical `DL1ABC` report from 59 to 58 without changing its
  Run/S&P metadata. Stats and Rates retained one Run and one S&P QSO.
- Restarted the packaged app, reopened the contest and observed score 8, next
  serial 003 and the corrected report.
- `/private/tmp/OM0RX-WPX-1.2.84.cbr` contains `CQ-WPX-SSB`, score 8 and both
  corrected contacts.

### ARRL Sweepstakes Phone

- Created a Phone session with sent exchange `A OM0RX 67 CT`.
- F3 confirmed `SSB · Exch K1ABC 001 A OM0RX 67 CT` without logging a QSO.
- Logged `K1ABC / 123 A K1ABC 67 CT` in S&P and
  `DL1ABC / 456 B DL1ABC 72 CT` in Run.
- Corrected only the second historical section from CT to EMA. Restart restored
  score 8, serial 003 and the EMA correction.
- `/private/tmp/OM0RX-SS-1.2.84.cbr` contains `ARRL-SS-SSB`, score 8 and the
  corrected exchange.

### CQ WW SSB

- Created a CQ WW SSB session with station zone 15.
- F3 confirmed `SSB · Exch 59 15` without logging a QSO.
- Logged `K1ABC` zone 5 in S&P and `DL1ABC` zone 14 in Run. The score progressed
  from 6 to 16, and a repeat `K1ABC` was blocked as a duplicate.
- `/private/tmp/OM0RX-CQWW-SSB-1.2.84.cbr` contains `CQ-WW-SSB`, claimed score 16
  and the correct received zones.

### CWT/SST name workflow

- Created CWT with sent exchange `OLIVER 1234` and logged two contacts with
  different received names: `K1AAA / ALICE / 1234` and
  `K2BBB / BOB / 5678`.
- Received Name was editable and cleared for the next QSO.
- Correcting the second Name to ROBERT preserved ALICE and both historical sent
  exchanges. Restart and export retained the corrected/history values.
- Setup rejects an invalid sent exchange rather than saving partial settings.

### CQ WPX CW detached-window ownership

- In the actual packaged 1.2.86 Main Logging window, CQ WPX CW restored Callsign
  `K1ABC`, reports 599, sent serial 001 and zero QSOs.
- Explicit Arm enabled the nontransmitting CW simulation. F3 clicked in Main
  Logging stayed armed and created an authentic Python `function_key` operation
  with label `Exch` and template `{RST} {SENTNR}`.
- Escape disarmed immediately. After rearming and focusing Callsign, a physical
  F3 created a second distinct `function_key` operation.
- Both operations have matching rows in `xlog_output_claim`; `DXLOG` remained at
  zero QSOs. This demonstrates both button and keyboard routing from the actual
  detached Main Logging owner.
- The fix in `f5722c41` uses a one-shot, action-matched, context-bound native focus
  admission only for Contesting Test simulation. Production CW still requires
  live focus and its normal output authority.

## Review findings and reliability work

The findings from the independent reviews were rechecked against current source:

- Main Logging now owns CW, Enter/ESM, Tab and function-key focus routing.
- Native command admission accepts authentic Not1MM phone macro labels, while
  retaining Stop, focus and replay protections.
- Same-session reopen cannot replace a newer recovery projection with an older
  `contest_open` result; recovery is fenced by session, revision and workspace
  generation (`4704c4a4`).
- CWT/SST received Name editing/clearing and historical sent-exchange preservation
  are covered.
- WPM targets the selected radio owner; Call History retry passes native command
  admission; spot-selection failure returns to the originating window; Edit Keys
  saves bounded tuples and executes the supported action set.
- Buffered entry and current frequency survive owner handoff.
- Log queries no longer stop at 100 contacts, and large export uses its supported
  artifact route.
- Corrections no longer rewrite historical Run/S&P metadata.
- Official Super Check Partial download succeeded against a disposable cache;
  the active cache was not overwritten by the test.

## Cluster mode intelligence

Fresh spot ingestion now gives bounded explicit digital comment evidence priority
over frequency-only inference. `FT8`/`FT-8`, `FT4`/`FT-4`, FT2, RTTY/JTTY, PSK
variants, JT65/JT9, OLIVIA, HELL, MFSK, SSTV, DIGI/DIGITAL and bounded DATA markers
are recognized. The reported 7P8GE spot at 28.088 MHz with comment `FT-8 TNX 73s`
therefore classifies as data/FT8 rather than CW. Frequency inference remains in
use when no explicit comment marker exists, and previously persisted rows are not
silently rewritten.

The installed production app also demonstrated that the logic remains bounded:
a current 7P8GE spot at 24.902 MHz with comment `up.4 gl still` remained CW.

## Installed-app preservation smoke

The installed 1.2.86 production app opened the existing workspace successfully:

- 68,374 normal-log contacts were visible.
- The requested C5R contact was present at 09:41 UTC on 20 October 2026, 12 m SSB,
  24.950 MHz. A later C5R contact at 09:55 UTC on 15 m was also present.
- Existing station identity `OM0RX / JN88TQ`, the connected rotor projection,
  cluster connection and saved Traditional layout were retained.
- The native Contest menu exposed Contest Setup, Station Settings, Configuration
  Settings, Call History, QRZ Details, Main Logging, Stats, Logbook, Band Map,
  Cluster, Check Partial, Rates, DXCC, Zone, Rotator and Remote VFO.

This smoke establishes local retention and display. It does not by itself prove a
remote Wavelog upload receipt for C5R.

## Exact remaining limitations

- Notarization is incomplete.
- No physical RF, voice playback, PTT, amplifier, tuner or rotor action was
  exercised in this acceptance. The Contesting Test profile intentionally blocks
  those paths.
- Production SSB voice-keyer output has no accepted native audio/PTT authority;
  the demonstrated phone path is a nontransmitting simulation.
- Digital output has no accepted sink, so CQ WW RTTY is not yet an end-to-end
  operating workflow.
- AutoCQ is stored but has no complete runtime consumer. N1MM packet/RTC,
  group/multi-operator networking and Group Chat remain absent or inert.
- The executable catalog contains 21 pinned original plugins out of 94; 73
  original plugins still need to be brought through this same Python host.
- Normal-log transfer/finalization and automatic restoration of the active
  contest/window set remain incomplete.
- Dedicated Operator, Rover and About dialogs and some original configuration
  workflows remain to be reproduced.
- Setup still exposes broader VHF/UHF choices than the current HF contest host,
  and Cabrillo export remains limited to the connected contest exporters.
- Physical real-station and Wavelog receipt checks remain separate acceptance
  boundaries. Available software work continues without treating them as a stop.
