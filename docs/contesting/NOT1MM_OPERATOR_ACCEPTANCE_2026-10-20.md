# Not1MM operator acceptance — updated 21 October 2026

This checkpoint records demonstrated desktop behavior for the original executable
Not1MM Python/SQLite host inside xLog. It is not a claim that the complete Not1MM
port or a public macOS release is finished.

## Installed 1.2.97 batched milestone — 21 October

- Exact candidate and installed application source:
  `106ef154247983c125baf613d24659b551ad39ea` on
  `codex/not1mm-contesting`, pushed to GitHub with a clean working tree.
- The executable catalog contains 64 of the 94 byte-pinned original plugins.
  This batch adds ARRL Field Day, ARRL RTTY Roundup, the January/June/September
  ARRL VHF contests, ARI DX, DARC XMAS, EU-DX, LZ DX and WAG through the existing
  Python/SQLite host. No contest rules were translated into Swift or JSON.
- The shared UI batch restores Not1MM's two-pane Log Display/Edit Contact
  workflow in separate xLog-styled windows. It keeps native correction and
  deletion ownership, stale-revision protection and operating-draft isolation.
- The ARRL VHF host now covers 13 cm through sub-millimetre bands, >=2300 MHz
  scoring and AM/FM phone-report normalization. Central European correction
  replay preserves plugin-specific historical sent exchanges.

Exact-source automated checks passed 231 Python tests, 3,775 frontend tests
across 271 files, 730 Rust unit tests and 26 Rust integration tests. The Swift
worker built incrementally and its self-test passed; the production frontend,
worker staging, cached Hamlib helper and macOS package checks also passed. These
are supporting checks, not packaged-desktop proof.

The packaged application's isolated acceptance report is
`/private/tmp/om0rx-xlog-1.2.97-not1mm-acceptance-106ef154-20261021.json`.
Its SHA-256 is
`7ada7142b59e47d1b796a136c98d0d9242cb31e2b6bd47dd8a135691378912a4`;
it records schema 1, status `passed`, `embeddedUi: true`, `worker: true`,
`station_io: false`, and all 35 of 35 checks true.

The exact-source candidate was incrementally packaged, signed and installed at
`/Applications/OM0RX-xLog.app`. Deep strict verification passed for Developer
ID team `4WCMQ4U946`; Gatekeeper reports `Unnotarized Developer ID`. Candidate
and installed hashes match:

- Production executable: `f2227cc44d266a35c262f3ef861fc8f066d65be429308f0240ff0fd00a91553d`
- Swift worker: `38f0eeb59aed8cc4dd0da8698c445fc393de8ba849c95958f867eabb7af6e929`
- Not1MM runtime provenance: `7cd86aae38dd4aec456f487195e0ca30a85daf980e75de8d6aae806e561e380a`
- Not1MM source manifest: `7311ed3fee84b1f09d0004f2cd396a510803c761f66be083e0cd41d1778b71c8`

Actual installed-application QA launched the production bundle and opened
Contest Setup, Main Logging and Log Display through the native Contest menu as
separate windows. Each exposed the standard macOS close, minimize and zoom
controls. Main Logging restored the existing CQ WPX CW draft (`VK8R`, 599/599,
001/002, S&P, 25 WPM), current 14.348 MHz state, original macro grid, heading
and score projection. Log Display showed the always-present Chronological log
and Callsign partial matches panes with original columns plus the existing
native export/recalculate controls. The normal application simultaneously
loaded its existing 68,411-contact logbook and live cluster; application data,
contest databases, normal logs and settings were not moved or deleted. No QSO
was added, corrected or deleted and no transmit-capable control was used during
this check.

After exact installed-source verification, the temporary 1.2.96 replacement
bundle and twelve older 1.2.81–1.2.95 application bundles were deleted from
`/Applications`, releasing 2.0 GB. Historical sections below retain their
original checkpoint wording, but their statements that those bundles remain
recoverable are superseded by this cleanup. Git history and acceptance records
remain; Application Support, databases, logs and settings were untouched.

