# OM0RX-xLog — unified N1MM Next Level master plan

**Reconciled: 27 October 2026 (Australia/Darwin).** This is the single planning entry point for the retained unfinished work and the next-level contesting roadmap. It combines the **33 consolidation work owners (NL-01–NL-33)** with **all 24 original roadmap packages (W01–W24)**. These are cross-linked views of overlapping scope, **not 57 independent projects or 57 confirmed defects**.

The user's present request is to preserve all unfinished work in the plan. This update changes documentation only: it does not start the roadmap, enable CW, authorize production mutation, run sync/uploads, acquire audio/radio resources or replace the installed application.

## Read first

1. This file owns current status, priority, overlap, dependencies and closure decisions.
2. [N1MM Next Level execution specification](02_N1MM_NEXT_LEVEL_WORK_PACKAGES.md) retains W01–W24 behavior and A01–A77 acceptance obligations from the supplied 26 October programme. Read the selected package before implementing it; do not start all packages at once.
3. [Historical open-evidence register](01_CONSOLIDATION_OPEN_EVIDENCE_2026-10-27.md) retains the detailed historical criteria and source locations under the NL owners. It is a reconciliation queue, not proof that every old failure still exists.
4. [Consolidation record](../CONSOLIDATION_2026-10-27.md), [machine-readable receipt](CONSOLIDATION_2026-10-27_RECEIPT.json), [94-definition matrix](../contesting/ALL_CONTESTS_READINESS.md), [remaining-limits acceptance](../contesting/REMAINING_LIMITS_ACCEPTANCE_2026-10-26.md) and [1.3.36 release](../MACOS_1_3_36_RELEASE_2026-10-26.md) provide current scoped evidence. Existing evidence remains authoritative within its stated limits.

**Do not repeat consolidation or rebuild accepted features.** First compare the selected requirement with current HEAD once. Reuse later accepted implementations, cite their evidence and work only on the remaining delta.

## Canonical baseline and completed work

- Completed consolidation is committed at `4fa1968221db1113ce1b6737f8c151dc6cddece4`. The reported canonical checkout was clean and synchronized with origin/main at that point. Publishing this documentation advances remote main; the next local task must fetch/pull fast-forward-only rather than assuming its checkout is already synchronized.
- The consolidation began at `03cf98ef78675901cf1ca96c0ddfb4190b6538a9`. It reported no open GitHub PRs/issues and no other active xLog task at its final inventory. That is a dated snapshot, not perpetual permission to overwrite future task work.
- Accepted application remains signed **1.3.36**, implementation source `079570505b06f0a5aba403aa6105909148652c91`, installed at `/Applications/OM0RX-xLog.app`. Documentation HEAD is not executable provenance. No application source, installation, version, radio setting or production data is changed by this planning update.
- Accepted work includes all-catalogue host/lifecycle fixes, admitted incremental-score equivalence, scoped Analytics, durable sync-run/local-change receipts, deferred cosmetic spot retirement and queued workspace switching, two-radio settings, Recorder/playback fixes, Log Review search/explicit corrections, contest timer, Show Yes/No filters, map sizing/labels/propagation spacing, and shared Classic/Modern cluster appearance. Preserve each feature's original source, package, installed and physical acceptance boundary.
- `codex/cluster-classic-appearance` at `3fae3c4e` is already integrated by equivalent patch `28f69e5d`; the consolidation's `git cherry` found it applied. Do not apply it again.
- Existing CW milestones through `53049081` are included with CW Decode disabled. Later `codex/cw-skimmer` tip `3a28134caa6c6c981c5f2a564fa22a69d1bc7778` is preserved but **unfinished/unqualified and excluded from the accepted application**. Do not merge or enable it merely to make every branch an ancestor of main.
- The consolidation reports fresh 4,529 Vitest plus two Node tests, 408 Python tests, 889 Rust unit plus 26 integration cases, portable Swift gates, eight exact packaged-worker cases and 44 exact packaged-Python cases. Six intentional Swift skips retain their reasons. These are existing reported results, not newly rerun tests in this documentation update; overlapping counts must not be summed into invented coverage.

The three reported matching application copies are the installed bundle, canonical staged bundle, and known-good 1.3.36 recovery bundle. Matching copies protect recovery of this accepted version; they do not establish a different older version or qualification of excluded features.

