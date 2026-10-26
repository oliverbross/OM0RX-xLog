# All-contest source and release acceptance — 26 October 2026

The later [remaining-limits acceptance](REMAINING_LIMITS_ACCEPTANCE_2026-10-26.md)
records the expanded analytics, durable sync evidence and installed 1.3.34
fresh-receipt handover. The refreshed complete matrix uses the final source gates
listed there; the checkpoints and earlier release outcomes below remain historical.

The canonical implementation is on `main` in `/Users/oliver/Documents/Projects/OM0RX-xLog`.
The final source qualification checkpoint is `128ee7afeac33168a3779dcc143006a1fd257dcf`,
following host corrections `a037ace046af05ce066d23802d94198661be4ba0`, initial
catalogue qualification `3f5f44aab9d23031a49703c3a28d5d1afb37dae1`, and the
literal WIA operating-case regression `e7430723`.
The complete matrix and compact JSON were pushed in `d29fc135a19a918dbe82ed88e1a42ee73585e44b`.
The renderer checks tested SHA-256 values against actual committed Git objects;
the raw run's older HEAD is not presented as if it contained its working-file changes.

## Catalogue result

Registry, catalogue API, fixture/score/export-oracle sets, source manifest and
vendored module sets account for all **94** registered definitions: 89 named
contests, three utilities and two general QSO-party templates. All 94 detailed
host lifecycles passed. Core source readiness is **93 PASS / 1 UNVERIFIED**.

CQWS remains the explicit exception: station-class exchanges do not supply a
Brazilian federal unit. Unknown UF multipliers are omitted, the UI and Cabrillo
identify a partial lower bound, and RTC payload generation refuses partial scores.
The preserved explicit-UF one-point branch also lacks verified point-rule authority
in the available official 2023 document. Current 2026 rules remain unverified.
No state identity is inferred or fabricated. This is a scoring limitation, not a
failure to retain/export those contacts.

Other current sponsor editions are separately UNVERIFIED unless the matrix names
specific official evidence. HA-DX/PACC/IOTA arithmetic and ES Open corrections have
bounded 2026 evidence; REF has official-summary evidence and a failed full-DOCX
retrieval. Source integration PASS does not certify all organizer categories/rules.

## Gates

| Gate | Result / evidence |
| --- | --- |
| Full Python source suite | 394 PASS; `/tmp/xlog-python-final-accepted.log` |
| Existing host family fixtures + detailed lifecycle | 331 family tests PASS; all 94 definitions, 14 feature checks each PASS/NOT APPLICABLE; `/tmp/xlog-readiness-final-accepted.log` |
| Append versus full rebuild | 126 tests PASS, all 40 admitted optimized IDs covered, no uncovered ID; `/tmp/xlog-append-final-accepted.log` |
| Fallback | John Moyle remains on full rebuild because earlier multiplier flags can change |
| Current React owner + detached entry + real Python JSONL | 97 PASS: every definition, CQWS partial-UF behavior, literal WIA years and Japanese-entrant JIDX labels; `/tmp/xlog-all-contests-ui-final-accepted-results.json` |
| Actual native Python lane | All 94 fixtures PASS inside `PythonCatalogueReadinessTests`; the final repeat reused the compiled native test binary and launched the current Python host; `/tmp/xlog-native-catalogue-accepted.log` |
| Native surface validation | 34 PASS; `/tmp/xlog-native-surface-accepted.log` |
| Focused current entry/setup/protocol/presentation | 329 PASS; `/tmp/xlog-contest-ui-final-focused.log` |
| Band Maps | 54 PASS; authoritative reported modes retained, phone fixtures corrected; `/tmp/xlog-bandmaps-final.log` |
| Node harness | 2 PASS; `/tmp/xlog-frontend-node-final.log` |
| Full frontend regression | 4,479 cases: 4,475 PASS and four five-second timeouts in `tests/live-app.test.tsx`; the entire affected 49-test file then PASS with one worker and a 15-second test timeout, without source/assertion edits. `/tmp/xlog-frontend-complete-final-results.json` and `/tmp/xlog-live-app-final-retry-results.json`. Every failed case has a passing retry; this is not represented as one fully green broad invocation. |
| Production frontend / window graphs | TypeScript, Vite and all 24 surface graphs PASS; mode/window gate checkpoints `ebdb4b81` and `5dd6e7f1` |

