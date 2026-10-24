# CQ WW SSB macOS reconciliation — 23 October 2026

## 1.3.12 installed Cluster/Flex correction — 25 October 2026

**READY WITH LIMITATIONS** for the bounded macOS CQ WW SSB workflow. The installed
candidate is **1.3.12**, clean source **`4bc7d4f4159cf190f953da02bd8a8fb3bc957a4c`**.
On 25 October 2026 (Australia/Darwin), the operator confirmed **“Both are working”**
when asked whether spots are visible on Flex/Maestro and Show worked behaves
correctly. Both previously pending operator checks are now confirmed. This
establishes observed operation, not uninterrupted delivery for the entire contest.

| Gate | Concrete result |
| --- | --- |
| Exact installed application | `/Applications/OM0RX-xLog.app`; Developer ID deep/strict signature passed, 92 bundled Python Mach-O hashes verified, candidate/installed component hashes identical; [receipt](evidence/cq-ww-ssb-1.3.12/installed-verification.json) |
| Actual Python CQ WW lane | 27/27 passed in the [packaged bundle](evidence/cq-ww-ssb-1.3.12/packaged-verification.json) and 27/27 in the installed bundle, using its Python interpreter, host and Not1MM vendor code in disposable stores; entry, DUPE, invalid exchange, correction, export and reopen covered |
| Installed native acceptance | [35/35 passed](evidence/cq-ww-ssb-1.3.12/installed-acceptance.json), isolated namespace, `production_singleton=false`, `station_io=false`; separate from Python-lane evidence |
| Focused regression | [452/452 frontend tests passed](evidence/cq-ww-ssb-1.3.12/frontend-tests.json), TypeScript passed; [18/18 native Cluster tests passed](evidence/cq-ww-ssb-1.3.12/native-cluster-tests.txt), including the delivery-receipt failure reproduced before the fix |
| Independent review | Native receipt, mode/range and worked-filter changes independently reviewed; no remaining blocking findings in this bounded diff |
| Restored production session | Original session `4ac63449-bb24-4370-b159-e2b671321618` reopened; backup had 288 contacts. Read-only UI observation after the operator resumed showed 293 QSOs, 82 multipliers, score 30,422, live 7.102 MHz and ready-for-callsign state. No test QSO was added to production |
| Running spot output | [Read-only observation](evidence/cq-ww-ssb-1.3.12/live-observation.json): 42 entries in forwarded-radio inventory at 19:21:02 UTC, inventory updated at 19:21:00. Band Map showed live VFO and classified green/blue calls within 7.050–7.200 MHz |
| Operator acceptance | Flex/Maestro spot visibility and Show worked confirmed together: “Both are working”, 25 October 2026 (Australia/Darwin); recorded separately from automated and read-only observations |
| Backup | `/Users/oliver/Documents/Backups/OM0RX-xLog-1.3.12-before-install-20261024T191500Z`; 288 contacts, SQLite quick check OK, 30 databases and 55 files; [summary](evidence/cq-ww-ssb-1.3.12/backup.json) |
| Rollback | `/Applications/OM0RX-xLog-previous-20261024T191454Z-2517.app`, verified signed 1.3.11. Preserve the current live database when rolling back the app; restoring the pre-install database would discard newer operator QSOs |

### Changes and practical limits

The native Cluster session treated a successful radio publication receipt as a
new full spot snapshot. Because a receipt has no spot array, successful delivery
could invalidate the Cluster state and lead to later empty output. Publication
receipts now retain the valid snapshot and activation identities. Regression
cases cover completed, pending, stale, rejected-delivery and clear receipts.

Contest phone-range inference also overwrote upstream FT8 classification at
7.074 MHz. Existing digital modes now remain digital; explicit mode comments
and SSB below 7.100 MHz remain supported. Configured phone frequency edges apply
to the supplied CQ WW stream. Contest Filters now use contest-dupe status and
coordinate with Show worked, rather than combining normal-log worked history
with a conflicting contest checkbox.

Cluster and Band Map can still differ when their age, source, band, worked,
viewport or other filters differ. SH/DX/100 requests 100 reports across all
bands, not 100 eligible unworked 40 m SSB calls; the prior small result was
verified from persisted reports. Compare like-for-like filters using the
[operator checklist](CQ_WW_SSB_OPERATOR_CHECKLIST_1_3_12.md). That checklist also
documents the approved N1MM-inspired improvements and where to exercise them;
complete N1MM/Not1MM parity is not claimed.

Old false Heard overlays are not automatically purged because genuine manual
observations cannot be distinguished reliably. Recorded voice files, routing,
PTT and actual transmitter audio remain four separate optional, untested results;
macro substitution is not recorded-voice acceptance. No test tuning, RF, PTT,
rotor or audio actions were performed. Windows/Linux remain outside this release.

The older 1.3.9 and 1.3.10 Applications bundles were removed after source ancestry
and resource inspection; current 1.3.12 and immediate signed 1.3.11 rollback remain.
The old 1.3.9 signature discrepancy was added Python bytecode caches, not unique
source work. [Cleanup receipt](evidence/cq-ww-ssb-1.3.12/cleanup.json).
The canonical candidate remains in the canonical checkout; settings and data
backups were retained. No cosmetic rebuild was performed for this record.

**Future work only:** [Contest → Log Review backlog](CONTEST_LOG_REVIEW_BACKLOG.md)
records the operator-approved discussion: on-demand possible-typo and
frequency/time comparison against independent received reports, with Reviewed
filtering and no automatic log edits. It is not implemented in 1.3.12.

## 1.3.11 installed verification and operator follow-up — 25 October 2026

**NOT READY for the complete requested workflow:** the operator confirmed stable
spot clicks and refocusing, but subsequently reported disappearing Flex/Maestro
spots, FT8 reports incorrectly admitted as SSB, and conflicting worked filters.
The narrow follow-up is recorded above this section when accepted. The earlier
1.3.10 result below is historical, not a claim that these new issues are closed.

| Gate | Concrete result |
| --- | --- |
| Exact installed source | `1.3.11`, `/Applications/OM0RX-xLog.app`, embedded clean commit `1657270430e6f50bfdda3d8a7bd17e1b811879e9` |
| Package and installed identity | Developer ID deep/strict signature passed, 92 Python Mach-O hashes verified; package and installed component hashes agree; [receipt](evidence/cq-ww-ssb-1.3.11/installed-source.json) |
| Packaged Python lane | [27/27 passed](evidence/cq-ww-ssb-1.3.11/packaged-verification.json), packaged interpreter/host/vendor in disposable storage; installed bundle separately verified byte-identical |
| Native installed UI | [35/35 passed](evidence/cq-ww-ssb-1.3.11/installed-acceptance.json), isolated namespace, `production_singleton=false`, `station_io=false` |
| Frontend combined regression | [625/625 passed](evidence/cq-ww-ssb-1.3.11/frontend-tests.json); TypeScript and focused Swift/Python/native checks also passed |
| Production reopen | Original session restored with 282 contacts, 81 multipliers, score 29,160 and existing OZ11A draft/CQ14; no synthetic contact added |
| Operator confirmation | “yes, its stable now” for spot clicks and refocusing without jumping or false Heard spots; subsequent Flex failure remains open |
| Preserved backup | `/Users/oliver/Documents/Backups/OM0RX-xLog-1.3.11-before-install-20261024T184002Z`, 282 contacts, SQLite `quick_check=ok`; settings and services preserved |
| Immediate rollback | `/Applications/OM0RX-xLog-previous-20261024T184123Z-89290.app`, preceding 1.3.10 |