## Provenance and precedence of this reconciliation

The consolidation created an 18,275-byte planning register because the earlier master was not found in the inspected repository/Downloads inventory. The full earlier programme was nevertheless retained in the user's ChatGPT deliverables. This update restores its W01–W24 execution scope alongside the existing register rather than replacing or renumbering NL-01–NL-33.

Source inputs:

| Input | Exact identity | How it is used |
| --- | --- | --- |
| Consolidated repository master | `4fa1968221db1113ce1b6737f8c151dc6cddece4`, prior blob `0d7b7dc6f177468c1cd086846f4dc2d0ff056df4` | Preserve all 33 owners, source references, dependencies, closure criteria and recovery identities. |
| Consolidation report | Same commit, `docs/CONSOLIDATION_2026-10-27.md`, blob `a76dbfadbb184eea3c29a6bf2b722910882a26cd` | Accepted baseline, fresh test scopes, preserved work, cleanup/recovery and explicit remaining limitations. |
| Historical register | Same commit, blob `12656d165bab9ffbc2d5670c14c7e48aa1d50c46` | Existing detailed trail; not rewritten or treated as new defects. |
| Original N1MM Next Level master | User-supplied 26 October Markdown; SHA-256 `1dd6aec6e4f270b950426fb62ea89fc52d6f7a9f540d25e66b6cf4813ada1d90` | Full programme scope and work-package/acceptance IDs, carried into the linked execution specification. |
| Older code-comparison baseline | `36e4cfdfa19853b376151dad1f16b4659e5d2879`, documentation refresh `e1f023f111194d2c19590f254e9166c6bf1b0e6b` | Historical observations behind W requirements. Newer exact-source accepted behavior supersedes older absence/limitation statements. |

No fresh Mac, source-bundle, installed-app or hardware verification is claimed by this reconciliation. Local stash/ref inventories and preservation tests are the consolidation owner's reported evidence. The linked specifications describe intended remaining behavior, not newly discovered current bugs.

## Status, ownership and closure rules

P0 protects data/control integrity. P1 closes a known defect, acceptance blocker or selected high-value operating feature. P2 is a bounded enhancement/remaining acceptance. P3 is deferred or specialist scope.

- `OPEN`: a recorded requirement is not yet closed. It may require implementation, acceptance or both; read its criterion.
- `BLOCKED`: a stated dependency prevents closure. Record the dependency, keep restrictions intact and continue independent safe work.
- `DEFERRED`: retained scope, not rejected scope and not permission to start now.
- `RECONCILE`: compare an older marker with later evidence before deciding whether work still exists. It is not a current defect verdict.
- `PLANNED EXTENSION`: W package has retained new scope; verify newer implementation once before coding.
- `PARTIAL / REUSE`: relevant accepted implementation already exists; complete the specific extension or qualification only.
- `ACCEPTED`: cite the exact source and actual runtime/fixture, with package/installed/provider evidence where the claim needs it. Not-applicable dimensions are not failed tasks.

The NL rows are deduplicated **workstream owners**, not named human assignees. Before implementation, assign the active Codex task/branch and shared-file responsibility. W rows organize product delivery and reference NL child obligations; never create a second implementation owner for the same underlying requirement.

Keep code completion separate from sponsor-rule verification, native installed behavior, live account integration, physical station acceptance and platform acceptance. A fixture pass never closes a physical gate. A hardware gate need not block unrelated software work. Do not change an accepted restriction into a feature or a failure just to simplify a status report.

## Carry-forward work — all 33 retained owners

The original IDs and substantive criteria are preserved below. Use their child matrices/ledgers for individual definitions and historical markers.

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

### Preserve child scope; do not hide it inside broad labels

