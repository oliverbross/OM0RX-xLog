# Not1MM operator acceptance — updated 23 October 2026

This checkpoint records demonstrated desktop behavior for the original executable
Not1MM Python/SQLite host inside xLog. It is not a claim that the complete Not1MM
port or a public macOS release is finished.

> **Status chronology:** the newest milestone is always documented first. Every
> later section in this file is retained as historical evidence for its named
> candidate only. In particular, earlier 46/94, 64/94 and HF-only limitations
> do not describe the current source or the installed 1.3.0 milestone.

## CQ-WW-SSB-2026-10-23-f9e1c46f — installed macOS candidate

**Verdict: READY WITH LIMITATIONS.** This verdict is intentionally limited to
the local Apple Silicon/macOS operating candidate. Windows and Linux packaging
and installed behavior are deferred and are not claimed by this checkpoint.

### Candidate and release gates

- Version/build `1.3.0` is installed at `/Applications/OM0RX-xLog.app` from
  clean canonical `main` source
  `f9e1c46f7350509b5e792c1f4204cbde2b33fbeb`. The embedded Not1MM runtime
  receipt records the same `sourceCommit` and an empty `sourceChanges` array.
  The CQ WW window/scoring implementation is commit `870fdc4d`; `f9e1c46f`
  contains only the final deterministic release-gate corrections.
- The installed main executable SHA-256 is
  `a5bc90510d2d2e135adcbe278b59bc2d80abdaeac712fa9d05d781f21b14b601`;
  the installed worker SHA-256 is
  `ac2e48d515a4921c46e6c5da364da48973f53077b95c9c9903b9eb0e98978fe0`.
  Deep/strict Developer ID verification passes for the installed application.
  Gatekeeper identifies it as an **unnotarized Developer ID** build, so this is
  a local operating candidate rather than a notarized public release.
- Exact-source GitHub CI run `39870640928` passed. Exact-source Contest
  portability run `39870640828` also passed; only its macOS results are in this
  acceptance scope. Cross-platform prototype run `39870640826` was still in
  progress at the freeze point and is neither counted as passed nor treated as
  a macOS blocker because the installed package below was independently built,
  signed, installed and exercised from the same clean source.
- The complete local frontend gate passed 276 files and 4,038 tests, TypeScript
  compilation, the production Vite build and the bundle-budget check. The final
  archive is `dist/OM0RX-xLog-1.3.0-f9e1c46f-macOS-arm64.zip`, SHA-256
  `a0765ac87d350f1378ccea7ffcb82b3617a67fd6e25fddf02e7019c897b264fd`;
  `unzip -t` passes.

### Installed acceptance

- **PASS — installed application identity and isolation.** The installed binary,
  not a development server, produced a 35/35 passing native acceptance report
  with `station_io: false`. Evidence is
  `/Users/oliver/.codex/acceptance/cqww-f9e1c46f/installed-ui.json`, SHA-256
  `ed3bc9a1f565dcd902b707b3b1055f8d61a62bf489c60ec818c24e1e518ef352`.
- **PASS — CQ WW SSB entry surface.** Main Logging restored with CQ WW SSB,
  operator OM0RX, the six HF bands, sent/received `59`, editable received CQ
  zone, Run/S&P state and F1-F12 controls. The earlier unresolved-action,
  unconfirmed-edit and Entry-controls banners were absent. Enter/focus/correction
  behavior remains covered by the installed native acceptance and focused
  contest tests; no production contact was logged to demonstrate it.
- **PASS — contest windows.** Main Logging, Log Display, Stats, Check Partial,
  Cluster, Band Map and Rates loaded without `Panel unavailable`. Log Display
  showed contest-specific `YYYY-MM-DD HH:MM:SS, Call, Freq, Snt, Rcv, M1, ZN,
  M2, PFX, PTS` columns with fitted-row bottom paging. Stats showed `BAND, QSO,
  PTS, ZN, CTY` plus total/claimed score. Check Partial showed the four
  Log/Master/Telnet/Call History panes and active MASTER.SCP suggestions. Cluster
  showed full calls, contest points, an operable Marked-only toggle and bottom
  paging without a row scrollbar. Band Map showed full calls, contest-point and
  needed-multiplier coloring, with worked/gray spots hidden by default.
- **PASS — window lifecycle.** The Window menu exposes the contest auxiliary
  routes and `Open xLog Main Window`. The normal main window opened on request;
  closing it left the contest Main Logging window running and frontmost.
- **PASS — UTC clock behavior.** The installed main app showed the correct UTC
  date/time and seconds advanced during observation. Date/time are no longer a
  stale launch snapshot.
- **PASS — score/export regression, automated simulation.** The exact-source CQ
  WW tests cover RS plus zone entry, same-band dupes, different-band validity,
  country/zone-by-band multipliers, immediate multiplier flags, correction,
  deletion promotion, restart and export. The earlier unchanged six-contact
  rehearsal result of 14 points, 12 multipliers and score 168 remains regression
  evidence for those same fixture inputs; it is not represented as a new
  production or exact-installed QSO run.
- **NOT TESTED — live radio readback.** The app reported the radio offline during
  this installed pass. Consequently live frequency/band/mode readback and spot
  tuning of the intended 40 m SSB radio were not re-proved. No radio setting,
  frequency or mode was changed. Rotor operation is outside this contest plan.

### SSB voice results

1. **Macro substitution: PASS (automated).** The bounded, typed Not1MM phone
   macro substitutions and unavailable-output suppression are tested.
2. **Recordings/profile: NOT READY/NOT CONFIGURED.** The installed Main Logging
   window correctly reported recorded phone unavailable because no Voice WAV
   profile folder was saved; no valid operator recording was claimed.
3. **Output routing: NOT TESTED.** The output-device/profile controls exist, but
   no audio was played into the Flex/DAX path.
4. **PTT ownership/interlocks: NOT TESTED on hardware.** No PTT was requested.
5. **Transmitter audio/RF: NOT TESTED.** No microphone permission, transmitter
   audio or RF transmission was used.

Manual-microphone SSB logging is the workable accepted configuration. Recorded
F-key voice operation is a separately named limitation, not a hidden prerequisite
for saving a QSO.