This is an implementation checkpoint, not the complete port: 30 original
plugins and their complete contest-specific workflows remain. The installed
check did not have a disposable contact in this active contest, so the new
Edit Contact presentation is covered by source regressions rather than a fresh
production-window edit. No physical RF, audio, PTT, amplifier, rotor, live peer,
sponsor-rule certification or notarization was demonstrated.

## Installed 1.2.96 batched milestone — 21 October

- Exact candidate and installed application source:
  `98fbe99c815141af0acfdeccfd1c0452762a0fdd` on
  `codex/not1mm-contesting`, pushed to GitHub with a clean working tree.
- The executable catalog contains 54 of the 94 byte-pinned original plugins.
  This batch adds the Estonian Field Day, LL KV, Manual Key and Open plugins,
  plus HADX, Helvetia, PACC and SPDX, through the existing Python/SQLite host.
- The shared workflow batch adds original-plugin ADIF export, original-plugin
  score recalculation, imported Call History in Check Partial, and the bounded
  Edit Keys actions for explicit Run/S&P, focus, CW speed and F1–F12 macros.
- No additional Python-to-JSON-to-Swift contest-rule translation was added.

Broad exact-source checks before the two native-route repairs passed 216 Python
tests, 3,772 frontend tests across 271 files, 755 Rust tests, four Swift Call
History lane tests, TypeScript compilation and the production/window bundle
checks. The subsequent native recalculation repair passed its Rust and Python
regressions. The final ADIF validator repair passed 21 focused Rust tests and
the Python host preparation regression. These are supporting checks rather than
desktop proof.

The exact-source isolated package report at
`/private/tmp/om0rx-xlog-1.2.96-not1mm-acceptance-98fbe99c-20261021.json`
has SHA-256
`9ffd1582af21594751d7af2d5849d0312d939431b95a08112dd246980a990b15`
and records schema 1, status `passed`, `embeddedUi: true`, `worker: true`,
`station_io: false` and all 35 of 35 checks true. The signed Contesting Test
hashes are:

- Executable: `11a0fcd52714480705911c1730ea0cdac5735b168385d362150f3e4908437181`
- Swift worker: `e193d7582e6559ae0dd607499b17cfbf2c18a2f2d956847faaf94079f72ad818`
- Not1MM runtime provenance: `c64ac12de05d01cad6056a6473064de45d95be9ed8b4f8551d2156f8fc414f22`

The same exact source was packaged, signed and installed at
`/Applications/OM0RX-xLog.app`. Deep strict signature verification passed for
Developer ID team `4WCMQ4U946`. Installed hashes are:

- Production executable: `40fe53020ba685a3f106475b13895acb9f70e814c383865f371676437a49cf6d`
- Production Swift worker: `6e0a4b9b2e84248ff02492be9a476df0150c400af23eb1f4c47cfbd3ba4bc498`
- Production Not1MM runtime provenance: `c4eb2dfc77ce47119b80dad5da1a67df1fce88e94c9353034a420294e54995c3`

Actual installed-application QA opened the separate Main Logging, Log Display,
Check Partial and Edit Keys windows through the native Contest menu. Each
exposed standard macOS close, minimize and zoom controls. Main Logging restored
the existing CQ WPX CW draft (`VK8R`, 599/599, 001/002, S&P, 25 WPM).
Recalculation completed through the visible Log Display without an uncertain
receipt and retained that draft. Export ADIF opened the native Save panel and
wrote `/private/tmp/OM0RX-CQ-WPX-CW-disposable-98fbe99c.adi`; SHA-256 is
`b164d8e09840e2f1b8750d3168fb3dca734c7646d054b0926a783180bb71cc70`.
The file has the original Not1MM ADIF 3.1.5 preamble and header. No contact was
added or changed during this acceptance run.