This version adds stable incremental spot classification/display, separate
pending classification styling, frequency-anchored Band Map leaders, navigation
and optional N1MM keyboard bindings, log column/divider controls, multiplier
filters, hourly Rates/goal display, SCP pane controls, and exchange advisories.
Tune acknowledgement ordering and typed-call provenance prevent clicked or
auto-loaded calls from becoming false Heard spots. Navigation handles delayed
and skipped telemetry. The map frequency annotation now uses MHz correctly.
Independent review and narrow/wide synthetic layout checks were completed.

The apparent three-spot `SH/DX/100` result was not a lost response: the persisted
18:44:23 UTC burst contains 100 reports across all bands, six 40 m SSB reports,
five distinct calls, three already worked. EA6Y and W2UD plus a newer live BD8ABR
report explain the three displayed rows. EA6Y was subsequently logged by the
operator at 18:53:55 UTC. [Read-only observations](evidence/cq-ww-ssb-1.3.11/operator-observation.json).

Existing erroneous Heard overlays were not silently deleted: they cannot be
reliably distinguished from genuine manual observations and will age out or can
be removed by the operator. Recorded files, audio routing, PTT and transmitter
audio remain separate optional, untested results; macro substitution is not
voice acceptance. No test radio tuning, PTT, rotor, audio or RF action occurred.
No Windows/Linux acceptance or complete N1MM/Not1MM parity is claimed.

## 1.3.10 classification, Band Map and zone-prefill acceptance — 25 October 2026

**READY WITH LIMITATIONS** for the existing macOS CQ WW SSB 40 m workflow.
Version **1.3.10** is installed and running. The operator explicitly confirmed:
**“Yes, improved and Flex spots visible”** when asked about classification speed,
steadier ordering and continued Flex/Maestro delivery. This closes this bounded
batch; it is not a claim of complete N1MM/Not1MM feature parity.

| Gate | Concrete result |
| --- | --- |
| Installed source | `/Applications/OM0RX-xLog.app`, `1.3.10`, exact embedded commit `b4381149b9b3f5dbd8be1826fbd9a44cc5a82516` |
| Package identity and signing | Deep/strict signature checks passed; packaged and installed executable, worker and Python receipt hashes match; [exact receipt](evidence/cq-ww-ssb-1.3.10/installed-source.json) |
| Actual packaged Python lane | [26/26 CQ WW tests passed](evidence/cq-ww-ssb-1.3.10/packaged-cqww-tests.json), using bundled Python and packaged host/store/Not1MM imports in disposable storage; includes entry, DUPE, correction, persistence and export checks |
| Installed native UI | [All native acceptance checks passed](evidence/cq-ww-ssb-1.3.10/installed-acceptance.json), isolated namespace, `station_io=false`; separate from the actual Python-lane evidence above |
| Production reopen | Same session `4ac63449-bb24-4370-b159-e2b671321618`, 252 QSOs, 77 multipliers and score 24,178 reopened; blank entry ready for operation |
| Installed manual lookup | Typed MX0KBS without logging: CQ zone became 14; footer displayed `299° Hdg · LP 119° / distance 1,449 km`; map displayed MX0KBS path and the same bearings/distance. Wipe then cleared the verification draft, with no test QSO saved |
| Performance | Same 237-QSO disposable snapshot: eight spot classifications median **221.49 → 23.39 ms**, identical classification responses. These are host timings, not guaranteed end-to-end UI times; [samples and comparison](evidence/cq-ww-ssb-1.3.10/classification-performance.json) |
| Independent review | Backend, single-flight scheduling, Band Map geometry and observed-call prefill reviewed independently; no remaining blocking finding |
| Backup | `/Users/oliver/Documents/Backups/OM0RX-xLog-1.3.10-before-install-20261024T172308Z`, 252 contacts, SQLite `quick_check=ok`, settings/services copied |
| Rollback app | `/Applications/OM0RX-xLog-previous-20261024T172312Z-69869.app`, verified preceding version 1.3.9 |

### What changed and why

- A prior-contact lookup index removes repeated scans during authoritative
  multiplier calculations. Candidate previews reuse a request-local country map
  through defensive lookup copies. Existing scoring and rollback semantics remain.
- Incoming updates share one classification request in flight. A burst regression
  previously admitted six overlapping requests; it now queues each candidate once,
  retains valid completed results and rejects results from before a QSO change.
- Equal-time Cluster rows no longer inherit changing snapshot order. Newer spots
  still obey the selected sort, and worked rows still leave a Needed-only view.
- Contest Band Map calls use separated vertical positions with coloured leaders
  anchored to their exact frequencies, following the supplied N1MM manual page 272.
  A crowded 430px fixture was visually checked. Normal Band Map placement was not
  changed; colours, worked visibility, resolution and click handlers are preserved.
- Entry headings and distance display whole degrees/kilometres, keeping internal
  precision. Radio-follow now resolves `observedSpotCallsign` before Python adopts
  the call and prefills its CQ zone. A native MX0KBS regression failed before this
  fix and passed afterward; manually entered zone overrides remain preserved.

Validation includes 168 workspace tests plus three targeted radio-follow tests,
205 detached/cluster/filter tests, 52 Band Map/style tests, 12 native Python bridge
tests, TypeScript, packaging gates and the installed/package checks above.
The broader Python suite passed 327/330: two older country-identity expectations
and one Stew Perry power-field error also fail against installed 1.3.9. They are
documented baseline failures, not represented as passing tests or expanded here.

### Remaining limitations and cleanup

- Operator confirmation establishes current Flex/Maestro visibility and improvement;
  it does not prove uninterrupted delivery for the entire remaining contest.
- The map's path annotation can still show a grouped Hz number labelled MHz
  (observed `7.142.400 MHz`), although the target button correctly reads
  `7.142400 MHz`. This presentation-only follow-up was not used to trigger another
  package. The newly requested entry headings/distance are correctly rounded.
- Recorded voice files, output routing, PTT and actual transmitter audio remain
  separate, untested optional acceptance items. No test tuning, PTT, rotor action,
  audio playback or RF transmission was performed. Macro substitution does not
  establish recorded-voice acceptance. No Windows or Linux acceptance is claimed.
- Five older verified application bundles were removed after confirming their
  source commits exist in `origin/main`; current 1.3.10 and the 1.3.9 rollback are
  retained. The canonical work directory contains one current app bundle.
  [Cleanup inventory](evidence/cq-ww-ssb-1.3.10/bundle-cleanup.json). Original data
  recovery folders and backups remain untouched. Older rollback paths in historical
  sections below are historical evidence; use the 1.3.9 rollback listed above.

## 1.3.9 installed recovery and latency evidence — 25 October 2026

**READY WITH LIMITATIONS** for continuing the preserved macOS CQ WW SSB
40 m session. The operator confirmed: “spots are loading and are little faster”.
Subsequent reports demonstrate a remaining classification backlog and Cluster
row movement; these are open follow-up work, not claimed fixed by 1.3.9.

