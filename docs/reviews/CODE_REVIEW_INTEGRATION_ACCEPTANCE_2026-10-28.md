# Critical-path integrity integration — 28 October 2026

## Scope and disposition

PR [#1](https://github.com/oliverbross/OM0RX-xLog/pull/1), branch `codex/review-integrity-fixes-20261028`, began at `f386abcdfd96525d6d09c05dc638a2faf6635763` over canonical `b30dc62e5092e4e77431f05516df7aa68df2ba6c`. Main was clean, fetched and fast-forward checked. The seven existing patches were reviewed and retained. Source/test follow-up through `775e5292b30eff1bcc2dee8692d87d665b15323d` is pushed. **Merge and signed candidate remain pending the final integrated CI gate.** This paragraph is updated when those operations complete.

Installed **1.3.58**, application source `1225274b4c0f5890a03ceb63159cd5577bc32b57`, is unchanged. No production log, historical exchange, recording, setting, backup, recovery ref or retained CW worktree was reset or migrated. No provider, station, RF/PTT, rotor or audio operation was performed. Existing Wave 1–5 evidence and qualification limits remain in force.

## Corrections and review

| Finding | Completed bounded change and evidence |
| --- | --- |
| R01 | Exact positive ASCII string-serial fallback, with dedicated malformed values still rejected. Actual Host import → prepared ADIF bytes → fresh-session import passes for WPX CW/SSB/RTTY and DARC/NAC/TA serial-grid definitions. IDs, actual serials, mode, pending draft and serial ledger are checked; repeat import remains one contact. The additional row adapter in `5e4ed2db` supplies the serial-grid writers' missing received grid and canonical contest ID, preserving sent locator and immutable source. Vendor sources remain pinned. |
| R02 | Historical `BOB SK` survives real Host rebuild/Cabrillo despite current `OLIVER SK`. The actual native Swift/Python chain produces `QSO: 14025 CW 2026-10-21 1000 OM0RX         BOB SK K1ABC         ALICE       MA`. Current setup and pending draft are preserved. |
| R03 | Real React/jsdom deferred-file tests pass, including Apply retaining its own busy lifetime. In the native WebView, a 10,000-record read-only review was visibly busy at 32/10,000; an ordinary detached Main Logging draft edit advanced revision 3 → 6, retired the obsolete review and re-enabled file selection. No batch contacts were applied. This native case exercises preview-read invalidation; deferred `File.arrayBuffer` completion is deterministic Vitest evidence. |
| R04 | Writer accounts for `manifest.json` within the unchanged 32 MiB expanded bound. A new test executes the actual 32 MiB limit without patching it; exact-bound and valid reopen controls also pass. Native generated-load preflight rejects the oversized immutable snapshot, preserves the 300,105-byte reviewed Cabrillo export, and leaves the previously saved ZIP unchanged. |
| R05/R06 | Four actual XLogCore XCTest cases cover invalid lengths/non-ASCII/time/leap-date input, UTC midnight/year rollover, explicit end dates and nonmutating legacy backfill. The native worker reports a record-level issue for `TIME_ON=12`; the valid 31 December midnight contact exports `QSO_DATE_OFF=20270101`. No existing record is normalized. |
| R07 | Actual historical import and original digital handler completion → contact correction → prepared ADIF tests inspect current operator/RX, mode/submode/sent serial, original packet, contact identity and frozen prior bytes. Native-chain historical correction exports `NEWOP`/14.050000, then RX clear removes the standard tag while original packet remains. Empty operator correction remains rejected atomically; digital `FREQ_RX` packets remain unsupported at current Host admission. Array/module empty-value controls do not claim a newly admitted engine capability. |
| R08 | `d5b52ec4`: actual independent master/replica Host roots bind through `multi_changes`/`multi_replica_apply`. The prior source failed nine assertions. The per-action guard now rejects import, QTC and site/mapping semantics without any durable changes on either host. Local reminders/plans/beacon observations and valid receipt replay remain available; payload conflict semantics and all 14 existing multi-operator tests pass. |

The review traced mutation admission, revision/operation identity, rollback, serial reservation, pinned writer ordering, length-framed tag removal and immutable export lifetimes. No alternative engine, generalized importer, automatic historical repair or authority protocol was introduced.

## Repository gates

Supported local runtime: macOS 27.0.1 arm64, Apple Swift 6.4, CPython **3.12.4** (`/opt/local/bin/python3.12`), current repository Node/npm/Vitest 5.0.3. Native development uses the unchanged retained 1.3.58 Python 3.12.4 framework and fresh canonical Swift worker.

| Gate | Actual result |
| --- | --- |
| Python repository discovery | **536 passed**, then the additional actual-limit archive regression and its three existing controls passed. Discovery counts include reused/imported fixture classes; they are not a count of unique independent scenarios. |
| Full frontend `npm test` | **4,705 Vitest cases / 337 files passed**, plus the repository Node pretest. |
| Frontend build | TypeScript, Vite and window-bundle checks passed; existing chunk-size warning retained. |
| XLogCore timestamp review | **4 XCTest cases passed** in the real module. |
| Full portable Swift `--no-parallel` | **1,161 XCTest cases, six intentional skips, zero failures**, and **532 Swift Testing cases passed** across their test targets. This final full run followed the retirement/TCI fixture fixes. The later IQ sender fixture change separately passed all nine affected XCTest cases. |
| Paired authority and related multi-op | **3 new paired-Host tests** and **14 existing multi-operator tests passed**. These overlap Python discovery and are not additive coverage. |
| Archive shipping limit | **4 direct production-module regressions passed**, including actual 32 MiB manifest overflow. |

Raw logs, harnesses and frozen native bytes are retained under `.build/review-integrity-evidence/`; the marked native fixture is `/private/tmp/xlog-wave1-review-lpbdfz6f`, WebKit UUID `50bd3604-4a86-4452-99d6-1e94cc1e9ccc`. Failed seed/large-ADIF attempts are retained rather than relabelled as passes. The generated ADIF workload hit its bounded 60-second harness deadline; the subsequent native size rejection uses the separately recorded generated Cabrillo fixture, not a claim that that ADIF workload passed.

## Integrated CI diagnosis

Baseline run [40607030254](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40607030254), job `122548971919`, and original repair run [40622657933](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40622657933), job `122600125008`, were read rather than blindly retried. They contain five FLEX IQ loopback XCTest failures, two missing-Python-3.12 catalogue failures and three Swift Testing issues in DX feed startup/cluster retirement.

- CI installed Python after the native tests. `44ac7f91` moves supported 3.12.4 before them and binds the exact setup-python executable. The later qualified run no longer has those catalogue failures.
- Full local reproduction exposed the retirement assertion race: 40 ms did not prove the shutdown task had reached its cluster drain. The test now waits for the real injected drain callback. CI explicitly uses `--no-parallel`; no production timeout, freshness, capacity or safety admission changed.
- A subsequent local full run exposed a TCI fake transport test checking after a fixed number of scheduler yields. `20e13ed9` observes the actual fake send before supplying readback. The real receive-only command/readback assertions remain.
- Qualified remote run [40629567971](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40629567971), job `122622527842`, narrowed the remaining failure to five IQ loopback cases. All nine passed locally. The fixture had ignored UDP readiness/send errors and failed to clean up after thrown acquisition, permitting a cascade at fixed source port 4991. `775e5292` adds a synchronously bound loopback UDP socket, checked bind/send and guaranteed teardown. Its remote run [40631272265](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40631272265) still failed those cases without bind/send errors, so that change alone was explicitly insufficient.
- The early isolated diagnostic run [40632709037](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40632709037), job `122632559357`, proves packets reach the correct `127.0.0.1:4991` receiver, with valid stream/rate/receive metadata. Its 500 ms snapshots show only roughly 10–18 new datagrams, `lastReceipt` advancing and `cleanAfter` repeatedly reset to about `lastReceipt + 500 ms`, with capture/admission false. The fixture's coalesced `Task.sleep(10 ms)` sender is too slow/irregular for the unchanged three-packet continuity ceiling: 1,024 samples / 96,000 Hz × 3 = **32 ms**. `03d1b673` supplies the actual advertised 10.667 ms cadence with a strict dispatch timer and high-priority fixture emission. All nine affected local cases pass. Temporary DEBUG logging in the production receiver was removed; final production IQ/radio source is byte-identical to main. No continuity, freshness, timeout, capacity or feature gate was relaxed. Remote validation of the strict-timer correction remains required.

The final relevant run must exercise `03d1b673` or a later equivalent executable/test source; its result must be recorded before merge. Superseded runs were cancelled once their replacement source was pushed. Packaging is now explicit workflow-dispatch work, so a PR/main test run cannot silently mint a different package under installed version 1.3.58.

## Isolated native bytes and preservation

This is an unpackaged development executable, **not** a signed application candidate. Its exact path is `.build/review-integrity-native-dev/Contents/MacOS/XLog-Review-Development`; `DEVELOPMENT_ONLY.json` records provenance. The exact path was bound before input. The initial main-window title contained the verified WebKit UUID. Both worker health and UI reported external services/station I/O disabled. No connected-loopback exception was enabled.

Native file selection, reviewed serial import, real Apply, submission preflight, Save and read-only reopen passed. Native ZIP **5,071 bytes**, SHA-256 **`1cc3dbc918c5b172c5451b3da6d00ee59e0b7c7d6edaa0306eec333579818a98`**; its nine listed payload members independently match length/digest. Its **1,267-byte ADIF** matches SHA-256 **`2c824eef9286d5ff01749fc1d89677d50ce9f47d8d82ae4a66ab2b12244bdf90`**. Submission remains false, restoration false and no audio included.

Original pending draft `a9c49ca9-1c42-4429-825a-8811a53f7098`, serial **1**, `DL1ABC / 314` survived import. The deliberate read-invalidation edit changed only the disposable received field to **315**; ordinary Quit/reopen preserved it. The historical imported QSO keeps ID `6097984f-d8b5-5fb8-a9a8-9d02acd5fd28` and actual serial **101**. The 3,700-row archive workload is explicitly synthetic copied-row load, not scoring/performance certification. It rejected the unchanged 32 MiB bound and kept prepared export SHA-256 `e5002504ab6b8a6f092ae68e5d46da3e63bb6deefab35c91bda261a045604ef4` readable.

Both GUI runs used ordinary Command-Q. Process-only inventory confirmed the exact executable absent before re-binding/reopening; no force-quit or unsaved-work bypass occurred. lean-ctx denied sourcing the process helper, so the recorded process-only `ps` check was used; this did not trigger an app observation/relaunch.

## Owners, candidate and retained limits

W08/NL-23 own import/timestamp/archive fidelity; W15/NL-28 own paired-host authority; W20 owns corrected ADIF versus immutable external packets; W24/NL-25 own finite native/byte/CI evidence. Their existing broader statuses and Wave 1–5 acceptance are retained in the master plan.

**1.3.59 is reserved for one signed candidate after the reviewed merge.** Packaging must use clean canonical main, record its exact commit/source trees/components, retain Developer ID/deep-strict verification and candidate digest, and perform bounded bundled checks. No automatic installation is authorized. This is a reservation, not a completed build or signing claim.

Real engine/provider outcomes, RF/PTT/rotor/audio, CW capacity/quality, two-machine topology, Dock/OS shutdown, notarization/clean-machine/Intel/Windows/Linux qualification, complete recording-media backup, unsupported import families, historical Clear attribution and existing AADX/SST/CQWS/PWT gaps remain outside this correction batch. Empty operator and unadmitted digital RX fields are not enabled. No rescore or migration is authorized.