The first installed 1.2.96 check exposed that recalculation was omitted from the
native worker allowlist; `7fff7628` fixed it. The next packaged check exposed
that the native saver required ADIF 3.1.7 at byte zero while the original Python
host emits an exact Not1MM preamble followed by ADIF 3.1.5; `98fbe99c` now
admits only that bounded form or a header at byte zero and retains malformed
artifact rejection. The superseded `7fff7628` installed bundle was removed
after the exact-source replacement; application data, contest databases, normal
logs and settings were not moved or deleted.

This is an implementation checkpoint, not the complete port: 40 original
plugins and their complete contest-specific workflows remain. Phone ESM remains
nontransmitting without audio/PTT authority. No physical RF, amplifier, rotor,
live peer, sponsor-rule certification or notarization was demonstrated.
Gatekeeper still reports `Unnotarized Developer ID`, so 1.2.96 is not a public
macOS release.

## Installed 1.2.95 milestone — 21 October

- Exact candidate and installed application source:
  `25259a3f1e8bc6636dc6db01887e44a6f6179ec3` on
  `codex/not1mm-contesting`.
- The 21 October review corrections are present in `43986f10`, `1effbaad` and
  `2a6c34ae`; subsequent reliability fixes include EUHFC historical exchange
  editing (`1f1afe65`), cold-start Edit Keys ownership (`83e76702`), native
  Save-panel terminal receipts (`a4538691`) and the dedicated QRZ Details plus
  read-only Remote VFO projections (`25259a3f`).
- The executable catalog contains 46 of the 94 byte-pinned original plugins.
  King of Spain CW/SSB, French REF CW/SSB, RSGB 80m CC and RSGB Commonwealth
  BERU were added without translating their contest rules into Swift or JSON.

The packaged EUHFC workflow demonstrated CW and SSB QSOs in one contest,
59/599 report switching, Run/S&P and keyboard/function-key operation, score
updates, historical correction, restart recovery and a valid mixed Cabrillo
export. `/private/tmp/OM0RX-EUHFC-disposable-a4538691.log` has SHA-256
`32d1c85cd6b0e0be17acecb24cc68119962328a9fb0e32e86efd87c6cd71e2a2`,
`CATEGORY-MODE: MIXED`, the preserved sent year 26 and corrected received year
31. The native Save panel returned to an enabled Export control without an
uncertain receipt.

The final exact-source Contesting Test report at
`/private/tmp/om0rx-xlog-1.2.95-not1mm-acceptance-25259a3f-20261021.json`
records schema 1, status `passed`, `embeddedUi: true`, `station_io: false` and
all 35 of 35 checks true. The signed test package additionally demonstrated
Edit Keys from the cold main window, opt-in QRZ Details through its dedicated
renderer, and the read-only Remote VFO window. No physical RF, audio, PTT or
live peer was exercised.

The same source was packaged and installed as `/Applications/OM0RX-xLog.app`.
The replaced 1.2.94 bundle is recoverable at
`/Applications/OM0RX-xLog-1.2.94-pre-1.2.95-25259a3f-20261021.app`.
Deep strict code-signature verification passed. Installed hashes are:

- Production executable: `981f93a638628c88711c7aa78ffd6838f1729183f3da0c414d0874372c57b7ac`
- Production Swift worker: `acd223d1fde1561b2ced94cc1ef1c7864528156bd6516b5d735c1fe518e2d912`
- Production Not1MM manifest: `979b59c267c44f893e4c7a3f833fe800b3beec01634e66223fa3c78010fd04db`
- Contesting Test executable: `72d8a28177c794ebf4b9a6b2f03fca11b9b9d15d9d750085832876d983c93344`
- Contesting Test Swift worker: `5ab2dce9324afdff744b5de09673887db5391967e0718fbe1e95f30dde291867`

The application is still unnotarized and is not a public macOS release.

## Previous installed 1.2.93 baseline

