# OM0RX-xLog — critical-path code review and repair batch

**Review date:** 28 October 2026. **Baseline:** `b30dc62e5092e4e77431f05516df7aa68df2ba6c`. **Installed executable recorded by the project:** 1.3.58 / `1225274b4c0f5890a03ceb63159cd5577bc32b57`.

**Disposition: draft repair branch, not release acceptance.** Seven concrete behaviors have narrowly scoped source corrections and before/after isolated checks. One additional authority-boundary concern remains open and needs a real Host regression before release. No main-branch merge, build, signing, installation, production-data change or station action was performed by this review.

## Executive assessment

The existing architecture should be preserved. Most findings are disagreements between already-existing layers: the importer's field contract and its exporter; historical exchanges and current setup; current corrected contact values and immutable original packets; the archive writer and its reader; asynchronous read invalidation and UI busy state. They do not justify replacing the Python contest engine, native owners, persistence model or UI.

The defects are not proof that Oliver's completed CQ WW log was damaged. Production logs were neither inspected nor altered. The repair branch changes future import, presentation and export behavior. It does not automatically correct or rescore historical records.

## Coverage and limits

Inspected critical paths include normal-log ADIF/model conversion, Wavelog client mappings, historical contest imports, Python Host mutation/rebuild/export dispatch, lane/serial attribution and digital enrichment, submission archives, strategy/reminder/coordination/VHF/rules/rates code, retained-note/submission/import UI, native capability/configuration declarations, selected original plugins and current repository tests/workflows.

This is a broad source review of those paths, not a claim that every line of every module was audited. The remote Mac was offline. No full repository clone/dependency graph was available in the isolated runtime, so no complete macOS application, Rust/native suite, full Python Host suite, React/Vitest suite, 97-definition acceptance, hardware/engine/account test, long soak or installed window inspection was performed. Existing acceptance records are historical evidence, not fresh results of this review.

For the five production files patched, downloaded source bytes were checked against their Git blob identities before local tests. The GitHub repair blobs match the tested local bytes. Reproduction scripts and raw before/after output are in the accompanying download package.

### Evidence vocabulary

- **Reproduced boundary defect:** the exact production function/component source was executed in an isolated harness and exhibited the incorrect result. Harness substitutions are described below.
- **Source-confirmed policy concern:** the relevant admission and dispatch omission was traced, but no complete runtime scenario was executed.
- **Prepared integration regression:** test authored for the repository's existing harness; not falsely counted as locally executed if that harness was unavailable.
- **P1:** data fidelity or authority correctness. **P2:** bounded usability/size-boundary defect. These priorities do not imply every operator is currently affected.

## Findings and repairs

### R01 — serial import rejects the writer's string-valued serial fields — P1

**Locations:** `python/contest_host/adif_import.py::review/apply`; pinned `python/vendor/not1mm/upstream/not1mm/lib/plugin_common.py::gen_adif`.

The serial and serial-grid mappings require `STX`/`SRX`. The existing generic contest writer emits actual serials as `STX_STRING`/`SRX_STRING`. Consequently, a suitable WPX record carrying the application's string-valued exchange fields can fail before import with “missing STX”, even though its serials are explicit and unambiguous.

**Reproduction:** reviewed record with `STX_STRING=0101`, `SRX_STRING=0202`, no STX/SRX, valid WPX metadata. Baseline mapper rejects; patched mapper stores sent 101 / received 202 and advances the historical floor to 101. Repeating the same record remains idempotent; the current draft remains unchanged.

**Repair:** prefer a present dedicated numeric field; when absent only, accept the corresponding string field if the entire value is an ASCII positive integer within the existing sent/received bounds. Never extract a number from a compound exchange or fall back from an explicitly malformed dedicated field. Use the normalized reviewed sent value for the row and historical floor rather than indexing raw STX again.

**Acceptance still required:** real bundled Host import/export/import for CW/SSB/RTTY serial and serial-grid families, no new serial reservation during import, preserved pending draft and repeat-import identity. Dedicated invalid numeric values must still be rejected. The supplied real-Host test exercises WPX; extend existing fixtures for the other admitted families, rather than building another importer.

### R02 — historical NAQP sent exchange is replaced by current setup — P1

**Locations:** `adif_import.py::apply`; pinned `plugins/naqp_cw.py::set_contact_vars/cabrillo`; Host rebuild path.

The importer requires the actual `STX_STRING`, but the pinned setter fills `SentNr` from the current session's `SentExchange`. The importer did not replace that derived value with the historical exchange. The original string survived in provenance but not in the authoritative row used by Cabrillo.

