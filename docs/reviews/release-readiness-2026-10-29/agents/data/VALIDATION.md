# Phase 7 Python, contest and data validation

Canonical main was tested at `b892663915cbc0768b26dc5a7bf7ec116869e409`; application inputs remain `f3f6e3dee40af29cb6801ef8ee422c521629e168`, version 1.3.60. Root established clean fast-forward entry. This stage made no source, test, configuration, root-report or Git edits. All new evidence and disposable databases live under `/tmp/xlog-phase7-20261029-b8926639`; the catalogue checker additionally generated its ignored `.build/all-contests-fixture-inputs.json` cache, but did not consume that cache for the gate. Final tracked/untracked status was clean and the scoped source diff was empty.

The Python/tool regression gates pass after one retained generator environment setup failure. This does **not** clear application finding FA-013: a fresh actual two-Host execution reproduces it. FA-015 and FA-016 remain source-confirmed mechanisms with runtime verification unperformed under the preserved custom-executable boundary. No GUI, provider, credentials, production DB/settings, device, audio or RF was accessed.

## Command results

Every check used the common `/tmp/xlog-phase7-20261029-b8926639/run_check.py`. It records exact argv, cwd, UTC start/end, exit, elapsed time, source head at both ends, scoped source-diff SHA256, log byte count and SHA256 in `checks/<ID>.json`. `agents/data/command-results.json` collects this stage's receipts. Each check has an explicit private per-ID TMPDIR, `PYTHONDONTWRITEBYTECODE=1`, Python/test PYTHONPATH, explicit Python 3.12 runtime selection, denied contest UDP flags, and inherited XLOG_/XCW_ opt-ins removed. Generator R2 explicitly adds read-only `CONTEST_SW_ROOT=/Users/oliver/Documents/Projects/contest-sw`.

| ID | Actual result | Scope and limits |
| --- | --- | --- |
| P7-PYTHON | **PASS 558**, exit 0; 414.495 s unittest body, 415.692 s runner | Full `/opt/homebrew/bin/python3.12 -B -m unittest discover -s python/tests -v`; no skipped failures hidden. Includes seven reviewed-security-policy unit cases. |
| P7-CATALOGUE | **PASS 97 plugins**, 393 family tests; 1,353 PASS checks / 5 NOT APPLICABLE / 0 FAIL; exit 0, 348.873 s | Fresh `--family-tests`; `fixtureCache=null`; set equality enforced for registry, lifecycle seeds, score expectations, export fixtures and actual Host catalogue. Family tests overlap full Python. |
| P7-EQUIVALENCE | **PASS 127**, exit 0; 151.305 s test body | Append/rebuild equivalence. All optimized append plugins covered. `john_moyle_field_day`, `wae_cw`, `wae_rtty`, `wae_ssb` deliberately use full rebuild. |
| P7-GENERATOR | **FAIL setup**, exit 1; 42 run, 10 failures | My scratch invocation omitted required `CONTEST_SW_ROOT`. All ten failures explicitly require that external pinned corpus. Original logs/receipt retained. |
| P7-GENERATOR-R2 | **PASS 42**, exit 0; 15.117 s test body, 16.103 s runner | Only corrected the missing environment variable; same Python 3.14, suite and assertions. No source/fixture/assertion change. |
| P7-CORPUS | **PASS**, exit 0 | Read-only external corpus exact pin `7c8b499225a73f7f8f792246881bd7aefc05452f`; 94 upstream plugins / 16 active previews reconcile against checked-in inventory. Different denominator from the 97 runtime catalogue. |
| P7-RELOCATION | **PASS 12**, exit 0; 0.374 s test body | Application-relative Python/runtime relocation and admission boundaries; no application launch. |
| P7-SECURITY-FLOOR | **PASS four floors**, exit 0 | rustls 0.23.46, rustls-webpki 0.103.16, tokio 1.53.3, webpki-root-certs 1.0.10. Seven policy unit tests are already inside the 558, not seven additional unique cases. |
| P7-FA013 | **Counterexample reproduced**, checker exit 0; 4.285 s | Exit 0 means the expected defect and rollback were observed, not that replica catch-up passed. |
| P7-DATA-INTEGRITY | **PASS two databases**, exit 0; 0.331 s | Actual fresh FA-013 master/client SQLite files: integrity_check `ok`, zero foreign-key violations, read-only queries and identical before/after byte hashes. |
| P7-ADX-SCHEMA | **PASS 179/179**, exit 0; 0.174 s | Exact ADX RECORD standard-name vocabulary equality, no missing or extra names. This is not full original-XSD compilation. |