The first broad frontend run exposed stale radio-control selectors/port fixtures,
the missing CW Decode window allowlist entry, wrongly CW-labelled phone spots,
and timing failures. These were investigated, repaired or rechecked explicitly;
its failed invocation is not counted as a green full run. Detailed final results
and retry commands are recorded above.

The append workload checks retained 28 SQL statements at 100, 1,000 and 3,000 rows
(6.213 / 4.150 / 4.696 ms in the recorded run). This is a bounded source workload,
not WAN, installed-app or hardware performance acceptance.

## Implemented integration changes

- New sessions use revisioned HA-DX/PACC/IOTA/REF/ES Open/CQWS scoring overlays;
  historical unmarked sessions retain their prior scoring policy. PACC replay
  receives saved exchanges, and numeric REF departments no longer crash replay.
- SAC/Region 1 Field Day received serial validation is atomic. Helvetia stdout
  diagnostics are separated from the JSONL response channel.
- Generic ADIF retains saved raw and compound exchanges and stable QSO identity
  in application tags. LABRE-RS Cabrillo frequency and WPX/Roundup RTTY mode tokens
  are corrected. Reviewed per-plugin Cabrillo/EDI contact lines are checked.
- Generated entry labels have role-based fallbacks. A hidden compatibility serial
  remains represented and protected, including WIA's old `#` configuration.
  Normal WIA operation uses literal years licensed, not an allocated serial.
- Duplicate explanations describe the actual period/grid/band/mode scope. Shared
  navigation, manual/ESM policy, independent spot duplicate decisions and family
  multiplier/analytics support retain their separately committed consistency work.

CQ WW SSB remains the positive control for manual logging and non-default reports.
CW ESM/keyer behavior is distinct from the unqualified CW Decode feature.
The production package hard-disables CW Decode acquisition/probing/listeners;
it does not disable existing contest CW ESM globally.

## Release and installation

The user explicitly requested an interim rebuild/replacement while final checks
continued, followed by another uniquely versioned final build.

The signed interim **1.3.28** candidate passed packaging from `cc5d387f70ed0a2f7c9a98ab6b2d2666c062b570`. Exact component hashes and the source/candidate checks are in [the 1.3.28 artifact record](../MACOS_1_3_28_RELEASE_2026-10-26.md). Its Developer ID deep strict signature passed, CDHash `b5b10b39e7b7a15efda05e1b9b3b3ba208fbd150`; notarization and Intel-app acceptance are not claimed. The original bundle is `prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app`; a signature-verified copy is retained at `.build/releases/1.3.28/OM0RX-xLog.app`. The coordinated installation owner installed and reopened it under the user's authorization. All 778 protected files matched before reopening and 33 database checks passed. Post-reopen checks retained the normal log's 68,560 rows and contest 775 QSO / 785 identity / 849 audit rows; score 111,360 and 18 dupes were retained. The [installation receipt](../MACOS_1_3_28_RELEASE_2026-10-26.md) distinguishes these data checks from physical-station acceptance.

The second candidate **1.3.29** was built from
`f142114df986bb8d2884edb69126a372f061cc19`, signed and installed after a fresh
protected backup. Its [artifact and installation record](../MACOS_1_3_29_RELEASE_2026-10-26.md)
records CDHash `b3c61ca83064c67b748d3061db909fece920de77`. Startup and contest
logging controls passed. The first Return to Normal attempt failed during worker
retirement; a protected restart of the same signed candidate restored the usable
contest desk. Both mode directions remained UNVERIFIED.

The diagnostic candidate **1.3.30** was subsequently built from
`ff9d9693a86c5d677a7b300079318d5a28c52761`, with the same safeguards and more
precise retirement errors. The [artifact and installation record](../MACOS_1_3_30_RELEASE_2026-10-26.md)
records CDHash `0eddb9ac1d3421240a8a882a7b02e4e9c98f6cdf`, exact component
hashes and the protected installation receipt (`85192828`). Startup passed and
the completed logs remained unchanged. Its single Return to Normal attempt was
rejected before retirement with “Wait for the current operating action to finish
before changing module.” The app and workers remained usable. This preflight veto
did not exercise the new retirement diagnostics and does not establish a causal
fix or either live mode direction at that checkpoint. The installed 1.3.32
follow-up below records the eventual functional acceptance.