- **NL-01–05:** retain the entire per-definition matrix, F01–F33 and individual category/reference/export limits. Current reported 93 core passes must not become 94 merely because CQWS loads. The analytics inventories are separate: 79 credited acquisition profiles; 89 reconciled histories with AADX CW/SSB unverified; finite Needed 39 scoped passes / 28 not applicable / 27 unverified; analytical candidate Needed 79 unverified / 15 not applicable. Counts describe the recorded source snapshot, not permanent future targets.
- **NL-06–10:** one existing CW programme, unchanged two-span/32-track launch commitment. Capacity, actual Flex, actual TCI, corpus/false-spot quality, lifecycle/soak and exact package/action acceptance are separate gates. A successful synthetic decode does not close them together. Keep CW disabled.
- **NL-11–12:** retain recording input/permission, actual RX/TX/operator-ear coverage, route loss, long capture, recovery and replay separation individually. Accepted speaker playback is not complete capture coverage; independent/direct inputs remain deferred.
- **NL-13 / NL-16–18:** preserve individual radio/keyer/PTT/abort, digital-engine, dual-radio, rotor, Agent conditional-write and amplifier-drive restoration checks. These are not a single generic “hardware tested” checkbox.
- **NL-19–22:** each cloud/FTP-family/log-upload/confirmation provider needs its own contract, credentials, actual outcome, uncertainty and restore/retention applicability. Read-only lookup acceptance, QSO upload, confirmation download and backup restore are different capabilities.
- **NL-27:** retain six separate deferred children: split presets/readback; scratch contacts with deliberate promotion; immutable activation-session history; passive self-RBN analysis; private journal/attachments/QSL-card lifecycle; satellite/VHF editor. None is automatically delivered by a similarly named contest roadmap panel.
- **NL-28:** preserve later multi-op/network acceptance without reopening the already settled decision to add contesting. W15 extends existing authority; it is not a second networking engine.
- **NL-29:** macOS clean-machine/notarization, Intel application execution and Windows/Linux package/device/runtime acceptance are separate. Respect the earlier user-directed macOS focus; do not start all-platform packaging because the backlog retains it.
- **NL-31:** the old stash needs semantic comparison, not automatic application. Superseded source is preserved evidence, not mandatory new code.
- **NL-32:** historical attribution remains an explicit unknown, not a recoverable defect to “fix” by inference. Future journal behavior can be accepted with trustworthy new receipts; that cannot retrospectively certify the unknown run. Close prospective criteria separately while retaining the historical limitation.
- **NL-33:** enumerate the relevant programme/reference/lookup feeds in the existing child record, with source licensing, dates, freshness, last-good cache and offline behavior. Do not label all providers accepted after checking one.

## Original N1MM Next Level roadmap — all packages retained and mapped

The full execution requirements for these rows are in [W01–W24 specifications](02_N1MM_NEXT_LEVEL_WORK_PACKAGES.md). The table below owns their current disposition and overlap. “Planned” does not mean a current bug, an approved new deadline or an instruction to start everything. No feature was implemented by this planning reconciliation.