Lean-ctx dispatch returned tool-layer 120-second timeout messages for the first generator and corpus calls. Their durable receipts/logs remained available: generator's actual exit was 1 for missing environment, corpus exit 0. No duplicate execution was launched to compensate for a transport timeout. Independent checks were batched with Promise.allSettled; dependent setup, adaptive retry and evidence generation remained sequential.

## All-97 qualification boundaries

`all-contests-readiness.json` is the complete fresh dynamic catalogue evidence. `agents/data/catalogue-summary.json` retains per-plugin checks and capabilities; `catalogue-dimensions.json` adds explicit PASS / UNVERIFIED / NOT APPLICABLE dimensions for every one of the 97 plugins.

The 1,353 passing assertions establish the pinned disposable lifecycle: descriptors/setup, stored fields, fixed expected points/multipliers/score, invalid input atomicity, duplicate behavior, serial progression, basic analytics, exact fixture exports, correction/deletion and reopen. They do not independently certify every sponsor's current rules or every category/band/exchange combination. All 97 retain **UNVERIFIED** current sponsor-rule currency, complete category/band coverage, packaged native GUI and external submission dimensions.

Multiplier views are represented honestly: 3 plugins advertise both country and zone support; 67 mark both not applicable; 17 lack country views with zones not applicable; 9 lack both; 1 has country not applicable and zone not implemented. Thus 26 country and 10 zone dimensions across 27 distinct plugins remain **UNVERIFIED** as implemented views, separate from their passing basic analytics/score lifecycle. A not-implemented capability is not silently counted as full analytics acceptance.

## Migration, data and configuration compatibility

The machine-readable matrix is `migration-data-config-compatibility.json` (12 rows). Parent-owned `P7-NATIVE` evidence is referenced where its executed tests cover these surfaces; those counts are not added to this stage's Python totals.

| Surface | Current status and evidence | Remaining boundary |
| --- | --- | --- |
| Python interrupted schema upgrade / serial-ledger evolution | **PASS**, full558 includes independent upgrade-artifact repair and preservation of issued legacy reservations | Disposable fixtures; not arbitrary OS power loss or production migration |
| Legacy imports / identities / receipts / serial floor | **PASS**, full558 covers repeat/reopen, immutable audit history, correction/deletion and missing-identity fail-closed behavior | No automatic rebaseline of already-diverged peer history |
| WAE legacy arithmetic and explicit recalculation adoption | **PASS**, full558 includes retained old policy, explicit new digest/adoption and independent arithmetic | Pinned rule cases; no universal rule-currency claim |
| Swift contest v1/v2 migrations / snapshots / rollback | **PASS**, parent P7-NATIVE passes real session/QSO/reservation/counter/receipt preservation, failed-migration rollback, concurrent first open, read-only snapshot inspection and restored-copy upgrade | Test fixtures only; no production files |
| Saved settings format compatibility | **PASS**, parent P7-NATIVE passes four Logbook mode migration cases; legacy missing mode retains Wavelog behavior, unknown mode rejects, fresh settings remain local | Disposable UserDefaults suite; installed settings untouched |
| Normal restore / destination settings authority | **PASS bounded ordinary path**, parent P7-NATIVE passes six BackupRestoreAuthority and nine WavelogDestinationAuthority cases, including intercepted request controls | Overlapping parent totals; no FA-015/FA-016 runtime coverage |
| ADX vocabulary / retained field compatibility | **PASS 179/179**, fresh P7-ADX-SCHEMA; full frontend round trips belong to frontend stage | Vocabulary proof; historical original-XSD regex complication remains |
| Fresh disposable DB integrity | **PASS 2/2**, read-only integrity/foreign-key checks and byte preservation | Only the retained fresh master/client files |
| Country-prefix reconcile stream | **FAIL FA-013**, actual supported Host producer/consumer mismatch | Replica transaction rolls back; no deletion or actual LAN peer shown |
| Restore package identity across component readers | **UNVERIFIED runtime / source-confirmed FA-015** | Requires external package replacement during restore; prior custom driver remains unexecuted |
| Retained native interrupted restore authority | **UNVERIFIED runtime / source-confirmed FA-016** | No process termination/power-loss/native GUI; saved automatic-sync pause survives if persisted; later manual sync and authorized token also required |
| Production migration / crash durability / installed configuration | **UNVERIFIED** | Prohibited production/provider/native acceptance was not attempted |

