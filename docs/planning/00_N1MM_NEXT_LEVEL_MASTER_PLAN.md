# N1MM Next Level master plan

Consolidation checkpoint: **27 October 2026 (Australia/Darwin)**. This is the
repository planning entry point. No earlier file with this name was found in
the repository or the inspected Downloads inventory; historical plans remain
in place and retain their original evidence. This update authorizes no roadmap
implementation, feature enablement, production mutation, sync/upload or RF work.

## Canonical baseline and completed work

- Canonical source before this documentation update: `main` / `origin/main`
  `03cf98ef78675901cf1ca96c0ddfb4190b6538a9`, fetched and pulled fast-forward-only,
  with a clean working tree. No open GitHub PRs or issues were returned.
- Identifiable accepted application: signed **1.3.36**, source
  `079570505b06f0a5aba403aa6105909148652c91`, installed at
  `/Applications/OM0RX-xLog.app`. Subsequent main changes are release documentation.
  See [release evidence](../MACOS_1_3_36_RELEASE_2026-10-26.md) and
  [consolidation receipt](../CONSOLIDATION_2026-10-27.md).
- Included: all-catalogue host/lifecycle fixes, incremental-score equivalence,
  scoped analytics, durable sync-run/local-change receipts, deferred cosmetic
  spot retirement and queued workspace switching, two-radio settings, recorder
  and playback fixes, Log Review search/explicit corrections, contest timer,
  Show Yes/No filters, map sizing/labels/propagation spacing, and shared
  Classic/Modern cluster appearance. Each retains its original acceptance scope.
- `codex/cluster-classic-appearance` at `3fae3c4e` is already integrated by the
  equivalent patch `28f69e5d`; `git cherry` reports it applied. Do not merge it again.
- Existing CW milestones through `53049081` are in main with CW Decode disabled.
  The later `codex/cw-skimmer` tip `3a28134c` is **unfinished and unqualified**;
  it is deliberately excluded from the accepted application.

## Status and closure rules

P0 protects data/control integrity; P1 closes a known defect or an acceptance
blocker; P2 is a bounded enhancement/remaining acceptance; P3 is deferred scope.
`OPEN`, `BLOCKED`, `DEFERRED` and `RECONCILE` never mean accepted. `RECONCILE`
requires comparing the historical item with later owning-source evidence before
deciding whether additional work is needed. A passing fixture does not close
hardware, live account, supported-platform or installed-package acceptance.

The rows below are the deduplicated work owners. The linked per-definition matrix,
F01–F33 ledger, CW gate documents and legacy evidence register are their child
items, rather than new competing tasks. Closure must cite exact source, test
dataset/runtime and any necessary operator acceptance; preserve failed runs.

## Carry-forward work