| Gate | Recorded result |
| --- | --- |
| Exact installed source | Version `1.3.9`, `/Applications/OM0RX-xLog.app`, commit `e161d52fe3d5dfe0177a533a8ffe5459644c53dc` |
| Provenance | Packaged and installed receipts/hashes match; `sourceChanges` absent; [receipt](evidence/cq-ww-ssb-1.3.9/installed-source.json) |
| Native installed acceptance | [35/35 PASS](evidence/cq-ww-ssb-1.3.9/installed-acceptance.json), integrated-local-ui, station IO disabled; this does not substitute for Python workflow or physical-radio evidence |
| Preserved data | Read-only pre-install backup verified `quick_check=ok`, 237 contest QSOs; operator continued logging after launch. Restored original normal workspace contained 68,560 QSOs, original settings/window arrangement and 125% display scale |
| Physical Flex/Maestro | Operator confirmed spots appearing after recovery and loading after 1.3.9. Continuous renewal over an entire contest remains an operator observation |
| Actual Python timing | Disposable copy, 237 QSOs: eight distinct previews median 191.60 ms/max 204.39 ms; first 50 log rows 9.93/13.47 ms; partial lookup 1.48/1.76 ms; score 17.23/20.40 ms; rates 1.70/2.40 ms. Host timings exclude end-to-end UI/IPC latency |
| Export evidence reused | Earlier actual UI export `Documents/xLog Contest.adi`, 209 records, SHA-256 `4eed3f34bce750e8c2f6945551377a4dc774b3b110cd1f4092b98f79dbaab918`. This is the earlier 209-contact snapshot, not a current full-log export |
| Data/settings rollback | `/Users/oliver/Documents/Backups/OM0RX-xLog-1.3.9-before-install-20261024T163916Z` |
| Application rollback | `/Applications/OM0RX-xLog-previous-20261024T163919Z-46795.app`, version 1.3.8 |

The installed changes restore main Settings navigation, keep the hidden contest
owner active, admit Show worked and typed-call lookup through the native bridge,
renew unchanged radio spots before expiry, and bound preview batches to eight.
Durable QSO saves no longer await auxiliary log/score/rates reads. A publication
failure after a durable save cannot reject or replay that save. Worked calls use
plain grey Band Map text.

`SH/DX/100` returns recent spots across all bands: captured replies contained 100
reports but only 13 and 9 distinct 40 m SSB calls respectively. Show worked removes
the duplicate filter; it does not override age or frequency-range filters.

No production QSO was added, edited or deleted for verification. No test tune,
PTT, rotor, audio playback or RF action was performed. Existing operator-authorized
spot publication resumed. Macro substitution, recorded files, playback routing,
PTT and actual transmitter audio are separate checks; the latter voice/hardware
checks were not exercised and voice remains optional. Live QRZ, typed-call map
paths, window-filter behaviour and sustained spot delivery must not be inferred
from the native acceptance suite. No Windows/Linux acceptance is claimed.

## 1.3.8 preserved-contest cold-start addendum — 25 October 2026

**READY WITH LIMITATIONS** for continuing the preserved CQ WW SSB 40 m
contest on Apple Silicon macOS. The installed 1.3.8 application now opens the
existing contest session and its old log. This is a narrow cold-start repair;
it does not start another parity, macro or cosmetic batch.

| Final gate | Concrete result |
| --- | --- |
| Installed source | `/Applications/OM0RX-xLog.app`, version/build `1.3.8`, packaged from `c6dbd34b7716caac0d3424750e2926763b725799` |
| Embedded source receipt | `sourceCommit` exactly `c6dbd34b7716caac0d3424750e2926763b725799`; `sourceChanges` is absent (`null` when queried); the packaging checkout was clean and synchronized before the build |
| Signature and identity | Packaged and installed bundles pass deep/strict signature verification; packaged and installed executable SHA-256 `cbd22e4fcf7b8d4e4956b0c532fe414efbc3a7b03b04d446c5895fd3bf73f327`; worker SHA-256 `7e9ea4d5390f599a6c1b537587ae1d4bbe58f60b45c8ff1b1dba8291d1818d95` |
| Embedded Python receipt | Installed `python-runtime.json` SHA-256 `69fc90ebe6a0560ae21f8267b7202e8d0fb3c4b9c7a55c5280d4290da5d4f34f` |
| Packaged native acceptance | 35/35 PASS; `scope: integrated-local-ui`; `production_singleton: false`; `station_io: false`; report SHA-256 `bfc87911b31eeb8873ffff2b57e8c2f87bf2b28bb6aa879eff80123ceb282fac` |
| Installed native acceptance | 35/35 PASS; `scope: integrated-local-ui`; `production_singleton: false`; `station_io: false`; report SHA-256 `5ea30c444aaa6063168dfcc0b95c4fa55a87107e058af5304771c4dcd0e427c7` |
| Real preserved-session check | PASS: installed PID `17184` was mapped from the installed 1.3.8 executable; Main Logging loaded session `4ac63449-bb24-4370-b159-e2b671321618` as CQ WW SSB with `209/68` and score `17340`; Log Display showed `1–11 of 209` and a visible DUPE row |
| Production-data preservation | No QSO was created, edited or deleted. The production `contest.sqlite` remained at mtime `1792841948` and size `19255296` bytes before and after the checks |
| Rollback | `/Applications/OM0RX-xLog-previous-20261024T141831Z-16713.app`, signed version `1.3.7`, embedded source `db1a9bc58c395b2631e235805f5f6d4195a057f5` |

The cold-start failure was caused by two distinct conditions. First, a
successful `contest_open` was coupled to slow restored-window presentation;
1.3.8 now admits the host projection before best-effort presentation. Second,
the installer tried to terminate `OM0RX-xLog` although the actual executable is
`xlog-prototype`, so macOS reused the already-running 1.3.7 process after bundle
replacement. Terminating that stale process and launching the installed bundle
loaded the preserved contest immediately. The installer now resolves and stops
the exact bundle executable path; that script-only follow-up is committed and
pushed at `9c0361628ab7593b67ea0296708eefd142f49def` and passed its process-matching,
TERM-refusal, inventory-failure and shell-syntax checks.

No radio tune, FLEX/Maestro publication, PTT, recorded-phone playback, audio
routing, rotor movement or RF transmission was performed. Those remain
operator-controlled checks and do not block manual contest logging. The 1.3.8
Main Logging window was left open with the callsign field ready for entry.

## 1.3.4 installed candidate addendum — 24 October 2026

**READY WITH LIMITATIONS** for the requested CQ WW SSB 40 m workflow on
Apple Silicon macOS. This is the frozen candidate. It supersedes 1.3.3 and
closes the demonstrated live FLEX/Maestro spot-publication, Run-frequency
transition and requested contest-window presentation issues without starting
another broad Not1MM/N1MM parity batch.

| Final gate | Concrete result |
| --- | --- |
| Canonical source | `ecffef4f32fdd3e9a2441d293dbf21a80fd7d2ce`, clean, committed and pushed to `origin/main` (`0 0` ahead/behind before packaging) |
| Installed application | `/Applications/OM0RX-xLog.app`, version/build `1.3.4` |
| Embedded source receipt | `sourceCommit` exactly `ecffef4f32fdd3e9a2441d293dbf21a80fd7d2ce`; `sourceChanges: []`; installed Python receipt SHA-256 `d491635753462e2e687aab305d2d9bea9f368262249fc0fd82a2f30979f42847` |
| Signature and identity | Developer ID deep/strict verification PASS for packaged and installed bundles; packaged and installed executable SHA-256 `83d5a5969ef17294be8a5a0f569e35168b1b2fedc5fb86c930fdfe723257f720`; worker SHA-256 `705ee22e02dc315cc7b28392c803486f2aec7286aa7ce73c2af2678c93f42c43` |
| Packaged native acceptance | 35/35 PASS; `scope: integrated-local-ui`; `production_singleton: false`; `station_io: false`; report SHA-256 `18e7fd763ceaa03302c132fd15756706270dcfd570ca9e06c93cde64b5058064` |
| Installed native acceptance | 35/35 PASS; `scope: integrated-local-ui`; `production_singleton: false`; `station_io: false`; report SHA-256 `db135d2e0aeb2101dded7ed6fa2712958de14bed08a9e6a0842397aa3c743105` |
| Installed CQ WW SSB lane | The installed bundle's embedded Python 3.12 and embedded Not1MM source passed 24/24 disposable host tests: Run/S&P entry, invalid-zone feedback, correction/delete, DUPE and multiplier classification, ADIF/Cabrillo export, reopen, VFO clear/spot load and country reconciliation |
| Focused regression | 326 affected CQ WW workspace, detached-surface and filter tests PASS; TypeScript/Vite production build PASS; six macOS packaging checks PASS |
| Independent review | The final narrow review of live publication and VFO transition behavior returned no findings |
| Rollback | `/Applications/OM0RX-xLog-previous-20261024T110027Z-31431.app`, signed version 1.3.3 with clean source receipt `b70ba7f92d4e8598b0d4ad2f790cf28e324cda85` |