Current source was rechecked: Python store repairs independently observable upgrade artifacts inside a transaction (`store.py:120-149`); main DB migrations retain authoritative record JSON while adding derived indexes (`LogbookDatabase.swift:3579+`); tests use isolated roots/defaults. These fixture checks do not imply the full application's production/crash acceptance.

## Original history versus current findings

The six historical root reports were used as history: CODE_REVIEW, REVIEW_COVERAGE, REMEDIATION_TRACKER, REGRESSION_TEST_REPORT, STABILITY_REPORT and FINAL_CODE_AUDIT. Their older successful counts, prior failures and open limits were not substituted for fresh Phase 7 outcomes.

| Finding | Current bounded disposition |
| --- | --- |
| CR-004 / FA-002 imported audit/identity replica roots | Existing repairs remain verified by full current Python tests, including new/legacy import wire identities, repeated-page country hydration, independent score, replay/reopen and rollback. FA-013 is a separate supported event kind. |
| CR-005 serial allocation / CR-006 WAE / CR-007 recorder origin | Current full Python passes the existing floor, national-prefix-area/legacy-adoption, and local ESM/function-key origin tests. Physical recorder/audio and sponsor acceptance remain outside this stage. |
| CR-009/011 retained import/export / CR-012 ADX | Parent native and frontend stages own their broad execution. This stage independently reconfirms the 179-name current ADX vocabulary and retains compatibility limits. |
| FA-001 ordinary restore / FA-008 ordinary settings authority | Parent fresh native tests reconfirm ordinary destination/consent, linked rows/tombstones, unsaved settings, telemetry-only saved-field persistence, and intercepted-request controls. These are separate from interruption/publication gaps. |
| FA-013 | **Still confirmed, P2/Medium**, fresh actual two-Host counterexample. Not fixed by a passing generic suite. |
| FA-015 | **Source-confirmed, runtime unverified**, pre-existing adjacent consistency gap. Current `BackupManager` separately inspects/captures main, contest and reference data from the mutable URL (327,399,436); the immutable-envelope contract at475 remains. No blocked custom executable was retried or bypassed. |
| FA-016 | **Source-confirmed, runtime unverified**, distinct native interruption gap. Current AppModel saves paused A at1168, installs B DB at1173, then persists B settings1177-1178. No crash/native sync/provider execution. |

FA-013 proof copied the prior probe byte for byte to this new scratch directory; the probe derives output/runtime roots from its own file and resolves them to `/private/tmp`. Prior Phase 6 artifacts were unchanged. Two real current Hosts baseline a valid master/client configuration, successfully replicate the initial OE8DDX contact, and accept the authority's endpoint-compatible `*4U1V` → `OE` reconciliation. Its genuine next page contains `reference_reconcile` with bare country maps and fails `invalid_request: Replica change kind is invalid`. The replica's full SQLite dump remains identical. `country-reconcile-result.json` preserves the exact event identities and `replicaUnchanged=true`; both retained DBs subsequently pass structural checks. No stored row was manually injected or rewritten for this probe.

## Preservation and security limits

All check receipts start/end at the exact requested source and retain the empty scoped source diff SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. `source-evidence.json` binds the rechecked source/tests/history files and confirms byte-identical copied proof/schema helpers. No application candidate was built, packaged, installed or launched by this stage.

Final `validate_evidence.py` / `evidence-qa.json` passes: all 11 command receipts, exact source/diff bindings, every log size/hash, the single retained setup failure/corrected retry, all97 dimension rows, 26/10/27 view limits, actual-Host rejection/rollback, both DB integrity results and179 schema names agree. No test command was repeated for this evidence QA.

This stage performed no network advisory refresh, OSV/cargo-audit scan or dependency update. Four reviewed lockfile floors and their seven full-Python policy tests pass; this is a bounded policy check, not a fresh comprehensive security audit. Parent frontend npm-audit evidence remains separately scoped. Historical conditional Linux GLib and migration debt are not cleared by these checks. No new tests/assertions were weakened and no application fix was attempted.