The corrective **1.3.31** candidate was built from
`507ab9aed623641e24179e6db644b68501ca0873`, including passive-poll admission fix
`9bf18416`. All 883 native tests passed, with delayed-read versus mutation overlap
regressions, and independent source review retained the digital routing and real
mutation fences. The [artifact and protected installation record](../MACOS_1_3_31_RELEASE_2026-10-26.md)
records CDHash `7e14f15b872f30c1a9e6a9fe8b9bc096c88ff989`, all component hashes
and installation receipt `db0ae81d`. Installation/startup and data preservation
passed after the human finished a live Log Review correction. The new authoritative
baseline is 775 QSOs, 785 identities, **850 audit rows**, 957 points, 116 multipliers
and score **111,012**, with 68,560 normal QSOs. The completed correction was
preserved; older score/audit fingerprints were not restored. The original normal
Clear remains settled at blank revision 2916.

No 1.3.31 mode attempt was made: an unexpected single CQ Zone character in an
otherwise empty contest entry paused the attempt. Later fresh observation found
both fields already empty; no installer cleared them, and no delayed answer should
be applied to a later draft. A newer human-authorized audio task then took sole
app/installation ownership for 1.3.32. The optional direct-FLEX IQ VPN does not
establish the state of the separate Agent/Tailscale connection.

The final installed **1.3.32** candidate was packaged from exact canonical source
`fc8a5e0b329f3380201fc9e3b58b42b8aeea02fa`. The
[artifact, playback and mode acceptance record](../MACOS_1_3_32_RELEASE_2026-10-26.md)
records matching component provenance, a deep strict Developer ID signature
(CDHash `9eb1fd72723bff5d9b78c790b5c8ade82b361797`), the protected five-root
793-file/35-database backup, and pushed final receipt `9f5c891b`. The package
includes the native admission correction and separately authorized recorder
playback correction; the frontend production build, 24 window graphs, worker
self-test, Python relocation and CW offline checks passed.

**Both live operating-module directions passed functionally on 1.3.32.** Normal
Logging opened its intended workspace, and the reciprocal action restored the
reviewed CQ WW session and nine saved core contest windows with fresh contexts
and workers. Recorder remains an explicitly opened singleton utility. Its closed
state after handover is the documented policy. Final Contest Main Logging had
blank callsign/CQ Zone, 59/59 and recording stopped. Read-only snapshots matched
the fresh reviewed contest baseline: 775 QSOs, 785 identities, 850 audit rows and
replica-stage audit, with score 111,012. Stats showed 19 dupes after the human's
completed correction; the older 18-dupe/960-point baseline is historical.

Normal Logging is **not claimed unchanged** after activation. All 68,560 original
normal-row identities remained present with zero deletions, while three clean,
remote-linked contacts were added and 120 existing rows received metadata/baseline
changes. The existing effective one-minute Wavelog automatic-sync authorization
passed its workspace, generation, service, endpoint, station and revision fences.
That authorization, the source's immediate Normal-only sync tick, remote-linked
additions and timestamps support an inference of background catch-up. The exact
historical run and any upload activity remain **UNVERIFIED**: completed-run counts
were held in worker memory without a durable historical receipt. These additions
and metadata were preserved without rollback; no new sync was requested to create
evidence. The normal draft legitimately seeded retained radio metadata and settled
at revision 2917 without pending work; the original Clear was not repeated.

The accepted functional handovers do **not** establish fresh contest-owned spot
withdrawal. The immediate pre-Return-to-Normal inventory contained zero accepted
spot receipts. Normal-owned receipts observed around the reciprocal action do not
prove contest retirement. The cause of the earlier 1.3.29 retirement failure also
remains unproven. No synthetic spot, unknown-receipt clearing, provider retry or
hardware command was used to fill these evidence gaps. Audible playback acceptance
belongs to the separate audio task; no hardware/output acceptance is inferred here.

CW Decode remains disabled and future CW work is isolated and unmerged. Packaging
ownership transferred from the CW chat to the mode-switch chat for 1.3.30/1.3.31,
then to the audio task for 1.3.32; live UI and installation ownership were explicitly
handed over between those tasks. Provenance, signatures and component hashes refer
to the exact handed-over bundles. No notarization or Intel-app acceptance is claimed.

## Protection and remaining operator acceptance

All qualification sessions used disposable storage. No completed CQ WW log, normal
logbook, recording or station setting was used as writable test data. There was no
live tuning, RF/PTT/CW sending, transmitter audio, actual recording, submission or
external QSO upload in the qualification. Installation/backup has its own explicit
human authorization and acceptance record.