### Data, remaining action and rollback

- The installed acceptance used its isolated namespace and did not create,
  edit, delete or transfer a production QSO. The protected normal database
  passes `PRAGMA quick_check` with 68,518 active rows and one existing
  soft-deleted row. The current real contest database passes `quick_check` and
  contains zero contacts.
- Before operating, the only required supervised check is to connect the
  intended Flex/radio and confirm the displayed frequency, 40 m band and SSB
  mode. If recorded voice is desired, save the WAV profile, record/preview each
  intended macro on the selected nontransmitting output, then separately test
  PTT/audio/RF under operator control. None of those actions is needed merely to
  log a manual-microphone QSO.
- Rollback is the verified, deep/strict-signed
  `/Applications/OM0RX-xLog-previous-20261022T210247Z-20230.app`. The existing
  pre-install database backup remains at
  `/Users/oliver/Library/Application Support/OM0RX-xLog Release Backups/1.3.0-pre-870fdc4d-20261023T0815Z/`.
  Superseded application bundles and old distribution archives were permanently
  removed after verification; the installed candidate, this rollback, the final
  archive and acceptance evidence were retained.

## 1.3.0 CQ WW SSB readiness candidate — exact installed source

- The installed application is version/build `1.3.0` from clean canonical
  `main` source `bdea06f1621e55a4185d6801be91f1d2c8978575`; the embedded
  Python-runtime receipt records that exact commit and an empty
  `sourceChanges` array. The built and installed main executable hashes match
  at `84fefb6a9bc2459ed016a2ff6b9ad64f85c3ee0da3fd83ac2248f4a2a34935d9`;
  worker hashes match at
  `5d721cd77a0490219c273c69ced6195c9f20e56d452e1b40ec9623d45f877d80`.
  Developer ID deep/strict verification passes. This local acceptance candidate
  is not notarized; Gatekeeper correctly identifies it as an unnotarized
  Developer ID build, so it is not yet a public release artifact.
- The CQ WW SSB entry contract is RS plus CQ zone: the installed Main Logging
  window shows SSB, sent `59`, received `59`, and the editable received CQ Zone
  field while OM0RX's station CQ zone `15` remains the sent exchange. Its
  six-band ladder is 160/80/40/20/15/10. Run/S&P controls and F1-F12 phone
  macros remain permanently visible. Ordinary Escape handling is now scoped to
  stopping contest keyer/Auto-CQ output and no longer depends on rotor
  availability; a true process restart showed no stale rotor/action banner.
- The exact-source isolated family rehearsal passed with 24 synthetic contacts
  across CQ WW CW/SSB and CQ WPX CW/SSB. CQ WW SSB logged six contacts on 20 m
  and 40 m with 14 points, 12 country/zone-by-band multipliers and claimed score
  168; CQ WW CW also scored 168, and both WPX cases scored 63. The run performed
  16 Cabrillo/ADIF export assertions, 104 nontransmitting simulated output
  intents, 484 framed host requests, a valid seven-call SCP import, host restart,
  bounded response/shutdown probes and protected-database metadata comparison.
  The protected database metadata was unchanged. Evidence is
  `/tmp/xlog-cqww-bdea06f1-final4/evidence/outer-runner.json` (SHA-256
  `83c1b6198355938f6e4b30cf14f4d489049f198b974e360c357503368b2de327`)
  and `acceptance.json` (SHA-256
  `815c23c4224d173a5f1a5ad19ee471bf5b97d6dd58dbf45ab46b2ef5311a8d6b`).
- Through the exact installed bundle, the saved CQ WW SSB session restored the
  separate Main Logging, Band Map, Stats, Log Display, Check Partial, Rates and
  Cluster desk, plus the menu-opened original auxiliary windows. Check Partial
  reported active `MASTER.SCP` and returned OM0AAO-family matches. Cluster was
  connected, filled its window without a row scrollbar, exposed bottom paging,
  showed full calls and numeric contest points, and its Marked-only checkbox was
  verified checked and then unchecked. Band Map showed full calls, red
  three-point needed spots and Show worked off by default. Log Display, Stats,
  Rates and Score Reporting all loaded from the same zero-contact real session;
  the synthetic run above, not production data, exercised populated logbook and
  scoring behavior. Callsign Details resolved the saved QRZ-backed OM0AAO
  details. No real QSO was created, edited or deleted.
- Configuration Settings now exposes the installed voice workflow: explicit
  sound output and microphone selection, managed profile folder, and bounded
  F1-F12 Record/Preview/Run/S&P mappings. Source validation covers mono PCM WAV
  size, RIFF/chunk/frame integrity and replacement confirmation. This installed
  pass inspected the controls only; it did not grant microphone permission,
  play audio, claim PTT, key the Flex radio, move the rotor or transmit RF.
- Exact-source GitHub CI run `39838421283` passed. The Mac-first prototype and
  package workflow `39838421102` also completed successfully, but its Linux and
  Windows runtime jobs were skipped and are not counted as portability proof.
  Dedicated Contest portability workflow `39842754627` then passed all seven
  jobs at exact source `bdea06f1621e55a4185d6801be91f1d2c8978575`, including
  contest definition generation plus native and broad contest tests on macOS,
  Ubuntu and Windows.

Remaining external acceptance is deliberately short: record and preview the
operator's actual voice macros through the intended Flex/DAX audio path, then
verify PTT/RF only under the existing station authorization; exercise
simultaneous two-Mac multi-operator logging/serial/chat behavior; and make one
credentialed RTC scoreboard post. Those external steps are not implied by the
94-plugin registry or by this nontransmitting rehearsal.

## 1.3.0 finishing candidate — transfer semantics, staged replicas and RTC submission

- The installed executable candidate is version/build `1.3.0` from exact source
  `cfd93d7ce38ee5e5df861ea701a704f277fd8fb9` on canonical `main`; all four
  implementation commits in this batch are pushed. The embedded Python-runtime
  receipt records the same source, no source changes, successful relocation and
  no external libraries loaded. The pinned Not1MM source manifest remains at
  revision `7c8b499225a73f7f8f792246881bd7aefc05452f` with all 94 original
  executable plugins registered.