| ID | Status / priority | Source branch or commit; evidence | Dependencies | Completion criteria |
| --- | --- | --- | --- | --- |
| NL-01 | OPEN / P1 | main `514a043a`, `75f73548`; [94-definition matrix](../contesting/ALL_CONTESTS_READINESS.md) | Authoritative CQWS federal-unit rules/reference and synthetic fixtures | Resolve CQWS UF scoring with exact expected totals and export/RTC tests; retain partial/unverified status until then. No completed-log rescore. |
| NL-02 | OPEN / P2 | main `75f73548`, `783e1253`; [remaining limits](../contesting/REMAINING_LIMITS_ACCEPTANCE_2026-10-26.md) | Definition-specific analytics contracts | Close AADX CW/SSB reconciled score history with meaningful correction/deletion fixtures; retain explicit unavailability meanwhile. |
| NL-03 | OPEN / P2 | Same source and per-definition matrix as NL-02 | Reviewed eligibility lists, finite universes, exact stored-reference compatibility | Address each of 27 unverified finite Needed profiles/dimensions; do not turn open-ended identities into fabricated totals. Preserve 39 scoped passes / 28 not applicable. |
| NL-04 | OPEN / P2 | main `75f73548`; 79 candidate-Needed profiles unverified | Fresh candidate exchange/spot context and NL-03 where finite | Implement/verify only knowable candidate evidence; keep 15 not-applicable profiles separate, unknown exchange unknown, and independent duplicate results available. |
| NL-05 | RECONCILE / P2 | main; [F01–F33 port plan](../CONTESTING_PORT_PROJECT_PLAN_2026-10-17.md), [acceptance ledger](../contesting/contest-acceptance-ledger.json) | Current 94-definition matrix and declared category/rule editions | Give every remaining F-row/category/current-rule/export/assistance requirement a current evidence-backed disposition. Historical 16-plugin activation counts are superseded; do not reopen the accepted 93 scoped core passes without contrary evidence. |
| NL-06 | BLOCKED / P1 | `codex/cw-skimmer` `3a28134c`, `f8920742`, `b304bb14`, `82776235`; branch `docs/cw/SIGNAL_DIAGNOSTICS.md` | Controlled CPU profile, same full two-span/32-track launch scope | Eliminate strict-load inference coalescing/backlog without weakening criteria. Latest replay decoded all 32 tracks but coalesced 13 jobs; capacity remains false. Preserve FIR improvement and attribution evidence. |
| NL-07 | BLOCKED / P1 | Same CW branch; `c398f5a3`, `1938556a`; `docs/cw/FLEX_PASSIVE_INSPECTION_2026-10-26.md` | Reachable physical Flex, authorized bounded observation/acquisition | Verify physical identity, receive-state fix on hardware, one/two IQ spans, packet continuity, RF orientation/width and LAN/VPN behavior. Latest TCP attempt failed; no inferred RX acceptance. |
| NL-08 | BLOCKED / P1 | Same CW branch; `docs/cw/FLEX_IQ.md`, `SOURCE_LIFECYCLE.md`, `IMPLEMENTATION.md` | Real SunSDR2 DX/ExpertSDR3, authorized captures, checked corpus | Qualify both TCI receivers, real packets/RF mapping, TX quarantine, sleep/wake, reconnect, loss and lease-scoped recovery. No reduced launch scope is accepted. |
| NL-09 | BLOCKED / P1 | Same CW branch; `docs/cw/SPOT_OUTPUT.md`, `NATIVE_REPLAY.md` | Consented real IQ, independent whole-call labels, NL-06–08 | Produce held-out quality/false-spot calibration and mapping acceptance. Automatic local CW spots and production quality remain disabled until gates pass. |
| NL-10 | OPEN / P1 | CW branch `3a28134c`, `7872428f`, `38a4a104`, `f31aa963`; `docs/cw/TRACK_SELECTION.md` | NL-06–09, reviewed integration with latest main | Verify exact-package crash/restart, durable callsign/Tune receipts, later operator edits, external logger, cancellation and long soak. Integrate only reviewed complete slices with restrictions intact, then uniquely version/sign/package; no automatic enablement. |
| NL-11 | OPEN / P1 | main recorder source; [recorder plan/status](../contest-recorder/IMPLEMENTATION_PLAN.md), [1.3.32 listening](../MACOS_1_3_32_RELEASE_2026-10-26.md) | Explicit operator routing/audio acceptance | Reconcile M0–M4 with later recorded QSO-link and speaker evidence; accept actual input/RX/TX-monitor/operator-ear coverage, permissions, route loss and long capture/recovery. Earlier “audio disconnected / NOT READY” is historical, not a new blanket failure. |
| NL-12 | DEFERRED / P3 | main; recorder M5 plan | NL-11 and separately agreed scope | Independent inputs and direct TCI/Flex/DAX/remote audio need a bounded design and source/package/hardware evidence before claiming support. |
| NL-13 | OPEN / P1 | main `b17ad0f4`, `ba53ca7d`, `db1641a2`; [remaining limits](../contesting/REMAINING_LIMITS_ACCEPTANCE_2026-10-26.md) | Explicit hardware/output authorization and disposable operating context | Accept physical CW/keyer, voice/PTT abort, FLdigi/WSJT-X engines, two-radio routing and rotor behavior. Simulator/dummy/transport results do not establish RF acceptance. |
| NL-14 | OPEN / P2 | main fresh-receipt handover through `db1641a2`; [1.3.34](../MACOS_1_3_34_RELEASE_2026-10-26.md) | Authorized remote-provider observation | Verify deferred remote-marker removal/TTL and ambiguous receipt recovery. Both live workspace switch directions are already accepted; cosmetic cleanup must not become a new switch blocker. |
| NL-15 | RECONCILE / P2 | main `03cf98ef`; [cluster acceptance](../CLUSTER_MAPS_CLEANUP_ACCEPTANCE_2026-10-26.md), legacy UI rows | Existing production-component geometry proof | Remaining installed DXpedition/propagation geometry, compact/large/mixed-DPI/multi-display, keyboard/focus and accessibility checks need exact-package evidence. Preserve accepted cluster visibility, labels and Classic/Modern controls. |
| NL-16 | OPEN / P2 | main; [radio settings](../RADIO_SETTINGS_IMPLEMENTATION_2026-10-26.md), legacy RADIO-05 | Real supported radios; existing single Session owner | Accept physical per-provider save/connect/routing and Agent restart repetition; Clear after QSY remains opt-in/default off. Hardware-profile apply needs Agent config revision/ETag plus conditional writes. |
| NL-17 | DEFERRED / P3 | main; [station platform plan](../LOCAL_STATION_CROSS_PLATFORM_PLAN.md), radio settings boundaries | Separate contracts and credentials | Flex discovery/SmartLink, generic authenticated vendor Ethernet/Icom server, CI-V override and broader CAT interoperability remain separate scope; selected model labels are not physical identity proof. |
| NL-18 | OPEN / P1 | External Windows Agent `67d2902` follow-up; [Windows drive rollback](../WINDOWS_AGENT_DRIVE_ROLLBACK_SOURCE_FIX_2026-10-15.md) | Windows Agent source/deployment ownership and authorized hardware | Verify installed Windows rollback, KAT fault/HTTP 502 handling and exact pre-Operate/barefoot-drive restoration; retain uncertain rollback evidence. |
| NL-19 | OPEN / P2 | main `762f44d`, `0dfefc5`; [remote-backup foundation](../REMOTE_BACKUP_FROZEN_PLAN_ACCEPTANCE_2026-10-15.md) | Provider registration/OAuth and explicit account/restore authorization | Accept production Dropbox/Drive/OneDrive upload/verification/retention/exact-revision restore, installed presentation and cloud conditional deletion. Preserve protected backups; no production restore in this consolidation. |
| NL-20 | OPEN / P2 | main `edd3182`, `762f44d`, `f533cde`; FTP/FTPS and SFTP acceptance docs | Scoped trusted-CA interface, host-key-pinned transport design | Finish trusted-certificate FTPS and SFTP backend/vault/UI/transport/restore acceptance; configuration-only SFTP is not an implemented transfer client. |
| NL-21 | OPEN / P2 | main; [QRZ](../QRZ_UPLOAD_FOUNDATION_ACCEPTANCE_2026-10-15.md), [Club Log](../CLUB_LOG_UPLOAD_FOUNDATION_ACCEPTANCE_2026-10-15.md), [HRDLOG](../HRDLOG_CONTRACT_REVIEW_2026-10-15.md) | Explicit live-account authorization; official HRDLOG response/idempotency contract | Accept QRZ/Club Log provider outcomes and uncertainty review; implement HRDLOG only after verified contract. No existing contacts/imports may auto-enroll. |
| NL-22 | OPEN / P2 | main `8a45a73`; enhancement R08 | Redirect-disabled streaming, revision-fenced confirmation-only apply | Finish direct LoTW transport/apply/package/provider gates; TQSL upload and eQSL remain separately scoped. Retain unknown match/age and no downgrade/outbox semantics. |
| NL-23 | OPEN / P2 | main `429dcae`, `8934ab6`; enhancement R01/R03/R04/R10/R11 | Current field-preservation owner and disposable copied logs | Finish ADIF conformance/legacy-encoding audit, package data-impact/edit/undo roundtrips and isolated migration trial. CTY correction apply/undo must be explicit/reversible; no bulk production correction. Log Review's existing explicit callsign fix is already delivered. |
| NL-24 | OPEN / P2 | main `6d9b186`, `92cf23f`; enhancement R07/R09 | Dated sponsor rules and authoritative applicant/evidence scope | Complete executable QRP-DXCC/sponsor rules/application exports, provider timestamps and acceptance semantics. Stored candidate DXCCs or confirmations are not sponsor-issued credit. |
| NL-25 | RECONCILE / P2 | main `52010e3`, `2f00a55`, `c27dec8`; enhancement R05/R06/R15/R16/R20 | NL-15; retained canonical projections | Close exact-package visual/recovery/export-chooser acceptance for opportunities, previous QSOs, saved filters, diagnostics, station identity/alerts/antenna/propagation children. Timezone reminders remain explicit opt-in work. |
| NL-26 | OPEN / P2 | main `cb5d450`; enhancement R17 | Synthetic data, isolated restores and machine/package receipts | Add one-million-contact, memory-pressure/contention/cancellation/kill/restart/outage/restore and cold-disk performance evidence. Preserve existing 100,002-contact percentile acceptance. |
| NL-27 | DEFERRED / P3 | main; enhancement R12/R13/R14/R18/R21/R22 | Separate bounded owner-safe designs | Carry split presets/readback, scratch contacts with explicit promotion, immutable activation sessions, passive self-RBN analysis, private journal/attachments/QSL-card lifecycle and satellite/VHF editor forward individually. No auto RF, automatic promotion or implicit sync/export. |
| NL-28 | DEFERRED / P3 | main; enhancement R19/R23 and F01–F33 | NL-13 and explicit contest/network topology | R23's “decide whether contesting exists” is superseded by accepted contest delivery. Remaining voice/output physical acceptance belongs to NL-13; true Multi-Multi topology, networking/recovery and new N1MM roadmap scope require separate acceptance. |
| NL-29 | OPEN / P2 | main `07957050`; [release](../MACOS_1_3_36_RELEASE_2026-10-26.md), R24 | Mac acceptance and exact platform builds | Notarization/current clean-machine, Intel app execution and current Windows/Linux package/runtime/device/window/recovery acceptance remain open. Universal Swift worker does not prove Intel app support. Older cross-platform receipts remain historical. |
| NL-30 | BLOCKED / P3 | main; [OpsLog source audit](../OPSLOG_REFERENCE_AUDIT_2026-10-16.md) | Authenticated source access and license clarification | Verify source/license before any reuse; behavior research cannot establish code or product parity. RUMlog `.rlog`/Automation compatibility is separately unverified. |
| NL-31 | RECONCILE / P2 | Recovery settings stash `b93b0fa0`; main `integrationSettings` / `applyIntegrationSettings` | Existing receipt/CAS/restore owner | Compare residual draft semantics with current implementation and retain only a demonstrated missing behavior. Do not apply old settings APIs over newer transactional receipts. Other stash work is historical/review evidence, not a release blocker. |
| NL-32 | OPEN / P2 | main sync receipts `9e5fd2b4`; [remaining-limits history](../contesting/REMAINING_LIMITS_ACCEPTANCE_2026-10-26.md) | Future trustworthy durable run receipts | Historical 1.3.32 per-run uploads/local-change attribution remains unknown and cannot be retroactively reconstructed. Preserve that uncertainty; future runs must retain transaction-owned counts. No new sync test is authorized here. |
| NL-33 | RECONCILE / P2 | main `03cf98ef`; [historical roadmap](../../ROADMAP.md), `ReferenceDataUpdater` / activation directories | Official programme feeds, licensing/redistribution, current cached-source owner | Reconcile implemented caches with every POTA/SOTA/IOTA/WWFF/enabled-castle requirement, then close remaining official-data/current-package/live-provider acceptance, freshness/version/last-good recovery and offline nonblocking behavior. Include QRZ/HamQTH/reference lookup account acceptance without conflating it with upload support. |