- Installed version/build: `1.2.93`.
- Exact application source: `307fe4a7d663a6c4baee8cbd05292f50c4118ebd`
  on `codex/not1mm-contesting`, pushed to GitHub with a clean working tree.
- The production and isolated Contesting Test bundles both embed that exact
  source commit in their distribution metadata.
- `codesign --verify --deep --strict` accepted both bundles. The production app
  is signed by Developer ID team `4WCMQ4U946`.
- `/Applications/OM0RX-xLog.app` was replaced with the exact production bundle.
  The earlier 1.2.93 candidate from `a8b33760` remains recoverable at
  `/Applications/OM0RX-xLog-1.2.93-a8b33760-pre-307fe4a7-20261021.app`;
  version 1.2.92 remains recoverable at
  `/Applications/OM0RX-xLog-1.2.92-pre-1.2.93-20261021.app`; version 1.2.91 remains recoverable at
  `/Applications/OM0RX-xLog-1.2.91-pre-1.2.92-20261021.app`; version 1.2.90
  remains recoverable at
  `/Applications/OM0RX-xLog-1.2.90-pre-1.2.91-20261021.app`; version 1.2.89
  remains recoverable at
  `/Applications/OM0RX-xLog-1.2.89-pre-1.2.90-20261021.app`; version 1.2.88
  remains recoverable at
  `/Applications/OM0RX-xLog-1.2.88-pre-1.2.89-20261021.app`; version 1.2.87 remains recoverable at
  `/Applications/OM0RX-xLog-1.2.87-pre-1.2.88-20261021.app`; version 1.2.86
  remains recoverable at
  `/Applications/OM0RX-xLog-1.2.86-pre-1.2.87-20261021.app`; the earlier 1.2.81
  bundle also remains recoverable at
  `/Applications/OM0RX-xLog-1.2.81-pre-1.2.86-20261021.app`.
- Application Support, contest databases, normal logs and settings were not
  moved, replaced or deleted during installation.
- Gatekeeper reports `Unnotarized Developer ID`; notarization is therefore still
  required before this candidate can be called a public macOS release.

Acceptance hashes:

- Production executable: `2017127fccb6b6b64b1a5f443a6f1bd406c83fff29632c0ca22d7be8b7e8090a`
- Production Swift worker: `2043aa21672f97333e5258783524dc40a1a4fe3454395b44d25c40eef09c7b8c`
- Production Not1MM source manifest: `985cb6cb49617180a7f658b51c74194e0767a0885f8e1303201adfda351f7958`
- Contesting Test executable: `e7502d9e025751408a9f7da1ae12a7a814e19c1ff543929d39f118f9306d5e45`
- Contesting Test Swift worker: `84c06942213c260620b2ec6d9f828ededd8787d3cb9b599677f1bd14674ae2b4`
- Contesting Test Not1MM source manifest: `985cb6cb49617180a7f658b51c74194e0767a0885f8e1303201adfda351f7958`

## Packaged native acceptance

The actual packaged 1.2.93 Contesting Test executable completed its native
acceptance harness with exit code zero. The fresh report at
`/private/tmp/om0rx-xlog-1.2.93-not1mm-acceptance-307fe4a7-20261021.json` records schema 1,
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

The 1.2.87 packaged-desktop pass found one additional route defect before
installation: Contest Remote VFO still resolved to the ordinary Station Control
singleton. `4c7ebde9` gives it its own `contest--station-control` window and
capability. The rebuilt package then opened the compact xLog-styled Remote VFO at
the contest URL with a live operating context, session and workspace generation.
The Configuration Settings window also displayed Lookup, Sound, CAT, CW, Rotator,
Cluster, Group, N1MM, Bands and Options in one row without a horizontal scrollbar.
Both windows exposed the standard macOS close, minimize and zoom controls.