| Package / priority | Current disposition and remaining deliverable | Existing owner overlap — do not duplicate | Dependencies / closure evidence |
| --- | --- | --- | --- |
| W01 / P0 foundation | PARTIAL / REUSE: existing readiness/setup plus operator-facing capabilities, edition/example exchange, isolated Practice copy and preflight. | NL-01, NL-05, NL-23, NL-33 | Current descriptors/identities and verified edition sources; A01–A03. Preserve partial-score restrictions. |
| W02 / P1 | PLANNED EXTENSION: manual Call Stack/On Deck, swap/park, receipt-safe Log-and-next, then late-bound ESM/macro integration. | Existing Entry/host/receipt owners; no duplicate NL-28 engine task. | W01 identities; W05 only for macro stage; A04–A07. No serial allocation/pop before correct commit boundary. |
| W03 / P1 | PLANNED EXTENSION: family-aware reverse history and Visible Dupesheet using existing SCP/log authority. | NL-05 and NL-25 where corresponding history/presentation criteria overlap. | Existing assistance, field roles and current duplicate scope; A08–A10. Unknown/history suggestions never overwrite heard exchange. |
| W04 / P1 | PLANNED EXTENSION: durable UTC skeds, return contacts and explicit-action reminders, then station routing. | NL-25 reminder children; W15 for later directed multi-op assignment. | Existing draft/spot/station actions; A11–A13. Notification alone cannot tune or log. |
| W05 / P1 | PARTIAL / REUSE: existing macros/voice owners plus explicit dialect import, no-output preview, profiles and controlled next-call binding. | NL-13 for real output acceptance, not a second voice system. | Existing typed owners; W02/W11 for their action tokens; A14–A17. Unsupported raw actions stay blocked. |
| W06 / P1 | PARTIAL / REUSE: accepted Log Review/correction plus whole-log queries/sort, stable notes and reviewable edit deltas where not already delivered. | NL-23, NL-25. | Existing query/mutation/audit owner; A18–A20. Do not reimplement current search/explicit callsign edits. |
| W07 / P1 | RECONCILE / EXTEND: deleted-contact restore and independent recoverability, reusing any sufficient current stream/backups. | NL-19, NL-20, NL-23, NL-26. | Existing transaction/audit/outbox; A21–A23. No fabricated SQLite-to-file atomicity or production restore. |
| W08 / P1 | PARTIAL / REUSE: existing export/import primitives plus family-aware general imports, submission preflight and immutable final archive; native N1MM migration later. | NL-05, NL-23; NL-30 only for separately verified foreign-format compatibility. | W01/W06/W07 as needed; A24–A27. Preserve historical serial/identity and exact export contents. |
| W09 / P1–P2 | PARTIAL / REUSE: current spot/multiplier services plus coherent opportunities, Move Multipliers and deliberate planning states. | NL-03, NL-04, NL-14, NL-25. | Existing candidate authority; W04 for reminders; A28–A30. Unknown exchange/conditional score is explicit. |
| W10 / P1–P2 | PARTIAL / REUSE: accepted timer plus verified category off-time/allowance/band-change rules and operator plans. | NL-05, NL-25; not a repeat timer implementation. | W01 rule profile; W11/W15 where scoped by lane/station; A31–A33. Inactivity is not automatically qualifying off-time. |
| W11 / P2 | PLANNED EXTENSION: true independently drafted SO2V/SO2R lanes with shared log/serial authority and explicit RX/TX/split context. | NL-13, NL-16, NL-17, NL-27 split child, NL-28. | Existing radio owners, W01/W05; A34–A38. Two settings slots alone do not close independent operating-lane acceptance. |
| W12 / P2 | PARTIAL / REUSE: working CW keyer/ESM plus capability-dependent corrected-call, sent/unsent state and opt-in early-send. | NL-13; distinct from disabled CW receive NL-06–10. | Existing output owner, W05, W11 for other lane; A39–A41. No claimed character cancellation for whole-string-only providers. |
| W13 / P2–P3 | PARTIAL / REUSE: existing WSJT/fldigi ingress plus instance-scoped decode/reply and deliberate exchange/grab workflows. | NL-13, NL-21 where an actual external-provider dependency applies. | Existing external-engine owners; W02/W11 for queues/lanes; A42–A45. External event deduplication is not contest-dupe suppression. |
| W14 / P3 | PLANNED specialist: first-class WAE/QTC batches, partial completion, eligibility, output and exports. | NL-05/NL-28 retain scope, not falsely complete from generic serial logging. | Verified official edition, W01/W05 and chosen output; A46–A48. QTCs are not fake QSOs. |
| W15 / P2–P3 | PARTIAL / REUSE: current authoritative multi-op plus station dashboard, directed passes, helper proposals and operator handover. | NL-13 and NL-28 own physical/deployment qualification. | Existing authority; W04/W09/W11 as used; A49–A52. No second protocol or automatic split-brain winner. |
| W16 / P2–P3 | BLOCKED / EXTEND existing programme: qualify retained CW source, then reuse it for spectrum/decoded-call operating views. | **NL-06–10 are the sole qualification owners.** | Unchanged capacity/provider/corpus/lifecycle gates; A53–A55. Do not commission another decoder or enable a failed gate. |
| W17 / P3 | PARTIAL / EXTEND: preserve VHF/grid/EDI; add immutable rover sites, grid/beacon views and capable RF/IF transverter mapping. | NL-05, NL-13, NL-17, NL-27 satellite/VHF child. | W01/W11 identities and provider limits; A56–A58. Current site must not rewrite historical contacts. |
| W18 / P3 | PLANNED ecosystem: developer template kit, fixtures/manifests and explicitly limited UDC translation into existing plugins. | NL-05 for readiness/rules; NL-30 for license-sensitive source reuse only. | Current registry/trust/version model; A59–A60. No second engine or arbitrary live downloaded Python. |
| W19 / P2 | PARTIAL / REUSE: accepted Analytics plus missing profiles, measured operating intervals, truthful attribution and read-only adjudication learning. | **NL-02–04 own analytical gaps**; NL-26 performance; NL-32 historical attribution remains unknown. | Existing Analytics; W10/W11 for actual intervals; A61–A63. Do not recreate timelines/pivots/Recorder links. |
| W20 / P2 | PARTIAL / REUSE: current telemetry/RTC/bridges plus exact field/identity semantics and selected real-consumer qualification. | NL-13, NL-21–22, NL-28 only for their respective external boundaries. | Existing committed-event/output owners; A64–A65. UDP send is not remote persistence/submission. |
| W21 / P1 | PARTIAL / REUSE: accepted appearance/radio setup plus named operator profiles, richer bounded shortcuts and accessible layouts/help. | NL-15, NL-16, NL-25, NL-31. | Existing preferences/receipts; A66–A68. Do not apply retired settings semantics or reset custom bindings. |
| W22 / P0 foundation, P2 polish | PARTIAL / REUSE: pinned references plus visible provenance, rule edition and explicit assistance-category boundaries. | NL-05, NL-23, NL-24, NL-33. | W01/current references; A69–A70. Fixture success is not rule currency or station permission. |
| W23 / P1 | PARTIAL / REUSE: complete Recorder input/coverage/recovery assurance, not another recorder. | **NL-11 owns current assurance; NL-12 retains deferred inputs.** | Existing recorder/device/output owners; A71–A73. Accepted playback does not close RX/TX/operator-ear capture. |
| W24 / P0 cross-cutting | CONTINUOUS acceptance: actual-path rehearsal, measured load and uniquely identified releases for changed features. | NL-15, NL-26, NL-29 and applicable feature-specific gates. | Selected changed paths only; A74–A77. Preserve completed test evidence and do not repeatedly package minor edits. |

