# Remaining limits — source acceptance follow-up, 26 October 2026

This follows [all-contest acceptance](ALL_CONTESTS_READINESS_ACCEPTANCE_2026-10-26.md)
without replacing its historical receipts. The tested analytics/Python source is
`75f735484bbb2acde5c9ee2d11f50747995eba5e` on canonical `main`. Installed
application acceptance below belongs to the separately signed **1.3.34** source
`db1641a2d2245951700604f98733308fbd2259df`. Source tests, installed behavior and
physical-station acceptance are separate evidence.

The final timed-scope projection correction is
`b17ad0f4b9dcc4703b10c0947d4238a4efafefc2`; the independent Cluster Show Yes/No
correction is `efd80ae2`. The refreshed matrix verifies the saved Python source
bytes against the later canonical commit and preserves both broad and affected
frontend result files. Its committed verification covers the listed source paths,
not an invented rerun of every earlier suite after unrelated changes.

## Source gates

| Gate | Measured result and local evidence |
| --- | --- |
| Full Python discovery | **408 tests PASS**, no skips/failures/errors, 373.468 s; `/tmp/xlog-python-limits-final.log` |
| Family fixtures and detailed lifecycle | **331 family tests PASS**, plus all **94** registered definitions pass their disposable lifecycle; `/tmp/xlog-readiness-limits-final.log` |
| Append versus full rebuild | **126 tests PASS**, containing **191 actual comparisons** across all **40 admitted optimized IDs**, with no uncovered ID; `/tmp/xlog-append-limits-final.log` |
| Actual native Python lane | **3 native tests PASS**, including the all-94 fixture lifecycle and the pinned/reference-copy checks; `/tmp/xlog-native-catalogue-limits-final.log` |
| Dedicated analytics modules | **26 tests PASS**, no skips/failures/errors, 107.883 s; `/tmp/xlog-analytics-limits-final.log` |
| Rust native unit suite | **888 tests PASS**, no failures/ignored cases, before the later timed-scope projection fix; `/tmp/xlog-rust-limits-final.log` and numeric exit receipt |
| Final timed-scope native group | **35 tests PASS**, including the new full UTC/mode-scope regression; `/tmp/xlog-rust-timed-scope-final.log`. These overlap the broad suite; this is not a claimed full 889-case post-edit run. |
| Full frontend regression | **4,515 PASS / 3 FAIL** across 4,518 cases and 305 files; `/tmp/xlog-frontend-limits-final-results.json`. Two timed-scope projection failures and one passive-polling assertion are recorded, with affected-file corrections/retries below. This invocation remains a failed broad run. |
| Final affected frontend files | **191 PASS**, no skipped/todo cases: all 97 contest-desk cases, 91 surface-protocol cases and three detached-CW cases; `/tmp/xlog-frontend-limits-affected-results.json`. Every original failed case has a passing named recheck. |
| TypeScript | `tsc --noEmit -p tsconfig.json` exit **0**, durable receipt `/tmp/xlog-tsc-limits-final.exit` |

Python gates used `/opt/local/bin/python3.12` with
`PYTHONPATH=python:python/tests`. The dedicated command ran `test_analytics`,
`test_cross_contest_consistency` and `test_analytics_catalogue`, writing
`/tmp/xlog-analytics-inventory-limits-final.json`. Its source commit and all 94
entries were checked. These suites overlap; their counts must not be added.
John Moyle deliberately retains full rebuild because earlier multiplier flags can
change. The append comparisons establish equivalence for the exercised cases,
not all possible logs or current sponsor editions.

The broad frontend run exposed a real presentation integration defect: the new
timed-family scopes exceeded the old short-band protocol limit. Frontend and Rust
schema-one validators now retain complete band/mode/UTC-block identities with
matching bounded syntax; schema-four radio bands keep their original limit.
Unsupported scopes remain unavailable rather than truncated. The detached-CW
test now accepts repeated passive snapshots while still rejecting every pre-Arm
output action and checking the exact saved-macro request after explicit Arm.
The final TypeScript repeat and 35 native surface cases passed. These focused
rechecks close the observed failures without claiming the broad run was green.

All 94 definitions remain accounted for; core readiness remains **93 PASS /
1 UNVERIFIED**. CQWS retains its explicit partial-score/unknown federal-unit
limitation and refuses RTC generation for incomplete scoring. The matrix's
current-rule, category, export and operator/hardware boundaries remain in force.

## Analytics coverage and reference scope

The inventory reports capabilities separately, rather than a blanket analytics
completion claim:

| Capability | PASS | NOT APPLICABLE | UNVERIFIED |
| --- | ---: | ---: | ---: |
| Credited multiplier acquisition | 79 | 15 | 0 |
| Reconciled score history | 89 | 3 | 2 |
| At least one verified finite Needed dimension | 39 | 28 | 27 |
| Candidate Needed from spot/exchange evidence | 0 | 15 | 79 |

The two unverified score-history profiles are AADX CW/SSB. A finite Needed PASS
applies only to the named dimensions, eligible subsets and scopes shown in that
profile; it does not certify every dimension. Existing station-owned spot preview
is separate from candidate evidence absent from an analytical copy.