- Contest-to-normal-log transfer now follows persisted plugin field meanings:
  CQ WW zone data maps to CQ zone, IARU HF numeric ITU exchanges map to ITU zone
  while HQ text remains exchange data, and CWT's received operator name remains
  the received exchange rather than being substituted for the sent exchange.
  Receipt replay remains non-overwriting; existing transferred user contacts are
  not silently rewritten.
- Trusted-LAN replica recovery now stages bounded 25-change audit pages for a
  matching non-empty client. Durable stage identities survive interruption and
  retry; the client binds and installs audit/serial authority only after the
  final validated page. No unlimited response or weakened first-page validation
  was introduced.
- Score Reporting now builds the original plugin's `online_score_xml` through
  the Python host and performs bounded HTTPS RTC posts to the selected pinned
  service through xLog's existing native networking owner. Passwords are held
  in Keychain, native receipts retain only a SHA-256 payload digest and redacted
  envelope, redirects/cookies/cache are disabled, and the legacy HTTP service
  remains visibly ineligible for credentials. Manual and two-minute periodic
  routes share the same owner.

The complete milestone checks passed all 304 Python tests, all 3,875 frontend
tests across 273 files, all 778 Rust tests, the complete Swift package suite
(including the 484-test/67-suite Swift Testing bundle and its XCTest bundles),
TypeScript compilation, the production frontend build and all five macOS staging
checks. Focused transfer, staged-replica, RTC-networking and native action-receipt
regressions also passed. External RTC transport was intercepted in tests; no
score was published to a live account.

The exact source was packaged once from the canonical checkout. Developer ID
deep/strict verification passes for team `4WCMQ4U946`; Apple notarization
submission `a4a25fe7-e5ef-4ca1-b909-864c6ceef915` was accepted, stapler
validation passes and Gatekeeper reports `Notarized Developer ID`. Candidate and
installed executable hashes match:

- Main executable: `ed691a35785cb49efd783e38790aa942ae3b24b95fe03f3501ade83041635a69`
- Swift worker: `16b67a3cb783ed1c2cc6f327b8964060da21cac8310ed7e29566e3e10eabad03`
- Final archive: `dist/OM0RX-xLog-1.3.0-macOS-arm64.zip`, SHA-256
  `8c25603821edae8b49871a0c89ca6e3776d5604e4cd4ba9bf54275ad9c0a89ad`

Through the installed notarized application, the first cold launch again showed
the recoverable **logbook service did not finish loading** state; **Retry
connection** loaded the preserved normal workspace. Opening Contest Setup then
restored the saved CQ WW RTTY desk as separate Band Map, Check Partial, Cluster,
Log Display, Main Logging, Rates, Score Reporting and Stats windows. The normal
workspace was absent from the Window menu, Main Logging owned callsign focus,
and its saved S&P state, two credited QSOs and score 12 were visible. Score
Reporting displayed the same Python-owned score plus secure credential,
periodic-send and manual-send controls; with no credentials configured, Save and
Send remained disabled and no external submission occurred. No contact, radio,
audio, PTT or transmit action was used. The preserved normal database contained
68,455 QSOs and both it and the active contest database passed SQLite
`quick_check`.

Remaining external acceptance is deliberately short:

1. Exercise staged multi-op reconciliation, simultaneous serial/log sharing and
   interruption/retry on a second installed Mac over the trusted station LAN.
2. Post to an RTC scoreboard with the operator's real account and confirm its
   server-visible update; the implementation and intercepted HTTPS route are
   complete, but no account submission was made in this pass.
3. Exercise production voice/audio/PTT and external WSJT-X/JTDX/fldigi behavior
   with the authorized station hardware/apps. Existing transmit authorization
   and nontransmitting test boundaries remain unchanged.

## Post-1.3.0 source milestone — contest desktop, retained services and bounded recovery

- Exact implementation source is `0679096db08992a79c2853ffa7110e3d1449aa29`
  on canonical `main`; every implementation commit through this point is pushed.
  The installed 1.3.0 application still predates this batch, so the behavior in
  this section is source and automated evidence until a new exact-source
  candidate is packaged and exercised.
- New/Open Contest now restores the seven standard separate windows even if a
  previous session remembered Main Logging closed. Existing detached-window
  geometry remains authoritative, Main Logging is shown and focused, normal
  xLog windows are hidden, and closing the normal main window while a usable
  contest child exists no longer terminates the application.
- The contest Rotator window now resolves the active QSO short/long-path target
  through the retained contest projection and delegates movement to xLog's
  existing manual rotor owner. Contest Band Map displays a fresh direct-TCI
  receive-filter width without gaining radio control.
- The original S&P clear-on-VFO preference is available and defaults off. It
  clears only the callsign and received plugin inputs after a fresh observed VFO
  change, retaining reports, sent exchange and reserved serial. Startup retries
  are bounded to the exact transient workspace/service-contention failures.
- Contest > Score Reporting opens a separate xLog-styled RTC compatibility
  window with the live Python-authoritative score, the three pinned Not1MM
  services and the original two-minute interval. Credential persistence and
  network submission remain deliberately disabled until a secure credential
  store and bounded retry-safe reporter exist; the legacy HTTP service is
  explicitly identified.
- Trusted-LAN clients can adopt a strictly newer lease from the same master
  station after a process restart and retry exact request identities through
  persisted Python receipts. A non-empty client can bind only when a complete
  first authority page exactly matches its durable QSO rows and identities.
  The current native page bound is 25 audit changes; larger histories still
  require staged multi-page reconciliation. Simultaneous second-Mac installed
  acceptance and cryptographic peer identity remain outstanding.

Milestone checks passed 3,875 frontend tests across 273 files, all 303 Python
tests, all 776 native Rust tests, TypeScript compilation and the production
frontend build. Focused lifecycle, rotor, filter, score-reporting and replica
checks also passed. These checks do not establish installed-app window behavior,
physical rotor/RF/PTT operation, external digital application behavior or live
scoreboard publication.

## 1.3.0 trusted-LAN replica candidate — exact-source installed acceptance