### Demonstrated fixes in 1.3.4

- Contest spot classification is cached by exact spot input and contest
  revision. Incoming spots after startup therefore continue to produce complete,
  ordered FLEX/Maestro replacement publications instead of being starved by an
  overtaken full-list preview. An incomplete preview never publishes a partial
  replacement set.
- Leaving an established Run calling frequency is treated as an operator retune:
  the contest switches to S&P, clears the departed entry and loads a nearby
  contest spot when present. CAT reconnect from an unknown frequency preserves
  Run and the current entry instead of impersonating an operator retune.
- The contest Band Map and Cluster now expose the same reusable local Filters
  dialog as the desktop cluster. Filtering changes presentation only and does
  not mutate the worker's contest or cluster connection state.
- Rates now shows large centred UTC and local clocks in an isolated child so the
  one-second clock tick does not refresh the rate table or other contest panes.
- The combined candidate also includes the 1.3.4 path-metric and worked-spot
  lifecycle corrections: typed or selected calls can drive map/path context;
  manually heard/logged stations participate in Band Map state; worked spots
  disappear immediately unless Show worked is enabled; and Show worked controls
  the set published to the radio.

The installed-path trial used only isolated temporary workspaces and synthetic
contacts. It did not create, edit or delete a production QSO and did not tune a
radio, publish to a physical radio, assert PTT, play audio, move a rotor or
transmit RF.

### Remaining operator-controlled checks and explicit limits

- Application-side live FLEX/Maestro replacements are regression-covered,
  including a new spot arriving after the initial publication. Actual coloured
  spots continuing to appear on the physical Maestro display require the
  operator's live station observation; a software receipt is not device proof.
- Live CAT frequency following, the Run-to-S&P transition against the operator's
  active radio, authenticated QRZ lookup and visual inspection of the installed
  filter dialogs, rate clocks and window arrangement remain operator-controlled
  checks.
- Recorded voice is separate from macro substitution. Recording presence,
  output routing, PTT release and actual transmitter audio remain unaccepted;
  voice is optional and does not block manual-microphone logging.
- Windows/Linux, notarization, multi-Mac behavior and broad all-contest parity
  remain outside this macOS CQ WW SSB freeze.

### Cleanup and rollback

The signed 1.3.3 bundle above is the single retained rollback. The superseded
1.3.2 bundle was moved recoverably to
`/Users/oliver/.Trash/OM0RX-xLog-previous-20261024T091558Z-94455.app`.
No older application bundle remained in the canonical work directory; its only
bundle is the current signed 1.3.4 package. Settings, backups, contest data and
production QSOs were not removed or altered. Durable acceptance reports are in
`docs/contesting/evidence/cq-ww-ssb-ecffef4f/`.

No further compatibility, macro-expansion or parity batch starts from this
report.

## 1.3.3 installed candidate addendum — 24 October 2026

**READY WITH LIMITATIONS** for the requested CQ WW SSB 40 m workflow on
Apple Silicon macOS. This is the frozen candidate. It supersedes 1.3.2 and
closes the demonstrated CTY primary-prefix, contest spot-publication and
worked-spot refresh blockers without reopening broad Not1MM/N1MM parity work.

| Final gate | Concrete result |
| --- | --- |
| Canonical source | `b70ba7f92d4e8598b0d4ad2f790cf28e324cda85`, clean, committed and pushed to `origin/main` (`0 0` ahead/behind before packaging) |
| Installed application | `/Applications/OM0RX-xLog.app`, version/build `1.3.3` |
| Embedded source receipt | `sourceCommit` exactly `b70ba7f92d4e8598b0d4ad2f790cf28e324cda85`; `sourceChanges: []`; installed Python receipt SHA-256 `63bcfa0a0f0cf9507bc62a6d95ba6fb52bd9eb893c30297fe3107b5ac6754345` |
| Signature and identity | Developer ID deep/strict verification PASS for packaged and installed bundles; packaged and installed executable SHA-256 `3a7556a74d3d3f4dda2f952d5ed34f1bd0a574e60d276b289a8281a6586db37d`; worker SHA-256 `9b4fa506517b17b9abc9a0618ec85e957f0f617ac9bd467601ffd6607abfabc4` |
| Packaged native acceptance | 35/35 PASS; `scope: integrated-local-ui`; `production_singleton: false`; `station_io: false`; report SHA-256 `ac9a2520ed558a8ea2f949cc42a7a91e5ac1f949039ca34cc7ef1c26fe8746bf` |
| Installed native acceptance | 35/35 PASS; `scope: integrated-local-ui`; `production_singleton: false`; `station_io: false`; report SHA-256 `5cb2e742e7679ed4f0f5422326cded03bb55f02dd78f2a4aa928def869ddbfe6` |
| Installed CQ WW SSB lane | The installed bundle's embedded Python 3.12 and embedded Not1MM source passed 24/24 disposable host tests: Run/S&P entry, invalid-zone feedback, correction/delete, DUPE and multiplier classification, ADIF/Cabrillo export, reopen, VFO clear/spot load and OE8DDX country reconciliation |
| Focused regression | 387 affected CQ WW, detached-surface, Band Map and owner tests PASS; final TypeScript/Vite production build PASS; focused Swift CTY/publication suites PASS |
| Independent review | Three narrow review passes completed; the final review returned no findings |
| Rollback | `/Applications/OM0RX-xLog-previous-20261024T091558Z-94455.app`, signed version 1.3.2 with clean source receipt `0d3209e4fc6983050d59b3766459d8c82dba2156` |

### Demonstrated fixes in 1.3.3

- CTY matches now use the matched row's primary prefix instead of another
  entity that shares the same ADIF number. `OE8DDX` therefore displays and
  scores as Austria / `OE`, not `*4U1V`.
- On session open, an existing CQ WW SSB row is reconciled only when the stored
  identity and current CTY result refer to the same entity endpoint. The
  mutation is revision-, workspace- and reference-fenced, is audited as
  `reference_reconcile`, and rebuilds points and multiplier matrices. Endpoint
  conflicts are left untouched rather than guessed.
- Contest spot publication now follows the configured active contest band. If
  the radio leaves configured contest bands, the app sends a valid scoped empty
  replacement so stale contest spots are cleared from FLEX/Maestro instead of
  silently retaining them.
- Immediate worked filtering, Wipe reconciliation, entry feedback, Band Map
  presentation, country identity in log/check-partial projections, and the
  1.3.3 version/lockfile identity are included in the same combined candidate.

The installed-path trial used only isolated temporary workspaces and synthetic
contacts. It did not create, edit or delete a production QSO and did not tune a
radio, publish to a physical radio, assert PTT, play audio, move a rotor or
transmit RF.

### Remaining operator-controlled checks and explicit limits

