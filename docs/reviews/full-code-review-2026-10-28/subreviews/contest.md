# Contest subsystem review — 28 October 2026

Reviewed source: `main`, `4bd554a25951ddc995b4bef1715d3df12918a07b`. Review only; no application/test/configuration changes. This is an **incomplete manual review** of the assigned 278 tracked files; the exact per-file ledger is `coverage.json`.

## Findings

### CONTEST-01 — Enter/ESM commits do not receive Recorder bookmarks

Severity **Medium**: ordinary contest logging loses the automatic QSO-to-recording association; recordings and QSOs themselves are retained. Confidence **high**. Verification **reproduced host classification; Rust consumer established by static analysis**. No physical recording/device test was performed.

Locations:

- `/Users/oliver/Documents/Projects/OM0RX-xLog/python/contest_host/recorder.py:28`, `changes`.
- `/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src-tauri/src/contest_recorder.rs:88`, `admission`.
- `/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src-tauri/src/contest_recorder_store.rs:682`, `reconcile` (cursor advances at line 727).

Trigger: run the contest recorder and log through the normal Enter/ESM operation (including when ESM is disabled and Enter simply logs), instead of the explicit `qso_commit` method. `Host.mutate` lets `esm` and `function_key` call the actual commit owner, but the audit projection only marks `qso_commit`, `digital_ingest`, `qso_correct`, and `qso_delete` local. A genuine local `esm` commit therefore has `kind=commit,local=false`. Rust only creates a new automatic bookmark for `kind=commit && local=true`, and advances its durable sequence past the skipped event. The admission-marker hook also recognizes only `contest_qso_commit`.

Isolated reproduction:

```sh
python3.12 -B /tmp/xlog-review-20261028-4bd554a/contest/repro_recorder_esm.py
```

The real host, using the existing disposable CQWW SSB fixture, commits K1ABC through ESM and DL1ABC through `qso_commit`. Its `recorder_changes` page classifies the first `local=false` and the second `local=true`; both are `kind=commit`. Evidence: `repro_recorder_esm.json`. The fixture emits output intents only; it does not execute any station action.

Safeguards challenged: recorder observes all contest operations, but `confirmed` reconciliation cannot override a false local flag; receipt retry/catch-up sees the same classification and the cursor has already advanced. Existing `python/tests/test_recorder.py` tests only the fixture's direct `qso_commit` logging helper. Existing ESM tests separately prove that ESM commits contacts, but do not assert recorder classification. Remote/replica/import exclusions remain necessary.

Recommendation: derive local commit provenance from the complete set of admitted local logging paths or explicit commit-origin evidence, and collect the corresponding admission markers. Preserve remote/import/replica exclusions. Add enabled/disabled ESM and `{LOGIT}` macro recording regressions covering idempotent retry, cursor catch-up and original admission time. Native fake-audio tests should assert a bookmark exists for the actual operation, without requiring hardware.

### CONTEST-02 — WAE extracts the prefix's digit as the numerical call area

Severity **Medium**: ordinary qualifying calls can inflate or suppress multiplier/claimed-score totals, while reporting `scoringComplete=true`; affects WAE CW/SSB/RTTY and exports that share this score owner. Confidence **high**. Verification **reproduced** with real host and exact pinned sponsor source.

Location: `/Users/oliver/Documents/Projects/OM0RX-xLog/python/contest_host/wae.py:40`, `multiplier` (lines 40–46).

`re.search(r"\d", Call)` selects the first digit anywhere in the callsign. For Japanese `7K4`/`7M4` calls it selects 7 from the national prefix instead of numerical area 4. The exact retained official DARC source explicitly gives JR4, 7M4 and 7K4 as equivalent JA4 multipliers. This is the contest's numerical-area rule, regardless of the station's geographical region; do not substitute geographical JA district inference.

Isolated reproduction:

```sh
python3.12 -B /tmp/xlog-review-20261028-4bd554a/contest/repro_wae_call_area.py
```

Three real-host synthetic QSOs on 20m (JR4AAA, 7K4ABC, 7M4XYZ), all with authoritative Japan country records, produce keys JA4, JA7, JA7. Actual: 3 points × 4 weighted multipliers = **12**, `scoringComplete=true`; expected: 3 points × 2 weighted multipliers = **6**. Evidence: `repro_wae_call_area.json`.