## Source preservation and recovery

Recovery refs are stable even if stash numbering changes. All original stashes
remain. The private bundle includes **all refs and stash third-parent untracked
trees**, including review images/scripts; a TODO is not their backup.

| Recovery ref suffix under `refs/recovery/consolidation-20261027/` | Exact object | Disposition |
| --- | --- | --- |
| `cw-skimmer` | `3a28134caa6c6c981c5f2a564fa22a69d1bc7778` | Keep source/worktree; origin branch also preserves it; NL-06–10. |
| `classic-integrated` | `3fae3c4e0b87f46337f98f81d25e99375076317c` | Already-equivalent accepted patch; disposable worktree eligible for retirement. |
| `stash-0-678beec8` | `678beec871217607e5e61202fb2ea6d92490869a` | Analytics checkpoint superseded by `75f73548`/`783e1253`; retain original files/tests. |
| `stash-1-b2c85bc1` | `b2c85bc1f92aecc71def6cda8bfebc8f9cf98bb9` | Earlier same analytics checkpoint; retain, do not duplicate newer implementation. |
| `stash-2-2afc5889` | `2afc5889937d02495d74342581cb15f939c784af` | PDF review images; historical evidence retained. |
| `stash-3-848d46b1` | `848d46b13b983ffd103ddf7292ce33f2c5c20bb7` | Recorder review images/scripts; historical evidence retained. |
| `stash-4-b93b0fa0` | `b93b0fa0fee397ace95f82cc13eed9e8fb6f33f8` | Retired settings experiment; NL-31. |
| `stash-5-a7c3dfa7` | `a7c3dfa7f36f67589a9f84fa87405ecbc91dfee3` | Original recorder checkpoint, including untracked implementation; later accepted recorder is canonical. |
| `stash-6-07afdd21` | `07afdd217bf83afcd8dfbebcd566f2f474ccb185` | Early Classic draft; newer accepted shared preference is canonical. |