- The installed candidate is version `1.3.0` from packaged source
  `a969c4402fefb0378d4693d7692f219755265db7` on canonical `main`; executable
  implementation is `fe03f4f1798d3d7aaffbe847495571e63e7a8962`. The embedded
  Python receipt records the packaged source, an empty `sourceChanges` array,
  successful relocation and no external libraries loaded.
- The built and installed main executable hashes match at
  `5a1641a5054fe58c127f26a2f84e0e4f872541b3352a0e9d063d20f9d6e4b900`;
  worker hashes match at
  `e2172bbe3b2db1579540b3c1fc9cc23a6cea9430f93181ff15e5f5749f852f9c`.
- The preserved normal database contains **68,441 QSOs** and passes SQLite
  `quick_check`; the saved CQ WW RTTY contest database also passes
  `quick_check`.
- Through the installed Tauri application, Contest Setup restored the saved
  CQ WW RTTY session and opened the separate Band Map, Check Partial, Cluster,
  Log Display, Main Logging, Rates, Setup and Stats windows. The native Window
  menu listed that contest desk without the normal main window. Main Logging
  showed the saved two-QSO session, owned callsign focus, and accepted Run/S&P
  switching. A disposable callsign draft was cleared; no QSO was logged and no
  transmit action was used.
- On one cold restart the normal workspace first showed the existing recoverable
  **logbook service did not finish loading** screen. **Retry connection** loaded
  the preserved workspace, and reopening Contest Setup restored the saved
  contest desk with a fresh operating context. This observation is recorded as
  a remaining startup-reliability limitation, not hidden as a clean first-pass
  restart.
- Developer ID signing, Apple notarization submission
  `a0a87739-5be3-42ab-ae20-6d5ac3988afe`, stapler validation and Gatekeeper
  assessment pass. The final ZIP is
  `dist/OM0RX-xLog-1.3.0-macOS-arm64.zip`, SHA-256
  `11cc0c11e3683594afc2c81fb4e6d25f564123abd35e6dfb74baa2fe6a8aa361`.

The completed master/client routes and replica behavior remain automated source
evidence: a second installed Mac did not exercise simultaneous logging,
multicast loss/reconnect or lease transfer. Master failover/rebind is not
implemented, and the trusted-LAN protocol does not provide cryptographic peer
identity. Physical RF, production voice/PTT and external digital applications
were not operated during this candidate pass.

## 1.3.0 notarized macOS candidate — exact-source installed acceptance

- The executable candidate is version `1.3.0` from exact source
  `d2ddd3011dcd2db80a4c154978458ed2e93a9fd2` on canonical `main`. All
  implementation commits are pushed. The packaged distribution metadata and
  embedded Python-runtime receipt both record that source with no source changes.
- All 94 byte-pinned original Not1MM plugins remain registered and executable
  through the Python/SQLite host. Registry completeness is not represented as
  complete operator-workflow parity.
- Contest Setup now waits for the host catalog before enabling New Contest. A
  cold launch showed `Loading contest types…` rather than the internal invalid
  reply/projection diagnostic. Opening the saved contest restored separate Band
  Map, Check Partial, Cluster, Log Display, Main Logging, Rates, Setup and Stats
  windows through the existing native geometry owner.
- The installed receive-only WSJT-X/JTDX route retained **Active contest** across
  restart without silently reopening its UDP listener. Two identical type-12
  packets for `VK8ZX` produced one CQ WW RTTY row with authoritative contest
  identity, OM0RX station prefix and CQ zone 29. Stats advanced from 1 to 2 and
  the already-open Log Display showed the contact without close/reopen. After an
  application restart the saved contest reopened with the same score/log state,
  while UDP port 42424 remained closed until the operator selected Save and
  listen again. This proves logged-QSO receive behavior, not modem, audio, CAT,
  PTT or keying.
- DARC VHF EDI export completed through the installed application's native Save
  panel. The 602-byte one-QSO file records `TDate=20261021;20261021`, 144 MHz,
  one QSO and claimed score 431; SHA-256 is
  `2ebc4b09cdd457cb735da15687bc11013d450cb67048f66999544ff213a5e0ce`.
- Contest-to-normal-log transfer uses the existing BandPlan/destination owner
  and has focused 1296 MHz (23 cm) and 2300 MHz (13 cm) coverage. The installed
  normal workspace passed SQLite `quick_check` and retained 68,441 contacts.
- Packaged and installed native acceptance reports completed with no failed
  checks. Exact-source CI run `39627525815` succeeded. The macOS artifact is
  Developer ID signed and Apple notarization submission
  `1c5f5c84-2ede-4250-95fa-603984389f89` was accepted; stapler validation and
  Gatekeeper assessment both pass. The notarized ZIP SHA-256 is
  `650345f3b77765d40c8be6730faaeb9f38f7a8bc962c8d98b75aae22c5a0014f`.
- Production phone macros use the existing xLog audio-output and PTT owners with
  verified file manifests, fresh-TX gating, serialized release/shutdown and
  replay protection. Contesting Test remains nontransmitting. Group Chat and
  retryable Renfield publication retain their bounded, honest capability labels.

The broader automated milestone still includes 284 Python tests, the portable
Swift suite, 783 Rust tests, 3,843 frontend tests, TypeScript compilation and the
production frontend build. Exact-source CI repackaged the application
successfully; portability run `39627586264` also passed its macOS, Linux and
Windows source-level jobs independently from Mac-first installed acceptance.

## Source milestone after installed 1.2.101 — digital contest routing and honest networking

- Exact source through this recorded batch: `9c48f6a33f681a783ec657378c095b030602effd`
  on `codex/not1mm-contesting`. Commit `6607525d` implements WSJT-X contest
  routing; `3dccce22` and `82ac0a8b` restore portable imports; `202376c9`
  corrects the Renfield default and capability presentation; and `9c48f6a3`
  implements the fldigi workflow. All commits are pushed to GitHub.
- Digital Logging Setup now keeps **Ordinary log** as its default and offers an
  explicit **Active contest** destination only when the selected original
  Not1MM plugin provides its executable `ft8_handler`.