Country universes bind all **346 raw primary-prefix rows**, including named
entities sharing ADIF numbers, to the reviewed bundled reference version, CSV
SHA-256 and canonical mapping SHA-256. Per-call caches and ADIF-collapsed maps
cannot establish completeness. New sessions may persist this optional coordinate.
A matching old session with no stored coordinate may use native-verified context
only in its ephemeral analytics copy. Existing incompatible coordinates take
precedence and remain unavailable; foreign references are not upgraded. Reopen,
setup and ordinary logging do not depend on analytical compatibility. Tests check
unchanged state, contacts, identity/audit/operation rows and SQLite change counts,
as well as native read-only stored-reference equality and snapshot invalidation.
No persistent backfill or completed-log rescore is performed.

## Installed handover and physical boundaries

The [1.3.34 signed artifact and installation receipt](../MACOS_1_3_34_RELEASE_2026-10-26.md)
accepts both live menu directions. Immediately before the single Return to Normal,
**22 fresh contest-owned Radio 1 Agent receipts** existed, aged 101.0–329.7 s.
Normal startup was observed about 6.2 s after dispatch; the reciprocal Contesting
startup about 15.7 s after dispatch. These observations are not internal drain
timings. Outgoing windows closed, the intended workspaces returned, and protected
contact/revision/identity/audit tables matched the fresh installation baseline.

The accepted policy seals new admissions and drains previously accepted work;
cosmetic marker withdrawal is deferred. All 22 contest receipts remained after
the first switch. This proves handover with fresh receipts under that policy,
not remote marker removal, TTL expiry or a removal acknowledgement. Unknown
delivery intent and receipt ownership are retained rather than erased for a
successful switch. The exact earlier 1.3.33 overlapping admission remains unknown.

Transport checks use injected Flex/TCI/FLdigi/WSJT-X test doubles; the bounded
transport gate passed 62 tests in disposable child storage. The two-radio check
passed against real bundled Hamlib **dummy receivers**, not physical radios.
Related output UI checks passed 212 tests. Their logs are
`/tmp/xlog-limits-transport-swift.log`, `/tmp/xlog-limits-dummy-radios.log` and
`/tmp/xlog-limits-output-ui-results.json`. These establish the exercised software
contracts, not RF/PTT, transmitter audio, real digital-engine operation, rotor
motion, multi-operator deployment or every physical radio/provider path.

Human audible playback was separately accepted on 1.3.32 for the saved GM5E clip
through MacBook Pro Speakers at the recorded route/gain; capture remained stopped.
See the [listening receipt](../MACOS_1_3_32_RELEASE_2026-10-26.md#human-audible-playback-acceptance).
That bounded listening result does not establish TX or operator-ear recording
coverage. Experimental CW Decode remains hard-disabled and unqualified; existing
contest CW ESM/keyer behavior has its separate scope.

## Future sync audit and historical uncertainty

Current source durably journals future automatic/manual bidirectional sync runs,
with bounded retention of 100 receipts, start/finish/outcome and safe error codes.
Predispatch attempts and acknowledged remote creates/updates/deletes distinguish
confirmed writes from unknown outcomes. Processed remote rows and acknowledged
contacts are report counters, not upload or local-insert counts. Interrupted runs
and unfinished totals remain explicit rather than becoming a confirmed zero.

Completed measured runs also report committed **local contacts added**, **local
contacts updated**, **local contacts marked deleted** and separate **baseline
metadata repairs**. These are transaction-owned reconciliation effects, exclude
foreground changes and distinguish no-ops from baseline-only repairs; they are
not necessarily downloads. Missing, failed, cancelled or interrupted local totals
remain unavailable. Disposable/mock tests cover restart, failure, cancellation,
semantic adoption, conflict/no-op, rollback and chunk boundaries. Public receipts
omit credentials, endpoints and contact identifiers. No live sync/upload was run
to manufacture this acceptance.

The earlier 1.3.32 observation remains historical: three remote-linked local
contacts were added and 120 existing rows changed metadata/baselines, with original
identities retained and no deletion. Existing one-minute automatic-sync consent
supports an inference of background catch-up. Exact historical runs, per-run local
counts and upload activity cannot be reconstructed from the old in-memory report.
The new journal does not retroactively prove attribution or zero uploads.

## Qualified candidate and coordinated delivery

Signed **1.3.35** passed packaging from exact canonical source
`89d51e801c2a0bdfcb084ce97d4eba9e9de45225`, followed by eight actual bundled-worker
process cases and 44 packaged-interpreter CQ WW/analytics tests, without skips.
Its 4,075 retained bundle entries match, CW remains disabled, and all component
provenance agrees. The [release record](../MACOS_1_3_35_RELEASE_2026-10-26.md)
contains exact hashes, signature, the independently resolved transient-checkout
incident and the 175-file clean-source frontend reproduction.

This candidate remains uninstalled while a separately requested Classic/Modern
cluster setting is prepared for the next version. One protected replacement is
planned after that combined candidate qualifies, preserving the current draft.
Until the later installation receipt exists, installed evidence remains specifically
1.3.34. Physical hardware, notarization and 1.3.35 live acceptance are not claimed.