### Overlap rules

- An AADX correction belongs to NL-02 under W19, not two separate implementations.
- CW qualification belongs to NL-06–10 under W16; spectrum work cannot redefine or bypass the original programme gates.
- Recorder coverage belongs to NL-11 under W23. W23 does not automatically authorize NL-12 direct/independent audio expansion.
- Accepted normal Log Review and contest timer stay accepted. W06 and W10 describe remaining different behavior and require a one-time delta check.
- W11 operating lanes are new scope beyond accepted radio settings. Hardware acceptance remains separately owned and cannot be inferred from a two-panel UI.
- Historical R01–R24 enhancement IDs, F01–F33 port IDs, NL owners, W packages and A scenarios are separate namespaces. Keep existing IDs; do not rename or overwrite their evidence to make a single flattened count.

## Execution order after the next explicit implementation instruction

**This planning update starts no wave.** The next instruction should name a bounded outcome. A task blocked on hardware/account authorization must record the missing prerequisite and continue independent authorized software work instead of waiting or lowering the gate.

| Track / checkpoint | Included scope | Exit condition |
| --- | --- | --- |
| 0 — One baseline reconciliation | Fetch/pull current main; current-source delta, preserved work, selected NL/W/A IDs and shared-file ownership. | Short existing-status update. No new architecture plan, no repeated whole-repository audit. |
| Existing correctness/qualification | Select NL-01 and any demonstrated data/control blocker first; pursue independent analytical/restore/provider work only under its actual scope. | Focused corrected behavior and honest residual gates. Not all 33 owners must finish before useful features can proceed. |
| Wave 1 — Operator productivity | W01 minimum practice/preflight; W02 manual stack and confirmed Log-and-next; suitable W03 reverse lookup; W06 full-log sort/notes; W08 submission preflight; relevant W21/W24. | One usable actual Python-backed desk journey, disposable logging/notes/export, latency/failure/recovery checks and exact-source evidence. |
| Wave 2 — Strategy/messages | W04 skeds, W09 opportunities/moves, W10 verified rules timers, W05 preview/import/profiles and selected W19 gaps. | Boundary/unknown-data/timing cases and usable nonautonomous workflows. |
| Wave 3 — Two-radio depth | W11 staged lanes, selected W12/W05, W21 focus and W23 route assurance. | Two fake-provider lanes before separately authorized hardware/output checks. |
| Wave 4 — Connected operation | W13 digital, W15 multi-op dashboard, W16 existing CW qualification and W20 interoperability. | Relevant real protocols plus separate authorized external-engine/two-machine/radio gates. No disabled-feature bypass. |
| Wave 5 — Specialist/ecosystem | W14 QTC, W17 rover/transverter, W18 kits/limited converter, advanced W08/W19. | Independently expected rule/export fixtures and scoped usable workflows. |
| Continuous safeguards | W07/W22/W23/W24 and affected NL recovery/data/platform requirements. | Proportionate changed-path protection; a demonstrated data-loss issue is never postponed for a cosmetic feature wave. |