- An Active-contest lease freezes the session, plugin, workspace generation and
  source revision. Contest switches, workspace transitions and shutdown retire
  the lease; late datagrams cannot fall through into the normal log. Restart
  does not silently reactivate contest routing.
- WSJT-X ADIF input is bounded, passed through the original plugin handler and
  committed through the existing Python/SQLite contest owner. Durable semantic
  receipts make repeated datagrams duplicate-safe. The ordinary-log importer is
  unchanged.
- fldigi logged-QSO receive is separate from transmit capability. Its loopback
  UDP ADIF path uses the same frozen contest destination and original plugin
  handler as WSJT-X. RTTY plugins expose their original F-key text through a
  bounded loopback XML-RPC path (`main.tx`, then `text.add_tx`); the existing
  native output reservation serializes it against CW/carrier output. Stop,
  disable, failure and stale-contest paths suppress the payload and make a
  bounded best-effort return to RX. Contesting Test neither binds nor sends.
- Contest Setup now exposes only the currently implemented Group Chat network
  capability, using Renfield's pinned `239.1.1.1:2239` default. Shared serial,
  dupe, log synchronization and master/client authority remain visibly
  unavailable, and legacy hidden values are preserved rather than discarded.

The combined boundary passed 282 Python tests, 311 Swift tests, 764 Rust tests,
TypeScript compilation and the production frontend build. The affected digital
UI files passed 103/103. Five load-timing cases that timed out only during the
fully parallel frontend run passed 3/3 and 2/2 when rerun serially. The native
fldigi output-owner and Contest Setup admission tests passed, as did the portable
worker regression. These are source and automated checks, not installed-
application, external-WSJT-X/JTDX or external-fldigi acceptance. No new
application was packaged, signed or installed for this source milestone.

## Installed 1.2.101 migration and normal-log milestone — 21 October

- Exact executable source: `cba6e3c7cae2c3dfa48d3410998821dc5d3312fb`
  on `codex/not1mm-contesting`. The logical batch is `e2a801fa` (lossless
  legacy import), `a1e6ebd6` (receipt-backed normal-log transfer), `9d53899d`
  (native separate-window workflow), `9009608f` (candidate identity),
  `6ae224fd` (portable decoding), `0e83f3d6` (post-import context refresh) and
  `cba6e3c7` (restart/session-restore refresh). All are pushed to GitHub.
- All 94 byte-pinned original Not1MM Python plugins remain registered and
  executable through the Python/SQLite host. The original plugins remain the
  contest authority; no Swift rule translation, JSON rule language or parallel
  contest service was introduced.
- Legacy Not1MM SQLite databases can now be previewed and imported into a new
  xLog-owned contest session through the native file owner. The import preserves
  raw plugin fields, contest metadata, source/QSO digests and provenance rather
  than reconstructing exchanges through generic columns.
- An active contest can be copied into the normal xLog logbook through the
  existing logbook owner. Durable per-session/QSO receipts make retries and
  restarts duplicate-safe, and conflicts remain non-overwriting and visible for
  review. Import activation now refreshes the same transfer window, and selecting
  the Active contest tab refreshes restored native context after application
  restart.
- The Contest menu exposes this work in the separate xLog-styled **Import or
  Transfer Log** window. The normal logbook and contest database remain separate;
  the transfer is an explicit copy with retained source identity, not a lossy ADIF
  merge.

The coherent milestone checks passed 280 Python tests, 3,826 frontend tests across
272 files, 737 Rust unit tests plus 26 Rust integration tests, the complete Swift
package suite, TypeScript compilation and the production frontend build. The
focused final transfer-window regression passed 6/6. CI run `39581002087` passed
for exact executable source `cba6e3c7`. These are supporting checks, not packaged
desktop proof.

The packaged application's native acceptance report is
`/private/tmp/xlog-1.2.101-cba6e3c7-native-acceptance.json`; SHA-256 is
`2a960a339784b1e0809f65750543ffdc8a12710935b23fadbcd45f435cb6475b`.
It records status `passed`, embedded UI and worker present, station I/O disabled,
and all 35 of 35 checks true.

The exact-source candidate was incrementally packaged from the canonical checkout,
signed and installed at `/Applications/OM0RX-xLog.app`. The previous application
is retained recoverably at
`/Applications/OM0RX-xLog-1.2.101-pre-transfer-context-fix-2026-10-21.app`, and the
older 1.2.100 backup remains at
`/Applications/OM0RX-xLog-1.2.100-backup-2026-10-21.app`. Deep strict signature
verification passed for Developer ID team `4WCMQ4U946`; Gatekeeper reports
`Unnotarized Developer ID`, so this is not notarized public-release acceptance.
Candidate and installed hashes match:

- Production executable: `cdf6333ac686f8b607349234e92315916bdf41af2d7d747e2e00b2d985819279`
- Swift worker: `dbb55deeedc1b339efb36b63e5dfd348b0a78b59a134103908259502c17aff0f`
- Not1MM runtime provenance: `97b57f266edc19693d40f26c762aec3cfe11fa5343382b05d7f57a53e955fb45`
- Not1MM source manifest: `b7303ee4ea62f4e8e296ab6dea38ccf6086d0d84756874e0319b0638fd9f9aeb`

Runtime provenance records Python 3.12.4, exact source `cba6e3c7` and no source
changes. The acceptance-ledger commit containing this section follows that source
as documentation only and is not represented as part of the executable.

Actual production-bundle QA opened the installed 1.2.101 application and verified
the Contest menu and the separate Import or Transfer Log window with standard
macOS close, minimize and zoom controls. No production contest or normal-log data
was changed during that inspection.

The exact `cba6e3c7` nontransmitting packaged test application then exercised a
fresh legacy CQ WW CW database with two contacts. Its preview showed the original
contest, `cq_ww_cw` plugin, UTC range and received exchanges `04` and `25`; import
created a two-contact active session. Transfer preview reported 2 new / 0 already
transferred, commit added both contacts, and a second preview reported 0 new / 2
already transferred with the commit control disabled. The detached normal Logbook
showed `VE3XYZ` on 20 m at 14.026 MHz and `JA1XYZ` on 40 m at 7.026 MHz. After
quitting and relaunching the same packaged application, selecting the Active
contest tab restored the two-contact CQ WW CW session, and preview still reported
0 new / 2 already transferred. This demonstrates installed-window import,
transfer, duplicate prevention, normal-log readback and restart persistence while
external services and station I/O were disabled.