**Reproduction:** current setup `OLIVER SK`; historical record `STX_STRING=BOB SK`, received ALICE/MA. Baseline stores OLIVER SK; patch stores BOB SK while retaining current setup and draft unchanged. The exact pinned NAQP setter body was used in the isolated mapping harness. The source Cabrillo writer consumes row SentNr directly.

**Repair:** for reviewed name/location imports, store the required historical STX_STRING in row SentNr before existing persistence/rebuild. No current setup edit, new exchange inference, or re-score migration.

**Acceptance still required:** run the supplied full-Host regression and inspect actual Cabrillo QSO lines, including the original sent name/location, not merely raw import JSON. Test both current and historical exchanges deliberately different.

### R03 — import UI can remain permanently busy after an invalidated read — P2

**Location:** `prototype/src/contesting/ContestHistoricalImport.tsx`.

A host revision/session change invalidates the operation ticket. The old asynchronous `finally` correctly refuses to update a newer ticket, but no other path clears its `working` state. File selection and review can therefore remain disabled after the read has become obsolete.

**Reproduction:** start a deferred file read, advance host revision or session, resolve the old read. Baseline stays busy; patch returns the current view to idle and ignores the stale result. A control verifies that a real Apply remains busy while its own commits advance the revision.

**Repair:** retire the busy/progress state when invalidating reads, only while no Apply owns that lifetime. No change to existing mutation receipts, revision admission or partial-import semantics.

**Acceptance still required:** run the supplied real React/Vitest cases and use the installed import screen while an ordinary metadata/draft revision changes. Confirm actual Apply remains guarded, including partial-failure reporting. The executed local harness uses deterministic React-hook lifecycle substitutions, not jsdom or a native WebView.

### R04 — archive writer can create a ZIP that its own reader refuses — P2

**Location:** `python/contest_host/submission_archive.py::build/inspect`.

The writer checks the expanded size before adding manifest.json. The reader checks expanded size including the manifest. Highly compressible data near the 32 MiB limit can pass writing and the compressed native-save bound, yet fail reopening.

**Reproduction at the actual production limit:** baseline accepted a 34,621-byte compressed ZIP with a 33,553,868-byte export payload; its own reader then rejected the expanded entry size. Patched writer rejects before constructing the invalid archive. Small fixtures also verify a normal round trip and an exact expanded-size boundary.

**Repair:** include the manifest in the writer's expanded-size check. Retain the same bound and archive schema; no truncation, partial archive, limit increase or restoration side effect.

**Acceptance still required:** native preflight/save must surface the bounded rejection without losing an existing reviewed export. Existing valid archive files remain readable.

### R05 — malformed normal-log ADIF times become plausible different times — P1

**Location:** `Sources/XLogCore/QSOADIF.swift::adifDate`.

`padding(toLength:6,...)` pads short strings and truncates long ones. The old importer can turn `12` into `120000`, `12345` into `123450`, or `1234567` into `123456`, instead of rejecting malformed data.

**Repair:** require exactly eight ASCII date digits and four or six ASCII time digits, use a UTC Gregorian non-lenient formatter and verify a format round trip. Only an already valid four-digit time receives the two zero seconds. This affects the end timestamp too. The malformed record remains rejected; the patch does not invent missing source information.

**Reproduction:** exact complete production QSOADIF extension compiled with small value-model stubs. Invalid lengths, full-width digits, invalid times and leap dates were tested; valid four/six-digit and leap-date controls remain accepted.

**Acceptance still required:** repository XCTest suite and native import error reporting; malformed records must be diagnosed/quarantined by the existing caller, not silently vanish from a claimed successful import. No bulk repair of existing rows.

### R06 — implicit midnight end time receives the wrong calendar date — P1

**Location:** the same QSOADIF initializer and legacy backfill projection.

An ADIF contact starting at 23:55 with TIME_OFF 01:00 and no QSO_DATE_OFF is currently assigned an end time before its start. ADIF defines the missing-end-date case as a duration below 24 hours; the official specification includes precisely this midnight form.

**Reproduction:** baseline gives a negative 82,500-second duration; patch gives 3,900 seconds and exports the following date. Year-boundary, explicit multi-day and explicit same-date controls were exercised.

**Repair:** shared end-date mapping infers the next UTC day only when the end date is absent and the parsed end precedes the whole-second start. Explicit supplied end dates are not silently moved. Legacy backfill uses the same rule without mutating the original stored object. Comparing whole seconds prevents a fractional stored start from causing a false extra day.

**Policy boundary:** an explicit end date inconsistent with start is preserved by this narrow mapping fix, not silently corrected. Existing caller validation may flag it. This review does not authorize historical normalization.