### Implementation cadence

- Keep one implementation owner for each shared file/service and a named task for every selected NL/W item. Parallel workers need nonoverlapping ownership.
- Preserve the canonical repository workflow, unrelated changes, seven stashes, nine recovery refs and CW worktree. No blanket clean, hard reset, forced merge or automatic stash application.
- Use current owners, fixtures and caches. Test the fragile boundary and meaningful current UI/native/Python journey, not duplicate source-string assertions across many suites.
- Run focused checks during coherent batches. Run broad relevant release gates at the milestone, then one candidate when needed. Do not sign/install/version-bump after minor headings or documentation changes.
- Package only from authorized canonical clean source. Different executable candidates require distinct versions and exact source/package receipts. Installation needs existing explicit permission, fresh appropriate backup and safe idle handling.
- Protect all production records and historical exchanges. Use disposable/copy-based tests. No automatic rescore, migration, submission, account write, RF/PTT/rotor/audio activity or previously disabled capture.
- Stop after the selected wave's closeout. Keep unselected scope in the plan rather than starting another compatibility expansion automatically.

## Historical evidence coverage — retain, reconcile, do not inflate

The consolidation records **643 distinct historical markers from 834 occurrences across 208 documents**. All remain in the existing [child register](01_CONSOLIDATION_OPEN_EVIDENCE_2026-10-27.md), with source locations and mapped NL owners. No marker is removed or asserted fixed by this planning edit.

Those numbers are historical inventory, not a claim of 643 current defects. The 94-row readiness matrix, F01–F33 ledger, current release receipts and preserved CW gate documents keep their finer-grained scope. A source marker is resolved by attaching later exact-source evidence, or by retaining its genuinely unfinished criterion under the existing owner. Merely finding the words “done” or a large passing suite does not establish that criterion.

Current counts in the matrix are snapshots: compare by definition/dimension identity, not by trying to maintain a headline percentage. If new source adds a definition or new official evidence changes a rule profile, update the relevant child inventory with the actual source; do not silently rewrite historical reports.

## Source preservation and recovery

The following is the **reported consolidation inventory**, retained verbatim in identity and substantive disposition. This documentation task did not access the Mac, verify a local private bundle or alter any ref/stash/worktree. Stable recovery refs remain meaningful even if stash numbering later changes. A TODO is not a source backup.

| Recovery ref suffix under `refs/recovery/consolidation-20261027/` | Exact object | Disposition |
| --- | --- | --- |
| `cw-skimmer` | `3a28134caa6c6c981c5f2a564fa22a69d1bc7778` | Keep source/worktree and origin branch; NL-06–10 / W16. |
| `classic-integrated` | `3fae3c4e0b87f46337f98f81d25e99375076317c` | Already-equivalent accepted patch. The disposable worktree was removed by the recorded consolidation; do not reapply the patch. |
| `stash-0-678beec8` | `678beec871217607e5e61202fb2ea6d92490869a` | Analytics checkpoint superseded by `75f73548`/`783e1253`; retain original files/tests. |
| `stash-1-b2c85bc1` | `b2c85bc1f92aecc71def6cda8bfebc8f9cf98bb9` | Earlier same analytics checkpoint; retain, do not duplicate newer implementation. |
| `stash-2-2afc5889` | `2afc5889937d02495d74342581cb15f939c784af` | PDF review images; historical evidence retained. |
| `stash-3-848d46b1` | `848d46b13b983ffd103ddf7292ce33f2c5c20bb7` | Recorder review images/scripts; historical evidence retained. |
| `stash-4-b93b0fa0` | `b93b0fa0fee397ace95f82cc13eed9e8fb6f33f8` | Retired settings experiment; NL-31, not an automatic patch. |
| `stash-5-a7c3dfa7` | `a7c3dfa7f36f67589a9f84fa87405ecbc91dfee3` | Original recorder checkpoint including untracked implementation; later accepted recorder is canonical. |
| `stash-6-07afdd21` | `07afdd217bf83afcd8dfbebcd566f2f474ccb185` | Early Classic draft; newer accepted shared preference is canonical. |