This remains a milestone, not completion of the full Not1MM port. Required EDI
writers and native routing are implemented, but a successful installed Save-panel
EDI export remains unaccepted. Production phone/audio/PTT operation, installed
external WSJT-X/JTDX and fldigi integration, multi-operator shared serial/log
authority, physical RF/station behavior, sponsor-rule certification,
notarization and public-release acceptance remain incomplete or unaccepted. All
94 plugins in the executable registry do not by themselves establish every
contest-specific operator workflow.

## Installed 1.2.100 reviewed-workflow milestone — 21 October

- Exact executable source: `8435509ab4cd2af304b21a052e9f361bcf41ed3f`
  on `codex/not1mm-contesting`, comprising logical implementation commit
  `f017b49e` and version/provenance commit `8435509a`; both are pushed to GitHub.
- All 94 byte-pinned original Not1MM Python plugins remain registered through the
  Python/SQLite host. The original plugins remain the contest authority; this
  milestone adds no Swift rule translation, JSON rule language or parallel contest
  service.
- Editable partial-match rows now include the authoritative decoded `raw_fields`,
  so an older General Logging contact outside the main log page preserves values
  such as `Name=Alice` and `Comment=portable` on unchanged or callsign-only saves.
- The host's actual field identity, visibility, enabled state and read-only flags
  now drive entry and edit projections. `qso_party_sn`, `ca_qso_party` and `raem`
  keep their allocated sent serial in `sent` while required received fields remain
  editable; contests whose original plugin owns the serial in `other_1` keep that
  different role.
- New Contest frequency availability follows the newly selected plugin. Changing
  from a valid observed HF frequency to CQ WW VHF exposes manual frequency entry
  instead of retaining the active HF contest's visibility decision.
- Required REG1TEST EDI output is connected to the original DARC VHF, NAC VHF and
  TA VHF/UHF Python plugin writers and to the existing native Save-panel owner.
  The React owner no longer attempts a second completion after native success or
  cancellation.

Focused final checks passed 273 Python tests, 758 Rust tests, 261 UI/native
contract tests and TypeScript compilation. The broad frontend run produced 3,818
passes and one unrelated load-timing failure in `ContestWorkspace.arrlDX.test.tsx`;
the complete affected file immediately passed 5/5 on rerun. A prior broad run at
the same implementation boundary passed 3,819/3,819. The production frontend build
passed. Primary CI run `39567989235` and macOS/Linux/Windows portability run
`39567989239` both passed for the exact candidate commit. An independent final code
review reported no release-blocking findings. These checks support the milestone;
they are not substitutes for installed-application behavior.

The packaged application's isolated acceptance report is
`/private/tmp/xlog-1.2.100-8435509a-native-acceptance.json`; SHA-256 is
`4ce33b93c5ab5cef5d9397ac2a76e44920f16bb3f55cbee661ea176a71820eb9`.
It records status `passed`, embedded UI and worker present, station I/O disabled,
and all 35 of 35 checks true.

The candidate was incrementally packaged from the canonical checkout, signed and
installed at `/Applications/OM0RX-xLog.app`. The prior installed 1.2.99 application
is retained recoverably at
`/Applications/OM0RX-xLog-1.2.99-backup-2026-10-21.app`. Deep strict signature
verification passed for Developer ID team `4WCMQ4U946`; Gatekeeper reports
`Unnotarized Developer ID`, so this is not notarized public-release acceptance.
Candidate and installed executable hashes match:

- Production executable: `511b5a2da3d237aee16679436f95f8d2b6afe6dcf6d58e7f16019ef3138724b9`
- Swift worker: `43e726c27a058670dfa85f7f742d30a5fba7558b8fd04f760ad3884abbcb8b7d`
- Not1MM runtime provenance: `759e2f74986a5152b4dffcef089953fbf68c3ee8b882cd8fc75e0a366be430d5`
- Not1MM source manifest: `b7303ee4ea62f4e8e296ab6dea38ccf6086d0d84756874e0319b0638fd9f9aeb`

The runtime provenance names source commit `8435509a` and Python 3.12.4. Its only
recorded working-tree change was this acceptance-ledger file, which does not enter
the executable; the provenance record therefore makes that documentation-only
state explicit rather than silently claiming a clean package checkout.

Actual installed-application QA exercised the separate Contest Setup, Main Logging,
Stats and Log Display windows with native macOS close, minimize and zoom controls.
The Contest menu exposed the original workflow windows, the New Contest selector
showed the complete 94-plugin inventory, and selecting CQ WW VHF displayed manual
144.200 MHz entry. The restored CQ WW VHF session showed its 50 and 144 MHz QSOs,
plugin fields and six-point score in Main Logging, Stats and Log Display after the
upgrade. The normal integrated logbook showed 68,431 contacts and was not replaced
or truncated. The user's CQ WW VHF session was restored as the active session after
the disposable checks.

Installed-app QA also created a disposable DARC VHF session and confirmed that Log
Display exposes `Export EDI...`. The attempted installed-app export was correctly
rejected because that disposable contest's Start UTC was blank; the date control's
accessibility rendering appeared populated even though the stored HTML value was
empty. Therefore successful EDI file creation is established by focused
Python/native/UI tests, not by this installed-app run. This distinction remains an
acceptance item rather than being represented as a successful desktop export.

This remains a milestone, not completion of the full Not1MM port. Receipt-backed
normal-log transfer, lossless legacy migration, production phone/audio/PTT and
digital-keying operation, real multi-operator networking, installed successful EDI
save, physical RF/station behavior, sponsor-rule certification, notarization and
public-release acceptance remain incomplete or unaccepted. Controls for unfinished
capabilities must continue to report those limits truthfully. The next coherent
implementation batch is repeat-safe legacy import plus contest-to-normal-log
transfer through the existing xLog logbook service, with durable source and QSO
receipts rather than lossy semantic deduplication.