The 1.2.88 packaged-desktop pass found that the new Operator menu item was
implemented but rejected by the native route validator. `589a9c99` admits the
route. In the rebuilt application, Contest > Operator opened the compact native
Operator window. From the actual Main Logging Callsign field, entering `OPON`
and pressing Space opened that same window and cleared the command without
logging a contact. The window exposed the standard macOS close, minimize and
zoom controls.

The 1.2.92 installed-desktop pass exercised a saved Main Logging window through
the real `Contest Setup > Choose a Contest > OK` path. The first real-app run
found two races and then an exact native schema mismatch that mocks and the
existing harness did not expose: the restored child could read before projection
publication, could miss the publication wake while registering its listener, and
the native validator rejected Not1MM's bounded `operator.autoCQ` member. The
current implementation waits for menu publications, rereads after listener
registration, and validates bounded Auto CQ state. The preserved CQ WPX CW
window then opened ready at 14.348 MHz with OM0RX, reports, serials, Run/S&P,
F1–F12, heading and score visible. Standard macOS close, minimize and zoom
controls were present. Focused validation passed 21 native tests and 207 frontend
tests; the real installed application, not those supporting checks, established
the final operator-visible result.

The 1.2.93 pass restored that same active backend session directly at startup;
Main Logging reopened as a separate CQ WPX CW window at 14.348 MHz with the
preserved `VK8R` draft, reports, serials and S&P state. The packaged-app check
then exposed a frontend menu whitelist which had not been extended when Group
Chat and QRZ Details were added. `307fe4a7` admits both retained native routes.
From the real installed Contest menu, Group Chat opened as a separate 620×420
native window with standard close, minimize and zoom controls and correctly
reported that group networking was disabled. QRZ Details reached its intended
Configuration → Lookup preference guard rather than being rejected as an
unknown route.

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
- Contest context resets now queue the saved-window refresh only after the reset
  completes, preventing a refresh from being discarded by the reset itself.
- The full executable Python suite passed 185 tests. After the comment-mode
  changes, the selected xCluster parser/session/integration set passed 51 tests,
  including the exact 7P8GE FT-8 regression and stale-projection refresh cases.
- A clean full frontend rerun passed 3,739 tests across 270 files plus both Node
  acceptance tests. The full Rust suite exited zero. After the installed-app
  Group Chat failure exposed the menu whitelist omission, 73 focused navigation
  and contest-workspace tests passed with the repair.

## Cluster mode intelligence

Fresh spot ingestion now gives bounded explicit digital comment evidence priority
over frequency-only inference. `FT8`/`FT-8`, `FT4`/`FT-4`, FT2, RTTY/JTTY, PSK
variants, JT65/JT9, OLIVIA, HELL, MFSK, SSTV and DIGI/DIGITAL are recognized.
The weak standalone `DATA` marker is deliberately not sufficient. The reported
7P8GE spot at 28.088 MHz with comment `FT-8 TNX 73s`
therefore classifies as data/FT8 rather than CW. Frequency inference remains in
use when no explicit comment marker exists. The shared live snapshot also
reclassifies a retained stale derived mode from its preserved explicit comment,
so normal xLog and Contest Cluster cannot keep displaying an old `CW` projection
for that FT8 spot. Dependent score, status and palette values are refreshed.
Previously persisted historical observations are intentionally not rewritten.

The installed production app also demonstrated that the logic remains bounded:
a current 7P8GE spot at 24.902 MHz with comment `up.4 gl still` remained CW.

## Original plugin catalog growth

The current installed milestone executes 46 of the 94 byte-pinned original
Not1MM plugins through the accepted Python/SQLite host. Since the 36-plugin
1.2.93 baseline, the catalog added EUHFC, IARU HF, ARRL 10m, ARRL 160m, King of
Spain CW/SSB, French REF CW/SSB, RSGB 80m CC and RSGB Commonwealth BERU. Source
provenance and hashes use the existing relocation checks; no contest rules were
translated into Swift or JSON. The full Python host suite passes 207 tests and
the pinned corpus verifies all 94 source modules at upstream revision
`7c8b499225a73f7f8f792246881bd7aefc05452f`.