Reported verified private source backup:
`/Users/oliver/Documents/Backups/OM0RX-xLog/Consolidation-20261027/all-source-and-stashes.bundle`

Size: **49,181,199 bytes**. SHA-256: `ccb4db92a6e8593cd017fc47fb736d2618c43b7a39c42255466581bb92fe9e02`.
The consolidation records passing `git bundle verify`, named-ref verification, directory mode 700 and bundle/receipt mode 600. It includes stash third-parent untracked source/tests/evidence. Recovery should inspect the named ref in a separate recovery directory, not apply old settings or stashes blindly over main.

The retained CW worktree includes a `prototype/node_modules` dependency symlink and its owned build state. No CW source/worktree/runtime/model dependency or qualification evidence is disposable under this update.

Application/recovery paths recorded by consolidation:

| Role | Path |
| --- | --- |
| Installed accepted 1.3.36 | `/Applications/OM0RX-xLog.app` |
| Known-good 1.3.36 recovery bundle | `/Users/oliver/Documents/Projects/OM0RX-xLog/.build/releases/1.3.36/OM0RX-xLog.app` |
| Canonical staged signed bundle | `/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app` |
| Historical five-root pre-install data backup | `/Users/oliver/Documents/Backups/OM0RX-xLog/Mode-fix-1.3.36-before-install-20261026T230936+0930` |

The source bundle is not a production-database backup. The historical data backup must not be described as a fresh snapshot or restored over newer user data. No new cleanup or restore follows from retaining these paths in the plan.

## Definition of done and closure record

For every selected NL/W item, update this plan or its already owning child ledger with:

| Field | Required evidence |
| --- | --- |
| Identity | NL owner, W package, relevant A scenario/child marker and actual definition/provider/platform scope. |
| Ownership | Active task/branch and shared-service responsibility; coordination with other ongoing work. |
| Source | Implementing commit(s), current baseline and whether changes are actually integrated. |
| Verification | Exact relevant test/runtime/fixture and outcome; failed/partial/skipped results preserved. |
| Delivery | Package/installed source and version where needed; no inference from a generic suite or label. |
| External boundary | Actual device/account/network/platform test, or the exact unperformed/blocked step. |
| Data preservation | Disposable test scope and protection of completed logs, references, settings, recordings and serial history. |
| Remaining work | Explicit residual criterion/dependency, next responsible owner and restriction; no silent removal of deferred scope. |

Close only the demonstrated scope. Code present, catalog registered, generic smoke passed, test doubles successful, UI controls rendered, and physical operation accepted are distinct statements. Never close a protected-provider gate through an unapproved real action or resolve historical uncertainty by invention.

## Short restart instruction for Codex

> Fetch/pull canonical main fast-forward-only and read this master plus the selected W specification. Preserve the accepted 1.3.36 baseline and all unique recovery work. Reconcile the selected NL/W scope once, reuse completed behavior, implement only the next authorized bounded wave, and close items with exact-source current-path evidence. Keep blocked hardware/provider work explicit and continue independent authorized software tasks. Do not repeat consolidation, enable CW, mutate production data or expand into every roadmap package automatically.

## Documentation-only completion note

This reconciliation preserves every NL-01–NL-33 owner and recovery object, restores an explicit W01–W24 scope/acceptance reference, adds the overlap and execution rules, and leaves the historical evidence register unchanged. The original detailed 26 October comparison remains a retained source, not a competing current-status authority. No application implementation, test rerun, local cleanup, installation, sync/upload or station action was performed for this planning update.