Verified private source backup:
`/Users/oliver/Documents/Backups/OM0RX-xLog/Consolidation-20261027/all-source-and-stashes.bundle`
(49,181,199 bytes; SHA-256
`ccb4db92a6e8593cd017fc47fb736d2618c43b7a39c42255466581bb92fe9e02`).
`git bundle verify` and its named-ref inventory passed. The backup directory is
mode 700, bundle/receipt mode 600. To recover, clone the bundle into a separate
directory and fetch the named recovery ref; do not apply a stash over main blindly.

The retained CW worktree has an untracked `prototype/node_modules` dependency
symlink in addition to ignored build state; it is retained with its ownership.
No CW source, worktree, runtime/model dependency or evidence is disposable here.

## Historical evidence and next action

The [open-evidence register](01_CONSOLIDATION_OPEN_EVIDENCE_2026-10-27.md)
retains exact source lines from older programme/acceptance documents, maps each to
the owners above, and marks unresolved historical claims for reconciliation.
Those records are evidence, not new feature authorization or proof that an old
failure still exists. The 94-row matrix supplies individual analytics/category
limits; the CW branch supplies its full gate/implementation details. Historical
reports and source remain intact.

The one-time consolidation ends with its verification/cleanup receipt. Start no
new N1MM roadmap stage until the operator gives the next instruction.