## Installed 1.2.99 batched milestone — 21 October

- Exact candidate and installed application source:
  `735b1eac159ce0167bfe71b9e63b6c159e39c8a5` on
  `codex/not1mm-contesting`, pushed to GitHub with a clean working tree.
- All 94 byte-pinned original Not1MM Python plugins are registered and executable
  through the existing Python/SQLite host. No contest rules were translated into
  Swift or a new rule language. Registry coverage is not complete operator
  acceptance for every contest.
- Edit Contact now reads and writes the stored original `raw_fields`; unchanged
  saves and callsign-only corrections preserve unrelated plugin fields instead of
  reconstructing them from generic columns.
- Shared entry, manual/observed frequency, spot and correction paths use the
  selected plugin's bands and the existing band/frequency definitions rather than
  an HF-only six-band list.
- A committed QSO clears the original plugin's received fields for the next contact
  while retaining configured sent values and serial allocation. Historical
  `RoverLocation` and its Cabrillo row survive unrelated corrections.
- Post Spot uses the dedicated admitted native route through xLog's existing
  cluster owner, including test-profile restrictions. Native Save-panel completion
  is the sole terminal export owner, preventing a second React completion from
  producing a false error after success or cancellation.

Focused regressions cover raw-field editor roundtrips, next-contact clearing,
historical rover corrections, VHF entry, admitted native spot transport and export
completion across the visible UI/native/Python-host boundaries. The complete
frontend suite passed 3,811 tests across 271 files before the final backend-only
portability repairs. The final primary CI run `39557625842` passed, and the
exact-source portability run `39557668408` passed on macOS, Linux and Windows.
Local Swift worker, native-admission and focused host checks also passed. These are
supporting automated checks, not packaged-desktop proof.

The exact-source package acceptance report is
`/private/tmp/om0rx-xlog-1.2.99-not1mm-acceptance-735b1eac-20261021.json`.
Its SHA-256 is
`66b9fe107dccf8d9e5d765146488876e60dfb876d783f389c8b114347638b2d1`;
it records schema 1, status `passed`, `embeddedUi: true`, `worker: true`,
`station_io: false`, and all 35 of 35 checks true.

The exact-source candidate was incrementally packaged, signed and installed at
`/Applications/OM0RX-xLog.app`. Deep strict verification passed for Developer ID
team `4WCMQ4U946`; Gatekeeper reports `Unnotarized Developer ID`. Candidate and
installed hashes match:

- Production executable: `fe2ce8adeb652e0f842d5b639e66eb90dbbcd50023a219f667cd4ae2cff51aaa`
- Swift worker: `7f642f0a20b2e9eabe254ffc872a1ff7d6bc0752b9c05d4a7fdf1fa4b045d1fb`
- Not1MM runtime provenance: `55015fff226a7fa7e2730fd6f6a8b9c8e4d7697d1d5c909d82b59db91ecda8d7`
- Not1MM source manifest: `b7303ee4ea62f4e8e296ab6dea38ccf6086d0d84756874e0319b0638fd9f9aeb`

Actual installed-application QA created a disposable CQ WW VHF contest and used
the separate Contest Setup, Main Logging, Log Display and Edit Contact windows,
all with standard macOS close, minimize and zoom controls. A 50.125 MHz CW QSO
with `VK8ZZZ` (`JN88`/`PH57`) scored one point and one multiplier; its received
grid and callsign cleared after commit. Manual frequency entry then admitted
144.200 MHz and selected 2 m. A 144.200 MHz CW QSO with `VK2ZZZ`
(`JN88`/`QF56`) scored two points, produced a two-QSO/two-multiplier score of six,
and again cleared the received grid and callsign. The first frequency update
needed the existing visible stale-edit retry; `Apply edit again` admitted it
without losing the draft.

Opening `VK2ZZZ` in the visible editor showed the original 2 m band, sent grid
`JN88` and received grid `QF56`. An unchanged save returned to Log Display with
both grids intact. Native Cabrillo export completed through the Save panel without
a false terminal error at
`/private/tmp/OM0RX-CQ-WW-VHF-disposable-735b1eac.log`; SHA-256 is
`0c0c1be815258c2ccea09fa6c474a8a4b2e98e11611e023abce715ef322c4bcb`.
The file contains `CONTEST: CQ-VHF-SSBCW`, `CATEGORY-MODE: CW` and correct 50 and
144 MHz QSO rows with both grids. After quitting and relaunching the installed
application, Contest Log Display restored the same two contacts, frequencies,
grids and point values. The normal integrated logbook still showed 68,430 contacts,
so the disposable contest workflow did not replace or truncate normal-log data.

This is a meaningful implementation checkpoint, not full Not1MM acceptance.
Every registered plugin still needs its contest-specific operator workflow
accepted. EDI export where required, production digital packet routing,
phone/audio/PTT operation, real multi-operator peer behavior, normal-log transfer
and migration remain incomplete or unaccepted. No physical RF, amplifier, rotor,
sponsor-rule certification, notarization or public-release acceptance was
demonstrated. The packaged CQ WW VHF workflow above exercised CW only.

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

- No physical RF, voice playback, PTT, amplifier, tuner or rotor action was
  exercised in the 1.3.0 acceptance. Contesting Test intentionally blocks those
  paths; the production voice owner is implemented but still needs selected
  device and real-station hardware acceptance.
- WSJT-X/JTDX acceptance used safe synthetic logged-QSO packets. No external
  WSJT-X/JTDX or fldigi application, modem, digital audio, CAT, PTT or RF path was
  exercised; receiving logged QSOs is not full modem/keying integration.
- Group Chat has a bounded multicast owner and separate saved window, but no
  second live peer was available. Renfield publication is best-effort and does
  not establish authoritative shared serial, duplicate or log synchronization.
- The reported 7P8GE 28.088 MHz `FT-8 TNX 73s` row had aged out before this
  installed-app pass. Its exact parser/session behavior and stale-row refresh are
  regression-tested, but that exact live cluster observation was not repeated.
- BERU's original ESM auto-logs numeric exchanges only. Valid `SERIAL HQ`
  contacts work through direct commit, scoring, correction and export, but still
  require manual commit rather than Enter-driven ESM.