**External reference:** ADIF 3.1.8 Time/TIME_ON/TIME_OFF, released specification: https://www.adif.org.uk/318/ADIF_318_annotated.htm . The standard was consulted for this rule; other findings derive from repository source and executed probes.

### R07 — export enrichment resurrects stale receive frequency/operator — P1

**Locations:** `python/contest_host/lanes.py::augment_adif`; `host.py` contact correction and export paths.

The enrichment step overlays the original external/import packet's OPERATOR and FREQ_RX after the base writer has used the corrected row. This can undo explicit operator or receive-frequency corrections in the exported ADIF. Removing a value can also restore the stale original value. Known lane metadata does not prevent the packet from overriding current RX.

**Reproduction:** original packet OLDOP / 14.026 MHz; current row NEWOP / 14.050 MHz. Baseline exports OLDOP / 14.026; patch exports NEWOP / 14.050. Clearing the row values leaves no such exported fields. APP_XLOG_EXTERNAL_ADIF remains the exact original packet, and original mode/sent serial/lane identity remain intact.

**Repair:** editable operator/RX facts come from the authoritative row when enriching those original fields. Original packet data stays separately in immutable provenance. Remove replaced tags through the existing length-framed walk, including deliberate clears; avoid duplicate standard fields. No substring replacement across values: a literal `<EOR>` inside a comment was exercised.

**Acceptance still required:** actual digital completion AND historical import, followed by correction and prepared ADIF export. Check mode/submode/actual sent serial, packet provenance and contact IDs. Do not treat a mocked array test as a complete external-engine acceptance.

## R08 — replica write admission does not cover strategy actions — P1, OPEN

**Source-confirmed concern; no complete Host reproduction or patch claimed.**

`Host.REPLICA_BLOCKED` enumerates ordinary logging/correction mutations but omits `strategy_apply`. `Host.mutate` applies that op-level gate, then dispatches strategy actions including `adif_import`, QTC actions and VHF site operations. The imported-contact helper writes DXLOG and audit; its path has no independent replica check. New mutation families should not bypass the established authoritative logging path merely because their outer operation is called strategy.

This is not a claim that unauthenticated Internet clients can write the log, or that the current UI exposes every path. It is an internal Host authority gap to exercise through the actual replica session and current entrypoint. UI disablement alone is not a sufficient Host guarantee.

**Required next action:** in disposable paired Host fixtures, invoke authority-changing strategy actions against a replica and verify zero contact/QTC/site/revision/receipt changes on rejection. Check admitted local planning/message preferences separately. Do not simply block all strategy_apply: some purely local metadata operations may be valid. Add the smallest per-action authority policy at the existing Host boundary, consistent with the established replication owner, then rerun existing multi-op and strategy tests. Preserve operation identity, old valid receipts and atomic failure semantics.

This remains open in the repair branch. It should be resolved or precisely bounded by evidence before release, not silently counted as an eighth fixed bug.

## Executed verification versus supplied tests

The isolated execution environment used Python 3.13.5, Linux Swift and Node 22.16.0. The shipping Python 3.12/macOS runtime must still execute repository checks. Exact-module tests do not establish application packaging or provider behavior.

| Executed local group | Checks | Scope |
| --- | ---: | --- |
| Import mapper | 5 | Exact production review/apply, in-memory SQLite, minimal Desk/Host boundary doubles; exact NAQP setter. No complete scoring rebuild. |
| Archive writer/reader | 3 | Exact module, empty query fixture; accepted roundtrip and expanded bounds. |
| ADIF enrichment | 5 | Exact module and independent length-framed field checks; no Host/network. |
| Swift ADIF extension | 22 | Complete exact QSOADIF extension compiled against value-model stubs. No complete XLogCore module/native app. |
| Import component lifecycle | 4 | Exact TSX transpiled and executed with deterministic hook/runtime substitutes. No actual React DOM/native UI. |
| **Total** | **39** | All pass on patched files. Relevant baseline counterexamples fail; positive controls remain passing. |

The actual 32 MiB archive reproduction and the same eight archive/enrichment tests rerun through repository-style imports are additional confirmations, not additional unique coverage. The downloaded package retains baseline and patched output separately.

Five repository regression files are supplied: `test_review_adif_import.py` (real Host), `test_review_archive_bounds.py`, `test_review_adif_enrichment.py`, `ADIFTimestampReviewTests.swift`, and `ContestHistoricalImport.lifecycle.test.tsx`. The archive/enrichment repository versions were run locally. The full-Host/XCTest/Vitest versions are **authored but not executed here**. They must compile/run in the real checkout; syntax or harness adjustments must not weaken the assertions.

## Existing CI is not uniformly green