- The application-side FLEX/Maestro replacement contract is covered, including
  active-band publication and stale-spot clearing. Actual coloured spots on the
  physical Maestro display still require the operator's live session
  observation; a software receipt is not physical-device proof.
- Live CAT frequency following, spot selection/readback against the operator's
  active radio, authenticated QRZ lookup and visual inspection of the installed
  contest window arrangement remain operator-controlled checks.
- Recorded voice is separate from macro substitution. Recording presence,
  output routing, PTT release and actual transmitter audio remain unaccepted;
  voice is optional and does not block manual-microphone logging.
- Windows/Linux, notarization, multi-Mac behavior and broad all-contest parity
  remain outside this macOS CQ WW SSB freeze.

### Cleanup and rollback

The signed 1.3.2 bundle above is the single retained rollback. The superseded
1.3.1 bundle was moved recoverably to
`/Users/oliver/.Trash/OM0RX-xLog-previous-20261024T071349Z-57988.app`.
Settings, backups, contest data and production QSOs were not removed or
altered. Durable acceptance reports are in
`docs/contesting/evidence/cq-ww-ssb-b70ba7f9/`.

No further compatibility, macro-expansion or parity batch starts from this
report.

## 1.3.2 installed candidate addendum — 24 October 2026

**READY WITH LIMITATIONS** for the requested CQ WW SSB 40 m workflow on
Apple Silicon macOS. This is the frozen candidate. It supersedes 1.3.1 and
closes the demonstrated contest-entry, worked-spot refresh, band-map rendering
and FLEX spot-publication blockers without starting another parity batch.

| Final gate | Concrete result |
| --- | --- |
| Canonical source | `0d3209e4fc6983050d59b3766459d8c82dba2156`, clean, committed and pushed to `origin/main` (`0 0` ahead/behind before packaging) |
| Installed application | `/Applications/OM0RX-xLog.app`, version/build `1.3.2`; the old process was stopped and the running executable was verified from this exact path |
| Embedded source receipt | `sourceCommit` exactly `0d3209e4fc6983050d59b3766459d8c82dba2156`; `sourceChanges: []`; receipt SHA-256 `cd33b38409c11a129bc267bdbf06e3dd969e13cd07c3379ea3a12909d5a6b432` |
| Signature and identity | Developer ID deep/strict verification PASS for packaged and installed bundles; packaged and installed executable SHA-256 `68bf280bcadaf26d0b044201731dfe66a00eda65f2b0c1c87141f9d5d84dbded`; worker SHA-256 `fcdc90618ed2ca6b74f091cc2f853b4677744febca62c819c1eda4ade9327196` |
| Packaged native acceptance | 35/35 PASS; `scope: integrated-local-ui`; `production_singleton: false`; `station_io: false`; report SHA-256 `7c0519e31d6b85ad738a5a839775fe0a7228f3454132c5d404db8fc11e923b44` |
| Installed native acceptance | 35/35 PASS; `scope: integrated-local-ui`; `production_singleton: false`; `station_io: false`; report SHA-256 `64d5bd0963cb072a914f77ab91114ce2566221c90eabebbaeb5a4f4e41de7abd` |
| Focused frontend regression | 361/361 affected CQ WW, detached-contest and Band Map tests PASS before review; final entry-queue/Wipe suite 161/161 PASS; TypeScript and production build PASS |
| Native and FLEX regression | 26 focused Swift public-service/cluster tests PASS. Dedicated Remote Station Agent tests PASS for 40 m SSB to LSB, 20 m SSB to USB, green/red/blue/grey spot publication, post-log removal/republication and frontend-revision republish |
| Independent review | Two review rounds found five concrete queue/cancellation/lockfile issues; all were corrected. The final narrow re-review returned no findings |
| Rollback | `/Applications/OM0RX-xLog-previous-20261024T071349Z-57988.app`, signed version 1.3.1 with clean source receipt `3a534d57b92e8f1e52b9bc9038bae1c4361e6c42` |

### Demonstrated fixes in 1.3.2

- A newly logged callsign is classified as a dupe immediately. With **Show
  worked** off, duplicate feed copies now disappear immediately from the Band
  Map and Spots Map; with it on, the station remains visible in grey.
- Contest spots preserve all four CQ WW states for radio publication: green
  double multiplier, red single multiplier, blue valid QSO and grey
  dupe/non-workable. CQ WW SSB is normalized to the mode FLEX expects: LSB
  below 10 MHz and USB above 10 MHz.
- Enter from Callsign, SNT, RCV or CQ Zone now coalesces to one pending commit
  rather than dropping or duplicating clicks while the owner is busy. Wipe
  cancels an unsent commit, resets immediately, and uses a generation/edit
  fence so a new callsign typed while reconciliation finishes is not erased.
- The 40 m configured phone segment is honoured even where the default band
  plan labels an overlapping segment as data; custom 7050–7200-style limits
  and Band Map resolution changes therefore remain effective.
- Callsign lookup has a bounded fallback/retry path, including the reproduced
  `LN8W` Norway/CQ 14/ITU 18 case, without repeatedly blanking unrelated
  contest windows.

The candidate was exercised without production-QSO edits and without radio
tuning, RF, PTT, rotor or transmitter-audio actions. Normal Logging remains
present and was not replaced by the contest lane.

### Remaining operator-controlled checks and explicit limits

- The application-side Remote Station Agent publication contract is verified,
  but an actual coloured spot appearing on the physical FLEX/Maestro display
  still requires the operator's live radio/session observation. An accepted
  command or test-double receipt is not physical-device proof.
- Live CAT frequency following, spot selection against the operator's active
  radio, QRZ credential resolution, microphone routing, PTT and actual
  transmitter audio were deliberately not exercised in this release pass.
- Recorded voice remains separate: file presence, macro substitution, output
  routing, PTT and transmitted audio are independent results. Voice remains
  optional and does not block logging.

### Cleanup and rollback

The signed 1.3.1 bundle above is the single retained rollback. The superseded
1.3.0 bundle was moved recoverably to
`/Users/oliver/.Trash/OM0RX-xLog-previous-20261024T053837Z-80897.app`.
Regenerated Swift, Rust/Tauri and frontend build outputs were removed after
the installed bundle and rollback were verified; source, settings, evidence,
logbook backups and contest data were not removed.

No further Not1MM/N1MM parity or macro-expansion batch starts from this report.

## 1.3.1 installed candidate addendum — 24 October 2026

**READY WITH LIMITATIONS** for the requested CQ WW SSB 40 m workflow on
Apple Silicon macOS. This is the frozen candidate; it supersedes the 1.3.0
installed identity below without reopening broad Not1MM/N1MM parity work.

| Final gate | Concrete result |
| --- | --- |
| Canonical source | `3a534d57b92e8f1e52b9bc9038bae1c4361e6c42`, clean, committed and pushed to `origin/main` (`0 0` ahead/behind before packaging) |
| Installed application | `/Applications/OM0RX-xLog.app`, version/build `1.3.1` |
| Embedded source receipt | `sourceCommit` exactly `3a534d57b92e8f1e52b9bc9038bae1c4361e6c42`; the clean receipt has no `sourceChanges` entry |
| Signature | Developer ID deep/strict verification PASS for the packaged and installed bundles, embedded Python framework, worker, `rigctld` and `rotctld` |
| Packaged native acceptance | 35/35 PASS; `production_singleton: false`; `station_io: false`; report SHA-256 `bd42267fbbace14e47df9b0599282043deb415d6784f8ce2fccfd5e3edb05094` |
| Installed native acceptance | 35/35 PASS; `production_singleton: false`; `station_io: false`; report SHA-256 `9c8a181d53dc8573af11ff8928cac47c20e08ef5a843548d82f52b76e93ae906` |
| Frontend and review regression | Full run: 280 files / 4,126 tests plus 2 Node packaging tests PASS; final TypeScript/Vite build PASS; post-review CQ WW/Band Map run 199/199 PASS plus the transient-preview retry regression PASS |
| Native contest logic | Rust 832/832 PASS; CQ WW SSB Python host 22/22 PASS |
| Rollback | `/Applications/OM0RX-xLog-previous-20261024T053837Z-80897.app`, signed 1.3.0 receipt `fb1c59352046f4e35f93f873d6f893a201d06043` |