- The 94-entry registry is complete, but sponsor-rule certification and a full
  installed operator rehearsal for every original contest/window combination are
  not complete. Registration alone is not full Not1MM parity.
- Windows and Linux evidence is source portability only; packaged application
  acceptance remains Mac-first.
- Physical real-station and remote Wavelog receipt checks remain separate
  acceptance boundaries, including a fresh remote receipt for the earlier C5R
  investigation.

## Post-1.3.0 source continuation: N1MM packet output

Source `0ac570bd` restores the original manual's N1MM configuration page and
connects its optional UDP output through the existing Python contest host. The
page retains the xLog appearance and the original Station Name, Operator Name,
Radio, Contact, Lookup and Score controls, including space-separated
`host:port` destinations. Existing flat setup keys and legacy host/port values
are preserved; the feature is disabled by default.

The sender preserves the original `RadioInfo`, `contactinfo`,
`contactreplace`, `contactdelete`, `lookupinfo` and `scoreinfo` XML roots and
packet defaults. Contact, correction and deletion packets are derived from the
authoritative committed row. Publication happens only after the SQLite
mutation commits; replaying an admitted operation does not resend its packets.
Actual UDP requires both the operator's global/per-packet choices and the
production-only native capability `XLOG_CONTEST_N1MM_UDP_ALLOWED=1`. The
Contesting Test launcher never grants that capability.

Supporting checks at this exact source boundary:

- the complete Python contest-host suite passed 288 tests; the added focused
  packet suite also covers all six roots, destination fan-out, the native
  capability fence, correction/delete identity, invalid destinations and
  no-resend operation replay;
- the Configuration Settings and detached-geometry suites passed 59 tests,
  including legacy destination migration and a 1x-to-2x display-scale move;
- the native runtime-profile suite passed 13 tests, and the frontend production
  build completed with only the existing chunk-size warning;
- the N1MM tab grid is now data-driven and the configuration resize handler
  converts each event using the current display scale. The unimplemented
  `clearOnVFOChange` choice is no longer presented as working, but its saved
  value is retained.

This is implemented source, not installed-app acceptance. No external N1MM UDP
receiver or packet consumer was used, and no new signed application was built
for this batch. A broader `PythonContestLaneTests` run passed eight of nine
tests; its WSJT-X snapshot case read the process-global installed preference
`active_contest` instead of the disposable test's expected
`ordinary_logbook`. The operator's saved preference was not changed. That
test-isolation leak is separate from the N1MM route and remains to be corrected
before the next broad release gate.

## Post-1.3.0 source continuation: multi-operator authority workflow

Source `fe03f4f1798d3d7aaffbe847495571e63e7a8962` completes the visible
trusted-LAN master/client logging path on top of the authority foundation from
`957e53e953031d8f3e236a2dd825d690bbeb35ab`, without adding a second station
service. The Python contest host remains the only SQLite writer and provides
durable, request-idempotent shared serial reservation, duplicate inquiry,
contact commit/correction/deletion and ordered change replay across restart.
Serial allocation is transactionally unique; remote correction/deletion is
fenced by the latest revision of the target QSO.

The existing Group Chat multicast owner supports the optional master/client v1
protocol alongside legacy Renfield CHAT/POST traffic. It carries correlated
request, session, workspace, lease, revision-cursor and contest identities;
requests from a different plugin/start-UTC/station-call fingerprint are rejected
before lease adoption or worker dispatch. Replay caches are bounded, lease loss
revokes pending work, and native forwarding remains restricted to the approved
authority routes. Configuration exposes the original **Be the master** choice
and Group Chat displays the current authority role/status.

Main Logging now uses that authority for initial serial reservation, duplicate
display, commit, correction and deletion. The native sync command fetches the
master's authenticated pages internally; the renderer cannot inject a replay
page or cursor. A client binds an empty local contest as a durable read replica,
applies only complete consecutive pages, and preserves authoritative raw fields,
country identity and per-contact revision. Direct entry, Enter/ESM and function
keys share the same authority-aware commit owner; they fail closed when the
client has no valid lease. Pending commit/correction/deletion identity and exact
payload are persisted before transmission, so a timeout, reconnect or restart
retries the same operation rather than creating a second QSO. Corrupt active
pending evidence requires explicit quarantine and master-log review.

The trust boundary is intentionally narrow and explicit: this is correlation on
an isolated trusted multicast LAN, not cryptographic peer authentication against
an active LAN observer. Legacy Renfield acknowledgements remain transport-only.
`remotePersistenceVerified` stays false until an active lease has returned a
successful `contactApply`; serial or dupe replies alone do not claim persistence.

Supporting checks at this exact source boundary:

- the complete Python contest-host suite passed **301 tests**, including
  concurrent serials, exact replay/payload conflict, stale workspace,
  snapshot-stable dupe inquiry, correction/deletion revision fencing, complete
  paged restart replay, interrupted migration repair, replica restart and
  rejection of omitted or unsupported historical changes;
- the complete frontend suite passed **3,868 tests in 273 files** plus the two
  Node acceptance checks. Focused authority/UI coverage exercises lease
  bootstrap, replica catch-up, serial reuse, Enter/ESM fail-closed behavior,
  durable ambiguous-operation recovery and quarantine of corrupt active-scope
  pending evidence;
- the native Group/worker checks passed **92 tests** across the selected suites,
  including generation/context fencing, authenticated internal page fetch,
  page-size limits and rejection of generic renderer access to authority data;
- TypeScript checking and the production frontend build passed, with only the
  existing Vite chunk-size warning; a final read-only cross-review found no
  actionable defect in the completed client/replica boundary.

This remains implemented source, not installed two-machine acceptance. No new
1.3.0 package has yet been built from `fe03f4f1`, and no second Mac exercised
real multicast loss/reconnect while both operators logged. The first replica
must be an empty local contest; histories predating the required authority
identity cannot be adopted automatically. Master failover/rebind is not
implemented, and trusted-LAN correlation is not cryptographic peer identity.
Those are exact remaining multi-operator limits, not a claim that shared logging
is accepted merely because the routes and automated workflows now pass.