## Installed-app preservation smoke

The installed 1.2.95 production app opened the existing workspace successfully:

- 68,406 normal-log contacts were visible; the installation did not replace the
  normal log, settings or contest databases.
- The requested C5R contact was present at 09:41 UTC on 20 October 2026, 12 m SSB,
  24.950 MHz. A later C5R contact at 09:55 UTC on 15 m was also present.
- Existing station identity `OM0RX / JN88TQ`, the connected rotor projection,
  cluster connection and saved Traditional layout were retained.
- The native Contest menu exposed Contest Setup, Operator, Station Settings,
  Configuration Settings, Digital Logging Setup, Edit Macros, Edit Keys, Rover,
  Call History, QRZ Details, Group Chat, Main Logging, Stats,
  Logbook, Band Map, Cluster, Check Partial, Rates, DXCC, Zone, Rotator and
  Remote VFO, plus About Not1MM.
- Remote VFO opened as its own contest window, rather than activating ordinary
  Station Control, and Configuration Settings showed all ten tabs in one row.
- Rover and About Not1MM opened as separate xLog-styled native windows. Main
  Logging recovered automatically from the backend's active session and its
  saved native-window state, instead of requiring the operator to select the
  preserved contest or remaining on `Panel unavailable`.
- Group Chat opened separately from the installed Contest menu. With Group
  disabled in the saved setup it bound no socket, disabled Message/Send and
  displayed the truthful disabled status. No second live multicast peer was
  used in this pass.
- The QRZ-details tickbox guard was exercised in the signed test package: with
  the preference off, Contest Setup displayed the exact action needed; after
  enabling it under Configuration → Lookup, QRZ Details opened separately.

This smoke establishes local retention and display. It does not by itself prove a
remote Wavelog upload receipt for C5R.

## Exact remaining limitations

- Notarization is incomplete.
- No physical RF, voice playback, PTT, amplifier, tuner or rotor action was
  exercised in this acceptance. The Contesting Test profile intentionally blocks
  those paths.
- Production SSB voice-keyer output has no accepted native audio/PTT authority;
  the demonstrated phone path is a nontransmitting simulation.
- Original RTTY plugins now have a bounded nontransmitting sink, but no live
  modem, audio, PTT or digital-station path has end-to-end acceptance.
- Auto CQ now has a bounded runtime consumer with Stop, focus and replay
  protections. Group Chat has a bounded multicast owner and separate saved
  window, but no second live peer was available for end-to-end packet exchange;
  broader N1MM packet/RTC and multi-operator workflows remain incomplete.
- Digital Logging Setup now accepts bounded receive-only WSJT-X/JTDX Logged ADIF
  UDP input, but no external WSJT-X/JTDX instance, fldigi modem, digital audio,
  PTT or RF path was exercised.
- The reported 7P8GE 28.088 MHz `FT-8 TNX 73s` row had aged out before this
  installed-app pass. Its exact parser/session behavior and stale-row refresh are
  regression-tested, but that exact live cluster observation was not repeated.
- The installed 1.2.95 milestone contains 46 pinned original plugins out of 94;
  48 original plugins still need to be brought through this same Python host.
- BERU's original ESM auto-logs numeric exchanges only. Valid `SERIAL HQ`
  contacts work through direct commit, scoring, correction and export, but still
  require manual commit rather than Enter-driven ESM.
- The installed 1.2.95 application remains unnotarized.
- Normal-log transfer/finalization remains incomplete. Saved-window refresh,
  child reconnection and automatic active-contest restoration are fixed.
- Some original configuration windows and workflows remain to be reproduced.
- Setup still exposes broader VHF/UHF choices than the current HF contest host,
  and Cabrillo export remains limited to the connected contest exporters.
- Physical real-station and Wavelog receipt checks remain separate acceptance
  boundaries. Available software work continues without treating them as a stop.