This candidate stabilizes the operating path reported during the live contest:
spot classifications are retained while the CQ WW preview is pending and retry
after a transient failure; Cluster, Band Map and Flex/Maestro publication share
the same green double-multiplier, red single-multiplier, blue valid-QSO and gray
dupe/non-workable result. Display spots are deduplicated by callsign, mode and
displayed 100 Hz frequency. S&P VFO changes clear the prior draft, load a nearby
contest spot and retain an unworked typed call as a local marked spot when the
operator tunes away. The typed call is also projected to the contest map.

The main CQ WW entry fields accept Enter from callsign, SNT, RCV or CQ zone,
DUPE calls are red, lookup bearings/distances retry after resolution, and
same-draft owner reconciliation no longer creates the false panel-changed loop.
The Rates window uses the available width. Code review found and corrected two
release risks before packaging: mode was added to spot deduplication, and a
transient preview failure now schedules a retry instead of leaving stale colors.

No acceptance step changed the radio frequency, published spots to a physical
radio, asserted PTT, played audio, moved a rotor, or created/edited/deleted a
production QSO. The remaining operator-controlled checks are therefore the live
Flex/Maestro tune/readback and spot-publication path, real CAT VFO clear/autofill,
physical-keyboard Enter behavior, authenticated QRZ lookup, and visual inspection
of installed Cluster/Band Map colors and the VFO arrow. Recorded voice is tracked
separately: recording presence, output routing, PTT release and actual transmitter
audio remain unaccepted and do not block manual-microphone logging.
Gatekeeper reports `Unnotarized Developer ID`; notarization remains outside this
operator-candidate freeze.

The installed 1.3.1 and one verified 1.3.0 rollback are the only application
bundles retained. The older `8f89e860` rollback and generated Rust/Tauri, Swift
worker, frontend and distribution-metadata output were removed after acceptance,
reclaiming approximately 2.9 GiB without touching settings, backups or contest
data. Durable reports are in
`docs/contesting/evidence/cq-ww-ssb-3a534d57/`. No next compatibility batch was
started.

## Final installed addendum — 24 October 2026

**READY WITH LIMITATIONS** for the requested CQ WW SSB 40 m operating workflow
on Apple Silicon macOS. This addendum supersedes the older candidate identity,
installed receipt and rollback details retained later in this document as
historical evidence.

| Final gate | Concrete result |
| --- | --- |
| Canonical source | `fb1c59352046f4e35f93f873d6f893a201d06043`, clean and pushed to `origin/main` (`0 0` ahead/behind) |
| Installed application | `/Applications/OM0RX-xLog.app`, version/build `1.3.0` |
| Embedded source receipt | `sourceCommit` exactly `fb1c59352046f4e35f93f873d6f893a201d06043`; `sourceChanges` empty |
| Signature | Developer ID deep/strict verification PASS for the installed bundle, embedded Python framework, worker, `rigctld` and `rotctld` |
| Packaged native acceptance | 35/35 PASS; `station_io: false`; SHA-256 `64b35a5a61190092be88e1d12415b3ffe81d0a4772a0769f8d1f622084ad2a23` |
| Installed native acceptance | 35/35 PASS; `station_io: false`; SHA-256 `98249bbd0e8c8b6a754a1d8faaf1a1450a85de0fec2d8882750fb62cfd3d498d` |
| Focused CQ WW desk | 153/153 React owner/surface tests PASS; TypeScript PASS |
| CQ WW SSB Python host | 22/22 PASS, including immutable pinned-country DUPE handling, fresh-zone prefill and VFO clear/spot-load behavior |
| Live installed inspection | Logging controls enabled; Wipe returned immediately; Messages displayed `No contest messages.`; at the observed radio frequency 7.161 MHz the contest desk automatically loaded cluster call `IB9TUP` with CQ zone 15 |
| ADIF import | The supplied N1MM ADIF imported 39 CQ WW SSB QSOs into session `4ac63449-bb24-4370-b159-e2b671321618`; database readback and ADIF export contained 39 contacts at the import checkpoint; pre-import backup retained |
| Rollback | `/Applications/OM0RX-xLog-previous-20261024T041656Z-59790.app`, receipt `8f89e860e3839803b2d359894bec225bc96f75a0` |

The final correction removes the cascading `Pinned country resolution changed`
/ owner-busy / stale-session loop, keeps exact logged-call DUPE detection
authoritative, resets CQ zone when the callsign changes, suppresses the false
unresolved-country notice for an empty draft, and makes CQ WW SSB S&P VFO
behavior deterministic: leaving a frequency clears the previous callsign and
tuning within 300 Hz of a visible contest spot loads that call and its exchange.
The behavior is mandatory for CQ WW SSB even when an older saved profile has
`clearOnVFOChange` disabled; Run mode and other contests retain their existing
policy.

Cluster and Band Map spot status now comes from the same authoritative CQ WW
preview: green is a double multiplier, red a single multiplier, blue a valid
non-multiplier QSO and gray a dupe/non-workable station. The ADIF import command,
Enter-from-entry-fields path, single-mutation Wipe, stale-zone correction and
diagnostic clearing are part of the same frozen candidate.

No acceptance step transmitted RF, asserted PTT, played audio, moved a rotor,
changed the radio frequency or created/edited/deleted a production QSO. The live
7.161 MHz result was observed from the operator's existing radio state. Recorded
voice remains separate from macro substitution: recording presence, output
routing, PTT release and actual transmitted audio were not accepted and do not
block manual-microphone logging. Windows/Linux, notarization, multi-Mac behavior
and broad all-contest parity remain outside this freeze.

The pre-import backup is
`/Users/oliver/Library/Application Support/Contesting/Python/Import Backups/4ac63449-bb24-4370-b159-e2b671321618-before-n1mm-adif-20261024T031400Z.sqlite`.
Two older superseded application bundles were removed after the final rollback
receipt was verified; one signed rollback remains. Generated Rust/Tauri, Swift
worker, frontend and distribution-metadata build directories were also removed,
reclaiming approximately 4.3 GiB without touching source, settings or contest
data.

## Executive verdict

**READY WITH LIMITATIONS** for CQ WW SSB on Apple Silicon macOS 14 or later
using a manual microphone.

The exact installed candidate is OM0RX-xLog `1.3.0` from clean canonical source
`fb1c59352046f4e35f93f873d6f893a201d06043` at
`/Applications/OM0RX-xLog.app`. Source, package receipt and installed receipt
agree. The completed workflow is CQ WW SSB entry, duplicate protection, scoring,
per-band country/zone multipliers, SCP, contest log, cluster opportunity view,
Band Map, statistics/rates, persistence/export and separate native windows.

This is not a claim of complete Not1MM parity, pixel-for-pixel N1MM Logger+
parity, recorded-voice RF readiness, multi-Mac acceptance, public-release
notarization, or Windows/Linux installed acceptance.

## What was completed in this finishing pass