Authority: `docs/contesting/WAE_2026_RULE_REFERENCE.json` identifies DARC edition 2025-06-17 / 2026 events. Retained `.build/wave5/rules/darc-wae-rules.html` independently hashed in this run to exactly `9693e5e843a6bfb054deafe2004d55384c0224a764816c66248f5f13e54c668c`, matching the tracked reference. Its section 6 explicitly includes the JR4/7M4/7K4 example. Live retrieval of the official page on this run returned HTTP 403; the finding uses hash-verified retained official evidence rather than asserting a newly retrieved 2026 source. [Official rules](https://www.darc.de/der-club/referate/conteste/wae-dx-contest/en/wae-rules/). Historical official DARC rule PDFs also retain this example, e.g. [2016 results and rules](https://www.darc.de/fileadmin/filemounts/referate/conteste/contest/waedc/results/heft_erg_2016.pdf).

Safeguards challenged: country resolution is present and correct; the function's explicit `/digit` portable override only helps calls that carry it. The 97-profile checker passes because its WAE seed uses K1ABC. Existing WAE tests cover that seed, QTC accounting, modes and duplicate behavior, not digit-bearing national prefixes. The error is in the score authority, not only a display label. Existing PACC's separate `pacc_multiplier_key` already uses a different extraction strategy, but should not be reused blindly across different sponsor rules.

Recommendation: use an explicit validated country/numerical-area extraction policy, preserving portable overrides and sponsor exceptions. Introduce a compatibility/version decision for existing WAE sessions before rescoring. Add JR4/7K4/7M4 equivalence plus distinct-area, portable, no-usable-area, correction, restart, and actual Cabrillo claimed-score tests for all three WAE modes.

### CONTEST-03 — Shared serial allocation ignores imported historical serials

Severity **Medium**: a peer receives an authoritative reservation for a number already present in the log, and its eventual QSO cannot be committed under that reservation. Confidence **high**. Verification **reproduced** through the real host APIs. Physical output/transmission was not performed.

Locations:

- `/Users/oliver/Documents/Projects/OM0RX-xLog/python/contest_host/store.py:382`, `reserve_shared_serial` (lines 382–387).
- `/Users/oliver/Documents/Projects/OM0RX-xLog/python/contest_host/host.py:2121`, `coordinate` shared allocation call; `reserve_serial` correctly accounts for the floor at line 3658.
- `/Users/oliver/Documents/Projects/OM0RX-xLog/python/contest_host/adif_import.py:128`, `apply` records `historicalSerialFloor` without creating reservations for imported rows.

Trigger: import a WPX historical ADIF QSO whose sent serial is 2 into a fresh session (whose original local draft retains reservation 1); request a new `multi_serial_reserve`. The shared allocator only takes `max(xlog_serial.serial)+1`, so it grants serial **2**, `sentExchange=002`, despite `DXLOG.SentNr=2` and `historicalSerialFloor=2`. A remote `multi_contact_apply` using this grant subsequently fails `historical_serial_conflict`. A working reservation should start above the imported floor, while preserving already issued drafts/receipts for explicit reconciliation.

Reproduction:

```sh
python3.12 -B /tmp/xlog-review-20261028-4bd554a/contest/repro_import_shared_serial.py
```

Evidence: `repro_import_shared_serial.json` contains the successful authoritative reservation and exact commit rejection. The late commit guard is effective at preventing a duplicate persisted QSO; it does not repair an invalid number already handed to the caller. A source search confirmed the historical floor is only consulted by local allocation and the commit guard. Rust `contest_group_replica.rs:204` copies the correlated authority grant, and Python `validate_replica_reservation` validates identity/scope/format without checking historical serial ownership. The separate import/replication mismatch in CONTEST-04 bounds any claim that a native peer actually transmitted this value; no native peer or RF test occurred.

Recommendation: share the imported-history-aware allocation policy between local and multi-operator authorities inside the existing transaction. Preserve existing reservation receipts and do not silently change a number that may already have been sent. Add import → shared allocation → receipt retry/restart → remote commit coverage, including scoped serial contests and concurrent allocators. Assert that newly issued shared serials cannot collide with imported historical values.

### CONTEST-04 — Master-side ADIF imports emit changes the replica rejects

Severity **Medium**: importing a supported historical contact into the authority log prevents another station from catching up through the ordinary change stream. Data is retained and the replica fails closed. Confidence **high** for the contract failure. Verification **reproduced** using independent synthetic master/replica sessions through the actual Python API; native peer transport was not exercised.

Locations:

- `/Users/oliver/Documents/Projects/OM0RX-xLog/python/contest_host/adif_import.py:131`, `apply` audits the new contact with kind `adif_import` and without `after_identity`.
- `/Users/oliver/Documents/Projects/OM0RX-xLog/python/contest_host/host.py:2190`, `coordinate` forwards the stored audit kind and identity images unchanged.
- `/Users/oliver/Documents/Projects/OM0RX-xLog/python/contest_host/host.py:2358`, `apply_replica` only permits `commit`, `correct`, `delete`; line 2372 additionally requires a durable after-identity.

Reproduction:

```sh
python3.12 -B /tmp/xlog-review-20261028-4bd554a/contest/repro_import_replica.py
```

A real WPX authority session imports one supported ADIF contact, then returns it from `multi_changes` as `kind=adif_import,afterIdentity=null`. A newly created replica with exactly matching station/settings/reference receives that exact page and fails `invalid_request: Replica change kind is invalid`; master retains one contact, replica retains zero. Evidence: `repro_import_replica.json`. Accepting the new kind alone would still fail the missing identity guard, so the import producer must publish a complete portable image.

Safeguards challenged: blocking imports on a bound replica is intentional and does not prevent a master-side import. No explicit documented rule was found that prohibits master-side historical import while group support is configured. Strict consecutive audit sequence checks are necessary; silently skipping the unsupported audit would lose authoritative contacts and must not be used as a fix. Parent should retain this as an explicit integration gap if the intended product scope excludes imported master logs, rather than claiming that workflow passes.

Recommendation: publish supported imports as complete replica-compatible contact mutations with immutable source provenance and no replayed output, or reject unsupported master-side imports before mutation with a clear supported-workflow restriction. Add master import → complete change paging → independent replica catch-up → correction/delete/restart tests. Preserve import-specific data lineage even if the wire operation is normalized to a contact commit.

## Architecture and boundaries examined

- The Python JSONL host owns active contest sessions, a finite registry of **97 definitions** (94 pinned Not1MM plugins plus three first-party WAE definitions), plugin callbacks, serialized mutations, operation receipts, drafts/lanes, serials and score/export semantics. It executes hash-checked pinned sources through finite overlays; there is no arbitrary downloaded-plugin install path in the reviewed loader.
- Each Python session has a SQLite DB. `BEGIN IMMEDIATE`, `synchronous=FULL`, identity indexes, revision fences, audit images, serial reservations and durable operation receipts form the mutation boundary. Output actions are intents and are suppressed on replay; optional UDP output journals uncertainty independently of contact commits.
- Local read models include bounded assistance/log queries, analytical copies, QTC journals, VHF site provenance, reminders, notes, and submission archives. Legacy import reads the source DB read-only, hashes logical committed rows including WAL-visible content, and creates receipt-backed target rows. Historical ADIF import reuses validation/rebuild and retains source bytes/metadata.
- Swift `XContestCore` and `XContestStore` retain separate historical/declarative contest facilities. All three store source files were manually inspected, including session/draft validation, serial reservation/transitions, rollback/replay, coherent read snapshots, correction/deletion, schema v1/v2/v3 migrations, canonical definition persistence, SQLite bind/step errors, snapshot schema/object/index/foreign-key inspection, cancellation/deadlines, no-replace publication, identity-pinned cleanup and macOS/Linux/Windows source branches. Most Swift rule implementations remain manually unreviewed by this subtask. Parent owns Swift test validation; Windows/Linux behavior remains unexecuted.
- Rust Recorder consumes Python committed-audit pages; this exact cross-component path was traced for CONTEST-01. Other Rust/UI work belongs to the other bounded review agents.

## Validation

1. `PYTHONPATH=python python3.12 -B -m unittest discover -s python/tests -v` — **PASS**, 537 tests in 239.907 seconds. Exact output: `python-tests.log`. Interpreter: `/opt/local/bin/python3.12`.
2. `python3.12 -B tools/check_all_contests_readiness.py --output /tmp/xlog-review-20261028-4bd554a/contest/all-contests-readiness.json` — **PASS**, all **97** current registry definitions; 1,353 PASS and 5 NOT APPLICABLE check records, zero failed/unverified records. `--family-tests` was deliberately omitted because the separate full unittest run already passed. Exact output: `all-contests-readiness.log`; full per-definition results and source digests: `all-contests-readiness.json`.
3. All four isolated scripts above — exit 0 with assertions reproducing the defects. They use only disposable synthetic data and actual host functions. Shared serial/import-replica scripts were added during the extended store/boundary pass; the already passing suites were not repeated because no application source changed.
4. Pinned WAE source hash verification — exact match described above.
5. `git status --short --branch` after all scripts — no changes from this subtask; root review reports are being authored separately by parent.

The catalog checker establishes bounded fixture lifecycle consistency, **not** complete current sponsor-rule, installed-app, physical RF, organizer-submission, real-world category or provider acceptance. The two reproduced defects survive the passing suites.

## Coverage, exclusions and remaining work

`coverage.json` records all 278 assigned tracked files: **29 fully reviewed, 13 partially reviewed, 14 scanned only, 222 not reviewed**. The extended pass completed all three Swift store source files, persistence contracts and the inactive ARRL VHF definition source; reviewed selected migration/concurrency/rollback assertions in three Swift store suites; and traced shared serial, imported history and replica contracts. Many unreviewed files are test/reference/fixture resources; execution of every Python test does not count as manual source review. No full manual coverage claim is made. `validation-summary.json` summarizes current run results.

Pinned vendor code is excluded from routine manual inspection, but its manifest/provenance/overlay boundary and runtime verification were examined; the registry/tests execute the pinned code. The separate upstream `contest-sw` repository was not cloned, fetched or modified by this subtask. Original generator corpus validation against that checkout, Python 3.14 fingerprint equivalence, Windows/Linux runtime behavior, installed native UI, devices, real transports, RF, microphone/audio playback, organizer upload, category/rule certification and credential-dependent behavior remain unverified. Runtime generated/build files were excluded except the specific retained official rule source used to validate CONTEST-02.

Exact remaining work: finish unexamined sections of `host.py` (especially all exchange validators and session/setup checks), `upstream.py` overlays, `multipliers.py`, analytics/models and message/strategy tail paths; inspect every remaining Swift contest rule/export/resource loader; manually inspect remaining Python/Swift/generator test assertions and external-corpus tooling; add broader current sponsor/category oracles beyond the finite lifecycle seeds. The replica application/authority/serial code received the extended manual pass, but exhaustive protocol fuzzing and two-host transport acceptance remain outstanding. Follow the per-file status ledger instead of treating test passage as completed review.

Extended false-positive challenge: Swift store mutations consistently put replay checks before revision validation and keep aggregate writes, receipts, serial state and audits in one SQLite transaction. Existing tests explicitly inspect rollback after injected failures, concurrent revision fences, migration rollback and exact old-receipt replay; no new Swift store defect is asserted from those paths. The snapshotter's existing schema/index/object checks reject injected triggers/views/index changes, and identity-pinned cleanup guards replacement directories; source inspection alone does not establish hardware power-loss durability. `ContestDatabaseSnapshotter` has no application call sites outside its own file in the searched `Sources` tree, so its existence is not proof that current production Python contest backups are integrated. A separate inactive Swift ARRL VHF preview advertises >100 GHz bands while the legacy store/lane cap at 100 GHz; this is recorded as a future activation compatibility gap, not a current live-Python logging failure.

## Remediation order and maintainability

1. Repair CONTEST-03 before newly issuing peer serials from imported logs; audit existing granted reservations without rewriting potentially sent values.
2. Resolve CONTEST-04 before claiming imported authority logs can participate in group catch-up; the shared-serial fix alone does not establish that workflow.
3. Repair CONTEST-01 across Python provenance and Rust admission/reconciliation with a cross-component regression.
4. Repair CONTEST-02 with an explicit WAE definition-compatibility decision, independent numerical-area fixtures and claimed-score export assertions before choosing whether existing sessions are migrated.
5. Continue the documented manual coverage gaps. Separate optional maintainability work: split the large Python dispatch/mutation/exchange switches only after behavior-preserving contract tests exist; complexity alone is not reported as a defect.