Voice/CW/digital transports, recording/playback on physical devices, multi-operator
networking, radio/rotor handoff and other hardware/provider acceptance remain
explicitly UNVERIFIED where the matrix says so. Basic analytics paging was tested;
unsupported credited-multiplier history and needed-universe views remain unavailable.
Installed acceptance is not inferred from a source fixture, native test or signed
package. Keep each operator's category, sent exchange, CTY reference and station grid
correct, and review the current organizer rules before submission.

## Final convergence and protected recovery

JIDX source checkpoint `128ee7af` corrects new-session prefecture multipliers per
band for DX entrants and country plus CQ-zone multipliers per band for Japanese
entrants, including maritime/JD1 cases. Required role-specific exchange bounds
reject setup, commits and corrections atomically. Historical unmarked sessions,
imports and setup edits retain their prior rules. The official October 2026 source
and finite overlays are recorded in [PATCHES.md](../../python/vendor/not1mm/PATCHES.md).
Authoritative host labels identify the multiplier scope; unsupported advanced
history/needed universes remain unavailable.

Installed 1.3.28 exposed a display-only countdown issue: legacy `StartDate` was
session creation time. `82aea117` uses an organizer-calendar CQ WW period only
when justified by a QSO in that period or an exact configured start, respects
explicit `EndUTC` and labels its source/year. Ambiguous schedules remain unknown.
It does not migrate or rescore completed logs. This delta passed 144 focused
frontend checks, native protocol validation and the full production build/24
window graphs.

Mode diagnostics `c849aeaf` explain the exact pending normal-editor operation
without weakening any veto. The installed normal draft had an unfinished Clear
at revision 2915 with no receipt. Its guard was legitimate; bidirectional handover
was not marked passed. The operator subsequently authorized completing that exact
original request in the mode-switch chat. Its owner rehearsed the existing app-core
transaction on a database copy: only draft/receipt tables changed, all other 24-table
fingerprints were retained, and replay returned the same receipt. After a fresh
protected backup and process quiescence, the exact authorized Clear completed once
and retained its durable receipt at blank revision 2916 (`0b0d256f`). All other
normal-log tables and contest core tables were unchanged; the WebKit journal was
not directly modified. Both 1.3.29 and 1.3.30 startup reconciled that receipt with
no pending action or repeated Clear. The installation records above carry the live
evidence separately from the rehearsal. No generic Clear,
logged-contact deletion, journal wipe or hardware operation is authorized by the
qualification itself.

The additional incoming-normal fix `83a3927f` gates normal draft editing,
radio seeding and autosave by operating-module authorization. It prevents a hidden
normal editor from manufacturing another pending replacement while Contesting is
active. Its 23 focused tests include completed-Clear receipt reconciliation without
a second mutation; TypeScript, production build and all 24 window graphs passed.
The application must reopen on this corrected source after the authorized Clear,
not on the interim binary. The installation owner coordinates the fresh baseline.

The final gate results above were produced after the JIDX validation freeze. Their
recorded host hashes match committed Git objects, and all 94 IDs remain accounted
for. Later documentation/version commits do not imply new runtime test executions.

## Reproduction commands

Run from the canonical checkout with Python 3.12 and disposable tool-owned storage:

```sh
PYTHONPATH=python:python/tests /opt/local/bin/python3.12 -m unittest discover -s python/tests
/opt/local/bin/python3.12 tools/check_all_contests_readiness.py --family-tests --output .build/all-contests-readiness.json
/opt/local/bin/python3.12 tools/check_contest_append_equivalence.py
/opt/local/bin/python3.12 tools/render_all_contests_readiness.py
cargo test --manifest-path prototype/src-tauri/Cargo.toml contest_surface::tests
```

From `prototype/`:

```sh
npm run test:node
npx vitest run --maxWorkers=2 --reporter=json --outputFile=/tmp/xlog-frontend-complete-final-results.json
npx vitest run --maxWorkers=1 --testTimeout=15000 tests/live-app.test.tsx
npm run build
```

The native catalogue repeat used `XLOG_PORTABLE_ONLY=1 swift test --skip-build
--build-system xcode --jobs 2 --scratch-path .build/prototype-tests --filter
PythonCatalogueReadinessTests` after the initial compiled test had passed.
The matrix renderer takes saved UI/native/Python/append evidence paths; on a new
machine run those gates and provide their paths rather than treating absent local
logs as fresh acceptance.