1. **Contest spot semantics.** Cluster and Band Map use CQ WW opportunity
   meaning: blue valid QSO, red one needed multiplier, green both country and
   zone multipliers, gray worked/dupe. Worked spots are hidden by default and
   can be enabled explicitly.
2. **Exclusive operating modules.** Normal Logging and Contesting are mutually
   exclusive owners. Selection is persisted and restart-safe; renderer and
   native admission fences prevent both logging paths from accepting writes at
   the same time. The original main xLog window remains recoverable through the
   Window menu.
3. **Release-gate correction.** The Logbook startup budget now allows the
   demonstrated 20-byte Node 22/24 output difference while retaining a bounded
   402,250-byte ceiling. No product UI/runtime behavior changed in this commit.
4. **Exact package/install reconciliation.** The app was rebuilt and signed from
   `cb708501`, package and installed receipts show an empty `sourceChanges`
   array, both isolated native gates passed 35/35 with `station_io: false`, and
   the exact installed app was opened and inspected.
5. **Cleanup.** One signed immediate rollback and all data backups were retained.
   Two older app bundles, superseded release ZIPs/reports and approximately
   9.5 GiB of generated Rust/Swift build output were removed.

Implementation commits after the previous accepted `cb6f6759` candidate:

- `ca4aea92` — multiplier-semantic contest spot colors.
- `09d8ec37` — exclusive Normal Logging/Contesting operating modules.
- `cb708501` — bounded Node-version variance in the Logbook release gate.
- `8f89e860` — CQ WW live workflow, authoritative spot/DUPE projection and ADIF import.
- `fb1c5935` — final installed VFO clear/spot-load and quiet-message corrections.

## Candidate, tests and durable evidence

| Item | Result |
| --- | --- |
| Canonical source | `fb1c59352046f4e35f93f873d6f893a201d06043`, pushed to `origin/main` |
| Installed bundle | `/Applications/OM0RX-xLog.app`, version/build `1.3.0` |
| Source receipt | exact SHA, empty `sourceChanges`, final component-signature hash phase |
| Signature | Developer ID deep/strict PASS; Gatekeeper says Unnotarized Developer ID |
| CI | `39918021036` PASS |
| Cross-platform prototype | `39918021028` final FAIL: attempt 1 passed 279 files / 4,073 frontend tests and every build/integration step through desktop creation, then hit the 40-minute job ceiling during macOS packaging; attempt 2 ran 4,072/4,073 tests green and failed one unrelated ARRL DX async UI test, which passed 5/5 immediately when rerun locally |
| Contest portability | `39918699201` overall FAIL: macOS contest/native PASS; Ubuntu contest/native PASS; Windows contest PASS; definition generator PASS; Windows native FAIL on directory sync `Access is denied` |
| Local production frontend | TypeScript/Vite/bundle budget PASS; preceding full suite passed 279 files / 4,073 tests |
| Rust | preceding exact-product run passed 814 unit and 26 integration tests |
| CQ WW focused host | 22 tests PASS, including `OM0A -> CQ zone 15`, manual override preservation and VFO clear/spot-load behavior |
| Packaged native acceptance | isolated non-production gate: 35/35 PASS, embedded UI + worker, `production_singleton: false`, `station_io: false` |
| Installed native acceptance | isolated non-production gate: 35/35 PASS, embedded UI + worker, `production_singleton: false`, `station_io: false` |
| Previous accepted archive | `dist/OM0RX-xLog-1.3.0-cb708501-macOS-arm64.zip`; historical ZIP integrity PASS; superseded by the installed `fb1c5935` candidate |

Evidence committed with this report records the isolated native gates; bundle
identity and CQ WW behavior are established separately by receipt reconciliation
and installed-app inspection:

- `docs/contesting/evidence/cq-ww-ssb-cb708501/packaged-native-acceptance.json`
  — SHA-256 `ab0dea76e3725d0fd55dfea05562e225fe0d61317ee21e6e07ecfb818f1cf97f`.
- `docs/contesting/evidence/cq-ww-ssb-cb708501/installed-native-acceptance.json`
  — SHA-256 `c6e9df06c78c6f4f3c1435d6a4da9ba2938d99cea9dd693aeb859cf7a019184a`.
- Final archive SHA-256
  `689e231010e143ad67cb02cad6a090dd3800044ba8b4781af95d2648d5c39521`.

No production QSO was created, edited, deleted or transferred. No spot was
selected, radio setting changed, rotor moved, audio played, PTT asserted or RF
transmitted.

The cross-platform workflow is therefore not reported as green. Its first
attempt demonstrated the complete frontend suite and macOS build/integration
path but timed out in packaging; its cached second attempt exposed one
nondeterministic ARRL DX preview test while all other 4,072 tests passed. The
same ARRL DX file then passed all 5 tests locally. This is not part of the CQ WW
SSB operating workflow and was not used to widen this macOS freeze into another
contest-repair batch. Exact-source CI, both CQ WW macOS portability jobs, the
local signed package, and packaged/installed isolated native gates passed.

## Window-by-window reconciliation

The N1MM comparison uses the supplied 824-page *N1MM Logger+ Documentation*,
especially Available Mults & Qs pp. 267–271, Band Map pp. 272–284, Check Partial
pp. 285–289, Entry pp. 295–305, Info pp. 333–336, Log pp. 342–346,
Multipliers pp. 349–354 and Score p. 367.

| Window | Current CQ WW SSB behavior | Not1MM parity | N1MM manual match | Remaining difference |
| --- | --- | --- | --- | --- |
| Main Logging / Entry | RS + CQ zone, six HF bands, Run/S&P, Enter/ESM, correction/focus, F1–F12 always visible, radio header and compact country/heading/score footer | Strong for CQ WW SSB | Strong functional match to pp. 295–305 | Not pixel-identical; N1MM has a wider shortcut/action surface. Live Flex readback remains operator check. |
| Check Partial / SCP | Log, Master, Telnet and Call History panes; character-difference highlighting; real MASTER.SCP; event-driven stable updates | Strong | Strong functional match to pp. 285–289 | N1MM has additional pane hiding/proportion, yank ordering and reverse-history controls. |
| Log Display | Chronological and partial panes; contest columns; multiplier/points marks; DUPE badge; resizable persistent columns; adaptive rows and paging; inline/full editing and export | Strong CQ WW parity | Strong functional match to pp. 342–346 | N1MM adds drag reorder, richer sorting/bulk/X-QSO tools and exact warning colors. |
| Cluster | Full calls; Band, PTS, CQ, multiplier and comment columns; band filter; Needed Qs + Mults / Mults only; Show worked; fitted rows/paging; click-to-draft/tune path | Strong CQ WW opportunity parity | Strong functional match to Available Mults & Qs pp. 267–271 | N1MM adds more sort combinations, SO2R focus, SNR/sunrise/preferred-spotter and right-click actions. Live tune not exercised. |
| Band Map | Full calls, contest colors, worked hidden by default, band/mode filters, contest phone/CW/data segments, zoom/pan/age controls and click-to-draft/tune path | Strong | Strong CQ WW match to pp. 272–284 | N1MM adds RIT/XIT, programmable radio controls, SO2R maps and broader shortcuts/actions. |
| CQ WW colors | Blue valid QSO; red one multiplier; green double multiplier; gray worked/dupe | Match | Match to Available p. 270 and Band Map p. 275 | User-configurable color themes are broader in N1MM. |
| Contest band plans | Contest-owned phone/CW/data segments drive classification and visible ranges; disabling CW/data leaves phone | Match for requested contest | Match to pp. 275–277 | N1MM interactive per-frequency plan editing is broader. |
| Stats / score | Per-band QSO, PTS, ZN, CTY and claimed score | Strong core match | Core match to Score p. 367 | N1MM offers copy/print and a dedicated visible Rescore button. |
| DXCC / Zone | Separate per-band country and CQ/ITU zone matrices with current-target highlight | Strong core match | Partial match to Multipliers pp. 349–354 | N1MM has richer availability/expected/spotted grids and clickable blocks. |
| Rates | Last hour/10/100, current clock hour and Run/S&P totals/splits | Strong data match | Partial visual match to Info pp. 334–336 | N1MM integrates graphs/goals; xLog uses a dedicated table/text window. |
| Callsign Details | Callsign, Name, Country, QTH, Grid, Continent, ITU zone and CQ zone only | Intentional requested subset | Closest analogue is Info pp. 333–335 | Deliberately not a full N1MM Info window. Missing lookup data shows `—`. |
| Messages | All contest diagnostics centralized; no banners in Main Logging/other operating windows | Intentional xLog policy | Difference from Info/status behavior | Truthful diagnostics remain available only when the operator opens Messages. |
| Setup/dialog routes | Setup, Operator, Station, Configuration, Digital, Macros, Keys, Rover, About and retained service routes | Broad retained route parity | Not a one-window N1MM clone | All-contest and external-service acceptance is intentionally outside this freeze. |
| Rotator / Remote VFO | Separate safely owned windows; opening never selects a provider or moves hardware | Functional, nonblocking | Partial | No final commanded rotor motion or live VFO tune/readback. Rotor is unnecessary for the planned 40 m vertical. |
| Main xLog recovery | `Open xLog Main Window` restores the normal desk while contest windows remain available; logging owners remain exclusive | Safer ownership boundary than upstream | xLog-specific | Module-switch items were source/lifecycle tested, but one accessibility menu snapshot did not enumerate them. |