The reviewed installed-source Cross-platform prototype run `40607030254` is failed. The last fetched jobs response identifies macOS job `122548971919` failing **Test portable Swift core (Unix)**, with subsequent integration/package steps skipped. This is evidence about that existing baseline run, not a new branch test failure or an independently diagnosed application crash. Earlier run/connector views differ; preserve the exact run/attempt log when diagnosing rather than guessing the failing assertion.

Source references:
- https://github.com/oliverbross/OM0RX-xLog/actions/runs/40607030254
- https://api.github.com/repos/oliverbross/OM0RX-xLog/actions/runs/40607030254/jobs?per_page=100

Do not claim complete CI acceptance from a successful separate workflow or local tests. Reproduce the specific relevant failure once, identify test/runtime/environment cause, and run the required integrated gate against the final repair source. Do not repeatedly rerun everything until a flaky test happens to pass.

## Deliberately not reopened or changed

No new claim of safety or completeness is made for station/PTT/rotor/physical audio, CW capacity or mapping, Dock/OS shutdown, private-IDBKEY integrity, provider accounts, all-platform installation, historical Clear causation or known AADX/SST/CQWS/PWT gaps. The master plan retains them. No production contact correction, rescore, sync, restore, cleanup, capture or installation is part of this task.

The existing note journals, command receipts, read/write revisions, single log/serial authority, immutable export bytes, radio ownership and original packet provenance are preserved. This batch does not replace them with generic frameworks.

## Bounded integration task for Codex

1. Read this review and current AGENTS/development workflow. Fetch the repair branch without resetting another task's checkout. Preserve newer main changes; reconcile relevant deltas once.
2. Review the five source patches. Run the supplied existing-harness regressions on the supported runtime, then related historical import/ADIF/export/archive tests. Add end-to-end cases only for the missing boundaries stated per finding.
3. Close R08 through an actual replica-host failing test and a minimal per-action guard; retain legitimate local-only planning behavior. Do not label this fixed merely by disabling a button.
4. Diagnose the existing relevant CI failure and complete the final required integration gate. Reuse unaffected evidence, caches and hardware limitations. Do not re-audit all five feature waves.
5. Exercise one real isolated native candidate: own serial ADIF roundtrip; historical NAQP sent exchange; corrected/cleared RX/operator export with original packet retained; invalid UTC and midnight import; invalidated file read recovers; archive near-limit rejection and normal Save/reopen. Inspect actual bytes, not just operation success.
6. Update existing master-plan owners (principally W08/W15/W20/W24, NL-23/25/28) and a dated acceptance entry. Do not merge this draft based only on the local probes. Coordinate the final merge into canonical main only after review/relevant checks; preserve unrelated work.
7. If accepted, build one uniquely versioned signed candidate at the coherent milestone. No patching/relabeling installed 1.3.58, no per-file rebuild, no automatic installation. Report source/candidate identity, actual outcomes and remaining limitations, then stop.

**Historical data policy:** new behavior can change future imported/exported representations. It does not establish that existing rows are wrong. Any historical diagnostic must be read-only and use an explicitly authorized copy; corrective migration requires its own reviewed scope and backup. Keep raw source records and submitted snapshots intact.

## Pinned source register

All paths below use baseline `b30dc62e5092e4e77431f05516df7aa68df2ba6c` unless the linked repair branch says otherwise:

- `python/contest_host/adif_import.py` — review/apply, serial and historical exchange mapping.
- `python/vendor/not1mm/upstream/not1mm/lib/plugin_common.py` — ADIF sent/received string exports.
- `python/vendor/not1mm/upstream/not1mm/plugins/naqp_cw.py` — current-setting setter and row-based Cabrillo output.
- `python/contest_host/host.py` — REPLICA_BLOCKED, mutate, strategy_apply, correction, rebuild and prepared export.
- `python/contest_host/lanes.py` — immutable attribution and ADIF enrichment.
- `python/contest_host/submission_archive.py` — exact-byte writer/reader bounds.
- `prototype/src/contesting/ContestHistoricalImport.tsx` — ticket/busy lifecycle.
- `Sources/XLogCore/QSOADIF.swift` — normal timestamp mapping/backfill/export.
- `python/tests/test_wave5_adif_host.py` — existing real-Host fixture/helper and previous coverage.
- `Tests/XLogCoreTests/ADIFTests.swift` — current XCTest module conventions.

Direct source prefix: https://github.com/oliverbross/OM0RX-xLog/blob/b30dc62e5092e4e77431f05516df7aa68df2ba6c/

**Finish criterion:** corrected data at the actual import/edit/export boundaries, justified authority enforcement, and explicit final source/candidate evidence. Not a new feature programme and not an assertion that the entire application is bug-free.