The expected Contest menu routes were visible in the installed app: Import or
Transfer, Setup, Operator, Station, Configuration, Digital, Macros, Keys, Rover,
Call History, Callsign Details, Group Chat, Main Logging, Stats, Logbook, Band
Map, Cluster, Check Partial, Rates, Score Reporting, Messages, DXCC, Zone,
Rotator, Remote VFO and About.

## Not1MM parity assessment

**CQ WW SSB operational parity is strong.** The original Python/SQLite host owns
the contest rule/plugin behavior. The macOS workflow now provides the windows
and data flow needed for one-operator CQ WW SSB: entry, RS + CQ zone, per-band
country/zone scoring, duplicate handling, SCP, log/edit/export, cluster and Band
Map opportunity semantics, rates/statistics and restart recovery.

**Complete Not1MM parity is not claimed.** Registration or source support for a
broader contest/plugin catalog does not prove every contest, every window and
every upstream interaction in an installed app. Multi-Mac live reconciliation,
external digital applications, all macro/CAT syntax, scoreboard service use and
recorded-voice hardware behavior remain separate scopes.

## N1MM Logger+ manual assessment

The supplied manual confirms that the implementation follows the important CQ
WW operating semantics:

- Available/spot colors are green double multiplier, red single multiplier and
  blue valid QSO (p. 270); Band Map adds gray dupe (p. 275).
- Band Map sub-band limits determine mode classification and should vary by
  contest (pp. 275–277); the xLog contest band-plan owner supplies those
  phone/CW/data segments.
- The Check window is pane-based and supports Log, Master, Telnet and Call
  History data (p. 288); xLog implements those four requested panes and clean
  responsive distribution, without every right-click/yank option.
- The Entry footer separates country/zone information, QSO/multiplier totals and
  score (p. 300); xLog now uses the same information hierarchy without putting
  diagnostics or optional-voice warnings there.
- The Log marks multipliers and supports editing (p. 343); xLog additionally
  rescales and republishes authoritative score state after supported edits.
- N1MM's Multipliers window is substantially richer (p. 350). xLog has useful
  DXCC/Zone matrices but is still partial here.
- The Score window is a contest-formatted band/QSO/point/multiplier summary
  (p. 367); xLog's CQ WW Stats provides the corresponding core data.

The correct wording is therefore **strong functional match for CQ WW SSB**, not
an exact N1MM clone.

## What remains to finish

### Minimal operator-controlled check before the contest

1. Connect the intended Flex.
2. Confirm that Main Logging shows the authoritative current frequency, `40 m`
   band and `SSB` mode.
3. Optionally select one known safe Cluster/Band Map spot and verify that the
   intended radio alone changes to its frequency/mode. This requires an explicit
   operator action and was intentionally not performed during acceptance.

### Optional or deferred, not blockers for manual-microphone logging

- Record and validate F1–F12 WAV files, select/verify output routing, then test
  PTT and actual transmitter audio/RF as four separate operator-controlled
  results. Macro substitution alone is already tested.
- Public notarization/stapling if this local candidate is to be distributed.
- Credentialed real-time scoreboard posting.
- Simultaneous two-Mac multi-operator logging/chat/reconciliation.
- Rich N1MM multiplier availability charts, rate graphs, advanced column
  reorder/sort/bulk log tools, SO2R/SO2V behavior and broader right-click menus.
- Windows/Linux package and installed-app acceptance. Exact-source portability
  run `39918699201` passed both macOS jobs, both Ubuntu jobs, the Windows broad
  contest job and definition generator. Its Windows native job failed only in
  `persisted_selection_binds_the_next_worker_generation_after_restart` because
  syncing the operating-module preference directory returned Windows error 5,
  `Access is denied`; this macOS freeze does not call Windows passed.
- Broad installed acceptance across every registered Not1MM contest/plugin.

No further parity or feature batch should begin until the operator reviews this
report and supplies the next priorities.

## Rollback

The retained signed rollback is
`/Applications/OM0RX-xLog-previous-20261024T041656Z-59790.app` from source
`8f89e860e3839803b2d359894bec225bc96f75a0`. The final installed candidate and
rollback both pass deep/strict signature verification. Logbook and installation
backup directories were retained and were not part of cleanup.

## 25 October: Log Review source acceptance, installation deferred

Feature source `0b468867aa3740a9f7ac6d0ecfddd0ebfb5bfc11` is committed and pushed
to canonical `main`. This adds **Contest → Log Review**, using the existing
separate received-spot archive, local CTY, cached Club Log country data and cached
LoTW exact-call activity membership. See [guide](CONTEST_LOG_REVIEW.md).

Validation: 65 frontend tests, 10 Swift tests (including actual LiveWorker routing
with disposable reference/logbook state), and 2 native tests passed. TypeScript,
Vite production build and bundle graph checks passed. Browser rehearsal exercised
the real comparison worker, typo/country-zone suggestions, raw evidence, persistent
review decisions and narrow layout. Independent review findings were corrected.
No production contacts, settings or radio state were changed for these checks.

**Source ready for integration; installed acceptance pending.** This work did not
bump a version, package, sign, install or relaunch the application. The previously
accepted 1.3.12 installation is not replaced by this source commit. Coordination
with the operator's separate “Create contest analytics” task reserves one combined
versioned release; that task must verify the installed Log Review menu, native IPC,
actual packaged Python log reads, report copying and existing correction workflow
using disposable data. No installed acceptance of Log Review is claimed here.

Review runs only on demand; no missing spot or absent LoTW membership is proof of
an invalid contact. Source freshness/availability, archive gaps and acquisition
limits are visible. Club Log membership and SCP membership checks are not included.
Review never automatically corrects QSOs. Existing production backup and rollback
locations are unchanged by this source-only addition.
