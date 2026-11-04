# OM0RX-xLog TLF Contesting Enhancement Master Plan

**Version:** 1.0  
**Owner:** Oliver / OM0RX  
**Prepared:** 3 November 2026, Australia/Darwin  
**Repository:** https://github.com/oliverbross/OM0RX-xLog  
**Purpose:** Implement the selected TLF-inspired operating improvements through the existing xLog architecture, in the three phases approved by Oliver.

**Planning baseline:** xLog main at f15dbb11eb727419689869f8f4907ed9b4809970, rechecked during preparation; TLF master at b44403bfb2c5d54a2be13ba7aa901c839ea6622d. These are evidence snapshots, not instructions to reset or check out old code.

**Initial delivery status:** Planned at preparation; superseded by the execution evidence below.

**Correction pass — 4 November 2026:** Started from clean canonical `main` at
`5016751a03f2adc6eea27def34ed4675e6bdc67a`, current after fast-forward-only pull.
The retained [independent review](../reviews/OM0RX-xLog_TLF_1.5.7_Review_2026-11-04.md)
reopens TLF-R01–R09 and their affected software claims below. Earlier successful
evidence remains historical evidence; it does not close these failed subcases.
P1-05/06/09/10, P2-01/02/04/06, P3-02/03/05/06/07 and R-01/02 are IN_PROGRESS
for this correction. Affected scenarios: OK-02/05/07/08/09; CW-04/07/12/17;
PASS-05/08/11; QTC-02/04/11/15; RULE-03/04/05/06/08; G-04/06.
Their earlier VERIFIED_SOFTWARE/PASS labels are reopened for these subcases until
specific corrective evidence is recorded here. No installation, RF transmission,
physical CAT action or submission is authorised by this correction pass.

### Correction evidence (this register remains authoritative)

**TLF-R06 / P2-04; QTC-11/15 — VERIFIED_SOFTWARE:** RTTY no-source K1ABC
previously hid valid receiving. The additive schema-1 `capabilities.send/receive`
projection now exposes independent eligibility/source capacity; overall opportunity
is either direction, with one shared ten-item quota. Strict frontend validation and
labels accept old frames and explain both new directions. Actual-Host non-European
receive/no-source, European send/source and quota exhaustion tests passed with
unchanged CW/SSB cases (`test_tlf_qtc_operating test_wave5_qtc_host`: 12).
`contestQTCOpportunities.test.tsx`: 4 passed. Displaying remains read-only.
Retained WAE §7/§12 and exact source digest verified; no reservation/output implied.

**TLF-R04 / P3-05/06; RULE-03/04/08 — VERIFIED_SOFTWARE:**
the duplicate K1ABC/zone-4 changed eligibility from 14:12 to 14:20. Guidance now
uses the same historical duplicate authority as the Host's log projection before
accumulating new country/zone facts. The duplicate remains a `non-credit-contact`
event without replacing 14:12; a valid same-country zero-point new multiplier
starts its clock. Actual Host commit, source-digest declarations, correction and
rebuild are covered in `test_wave2_operating_host`. Retained CQ WW rules/FAQ bytes
were digest-verified and the functional/whole-minute clauses reread. Focused
`test_operating_rules test_wave2_operating_host` passed (18). No RF clock claim.

**TLF-R09 / P1-05/06; CW-04/07/12/17, G-04 — VERIFIED_SOFTWARE:**
the old persisted WinKeyer queue receipt omitted OM0RX after restart. Suppression
now requires a live native-authored continuation bound to a unique native owner,
lease epoch, provider identity/generation, draft, stream, finish operation and
current Host process epoch. Restart with the same old admission/generation and
missing/changed continuation recovers the full call; native refuses suppressed
output with no continuation. Ordinary provider-accepted partial correction remains.
`test_tlf_cw_host` passed (10); `cargo test --locked --manifest-path prototype/src-tauri/Cargo.toml --bin xlog-prototype cw_session::tests::`
passed (35). The first native control fixture changed streaming capability after
arming and correctly lost its lease; it was corrected to Stop/re-arm before
testing uninterrupted continuation. Physical WinKeyer/RF qualification remains open.

| Finding / acceptance | Failed reproduction → corrected result | Corrective evidence / remaining boundary |
| --- | --- | --- |
| TLF-R01; P1-09/10; OK-05/08/09 | Mixed 20M/40M gave 18 for 20M → 6; ALL remains 18, both export rows retained | `python/tests/test_okom_host.py`, `test_single_band_claim_switch_edit_rebuild_restart_and_cross_check_export`; category/edit/rebuild/restart/export passed. Native confirmation pending. |
| TLF-R02; P1-09/10; OK-07/08/09 | Outside-period rows scored and occupied credit → zero credit, valid later contact scores | Same suite, `test_period_boundaries_and_outside_row_cannot_consume_duplicate_credit`; exact start/last second/end, raw times and rebuild/export passed. No database-wide rescore: explicitly use the existing per-contest Recalculate for retained pre-correction points/flags; edition and sent snapshots unchanged. |
| TLF-R03; P1-09/10; OK-02/09 | TWO accepted without IDs/supported scope → new TWO setup refused, historical TWO score marked incomplete and Cabrillo blocked | Same suite, `test_mo2t_is_explicitly_unavailable_without_fabricating_historical_attribution`; SO/MOST export retained. **OPEN / contained:** OK/OM serial owner is chronological contest-wide; lane/Run1Run2 defaults are not actual per-QSO transmitter declarations. Real transmitter attribution plus per-band/per-transmitter serial ownership still required for MO2T. No historical ID fabrication or renumbering. |

| TLF-R05; P3-02/03/07; PASS-05/08/11, G-04/06 | K1ABC 589/001 returned as 599/002 → original Host draft/reservation and full fields restored, incoming DL1ABC logs 002 | `contestCallStack.host.test.ts` uses the real protocol Host + production controller; lost park reply, same-operation replay, Host/controller restart, incoming commit, resume and original commit pass; no duplicate logging or resume allocation. Unavailable old reservation refuses unchanged. Replica parking is explicitly unavailable, with no offline serial allocation. Native rehearsal pending. |

R05 command: `XLOG_TEST_PYTHON=/opt/local/bin/python3.12 npm --prefix prototype run test:vitest -- src/contesting/contestCallStack.test.ts src/contesting/contestCallStack.host.test.ts` → PASS (24 tests); TypeScript `tsc --noEmit` passed. Initial fixture used a symlinked macOS temporary root and an incorrect expectation that the pinned plugin's numeric NR remained a string; corrected fixture uses canonical root and asserts raw draft `007` separately from logged numeric 7. No production fallback or GUI binding occurred.

Command: `PYTHONPATH=python:python/tests /opt/local/bin/python3.12 -m unittest test_okom_host` → PASS (14 tests).
Initial test attempts exposed unavailable system Python 3.9, a test transaction
commit omission, a generic matrix query's single-band parameter mismatch and a
historical duplicate proxy that did not restrict multi-row queries. Corrected;
the final focused command above passed. Tool policy rejected inline Python and
unittest's short `-p` spelling before execution; the normal module command uses
the existing Python 3.12 interpreter. No station/native output was used.

**Delivery checkpoint — 4 November 2026:** All three selected phases have committed software implementations on canonical `main`. Signed macOS arm64 candidate **1.5.7** is built from `4de56b1aeaa1fad93309b0d9a2cc382c04c994da` (product source `1cf9a145a9191be845c159a7ec8cde38169cf0a8`). Software tests and bounded disposable native checks are recorded in section 14. Full native pass park/load/tune, physical adapter/route qualification and installation are not claimed. Flex advanced CW remains unimplemented; the real advanced production adapter is WinKeyer. WPX 2027 has no verified profile because official publication was unavailable. No simulator was added. The installed 1.5.6 app and production data were not changed by this work.

## 1. Approved scope and sequencing

This is one master plan with a common task register, acceptance catalogue and source map. Its phases share CW output, contest transaction ownership, radio bindings and operator controls; separate independent plans would duplicate those contracts. Keep the execution prompt as a launcher for this plan, not as a second specification.

| Original comparison item | Approved feature | Delivery phase |
| --- | --- | --- |
| 1 | Different CW speeds within one message, with an accurate transmission preview | Phase 1 |
| 2 | Optional early-start CW while the callsign is still being typed | Phase 1 |
| 5 | OK/OM DX CW contest definition | Phase 1 |
| 6 | Optional partial corrected-callsign resend before TU | Phase 1 |
| 4 | Live WAE QTC operating workflow, QTC band-map opportunities and recorder integration | Phase 2 |
| 7 | Complete directed station passes with frequency/mode and explicit recipient actions | Phase 3 |
| 8 | Broader edition-specific operating-time and band-change guidance | Phase 3 |
| 3 | Generated-caller contest simulator | **Excluded. Do not implement it or add it to a later phase.** |

Preserve the existing isolated Practice feature without extending it. Preserve all unrelated existing logging, contesting, digital, audio, station and export functionality.

### 1.1 What execution is authorised to do

Implement this selected roadmap in order: Phase 1, then Phase 2, then Phase 3. Phase reviews are engineering checkpoints, not new permission requests. Continue automatically when the applicable prerequisites pass. If one provider, physical qualification or authoritative rule source is unavailable, record the precise blocked component and continue independent authorised work; do not label the blocked component complete or hold the entire programme idle.

Use current repository instructions for working-tree ownership, commits, pushes, packaging and release provenance. Historical stop notes in previous acceptance documents describe those earlier tasks; they do not cancel this newly selected roadmap. They also do not authorise unrelated unfinished roadmaps.

Physical station actions, production installation, account/provider writes and log submission must use the actual authorisation already present in the executing session. Do not infer permission for live RF or external submissions merely from a request to implement software. Complete source, deterministic tests, disposable native checks and reviewable candidates before raising a genuinely missing operational approval. Never ask for permission again when it has already been given.

### 1.2 Explicit exclusions

- No simulator or generated callers; no separate training application.
- No TLF executable, C runtime, ncurses interface, rule-file interpreter or second scoring engine.
- No rewrite of the current Not1MM/Python integration, window system, cluster, recorder, voice keyer or network authority.
- No new CW decoder, IQ transport, remote-desktop system or digital modem engine.
- No automatic master failover, offline shared-serial allocation or new LAN/WAN trust model.
- No wholesale remapping of operator keys, deletion of existing macros or replacement of normal logging workflows.
- No unrequested bulk rescoring, serial renumbering, contact migration, public spotting or automatic contest-log submission.
- No copying old contest constants into a new edition without current organiser evidence.

## 2. Current implementation and the actual gaps

The source registry has 97 definitions: the original 94 plus WAE CW, SSB and RTTY. That count includes mode variants and utilities; it is not 97 distinct contest events. Source implementation and physical station qualification are different evidence levels.

| Area | Existing implementation to reuse | Selected increment |
| --- | --- | --- |
| Contest authority | Pinned Python/Not1MM plugins, xLog host extensions, durable SQLite operations and serial ownership | Extend these owners; retain one authority |
| CW messages | Run/S&P F1–F12, message banks, import/preview, global speed, RST and serial cut formatting | Typed speed segments and a preview of the actual provider-ready sequence |
| CW sending | Native owner renders complete text; correction state explicitly has earlySend=false and incrementalCancellation=false | Provider-backed early-start session, append/cancel semantics and truthful progress |
| Corrected calls | Automatic full-call correction already exists in inspected CW plugins | Optional component-aware partial correction with full-call fallback |
| OK/OM catalogue | OK1WC Memorial exists; OK/OM DX CW is absent | New reviewed definition with domestic and DX entrant branches |
| WAE QTC | Eligibility, quotas, reserved sources, durable series, confirmations, resume, scoring and Cabrillo | Keyboard operating desk and real output dispatch; do not rebuild accounting |
| QTC repeat | Current qtc_repeat records repeat metadata only | Explicit field/header/row transmission or request through existing output services |
| QTC UI integration | ContestQTC uses savePlanning; that path returns waveResult without dispatching radio output | Owner-level dispatcher that actually claims and submits QTC output |
| Band maps | Shared spots, local heard/marked state, worked/multiplier navigation | WAE-specific QTC opportunity status derived from the existing journal |
| Recorder | Capture, bookmarks, replay, recovery and archive export | Typed QTC series/item markers and direct review links |
| Multi-op | Authority/replica protocol, shared serials, duplicate queries, contact changes, presence and chat | Complete directed-pass payload and recipient actions |
| Directed-pass UI | Sends frequencyHz=0 and an empty mode; acknowledgment is the only recipient action | Capture actual values; separate acknowledgment, load and tune |
| Operating rules | Two explicit WPX 2026 profiles, with log-derived and physical evidence kept separate | Finite additional rule profiles and usable counters/clock guidance |

Relevant implementation evidence is linked in section 15. Do not infer an absent feature from an old README or a previous review. Reconcile the current implementation before changing it.

### 2.1 CW provider baseline that must shape Phase 1

The existing public feature flags are not proof that a provider supports the new behaviour. The inspected provider stack imposes material constraints:

| Path | Inspected baseline | Required investigation/change |
| --- | --- | --- |
| Flex CWX | Complete-message send/clear and WPM control exist; the inspected CWX status handling does not establish per-character progress | Establish documented command ordering, append behaviour, queue/stop semantics, speed-change boundary and what telemetry actually proves |
| WinKeyer path | Current ownership/admission expects fresh idle state for send; character echoes are not used as progress; speed changes are restricted to idle | Extend the existing owner/adapter deliberately if chosen; do not bypass its ownership checks |
| Direct TCI | Current direct session provides bounded control/receive/spot functions; a CW_MACROS_EMPTY server event is not exposed as a qualified CW transmit/queue-completion contract | Do not advertise new CW capability simply because TCI is connected; a transmit adapter needs its own documented and tested implementation |
| Other outputs | No new capability is established by this plan | Preserve working whole-message behaviour; enable extensions only for specifically qualified adapters |

Prioritise the Flex path used by Oliver if the protocol supports the required guarantees. Select a different existing path only on evidence and actual station availability; no hardware purchase is assumed. A fake provider or UI checkbox alone cannot satisfy items 1 or 2.

## 3. Architecture and preservation contracts

### 3.1 Ownership

The existing Python contest host remains authoritative for contest fields, duplicate policy, QSO creation/correction/deletion, serials, scoring and exports. Native xLog services remain authoritative for radio/keyer/voice/fldigi ownership and physical commands. Detached windows forward scoped intents to the current owner.

Extend the existing message compiler and output admission model. Do not execute imported macro control bytes, shell commands or arbitrary scripts. TLF is a behaviour reference. Any reused licensed source or data must retain its provenance and applicable notices through the repository's existing vendoring process.

### 3.2 Immutable operation context

Every output or radio action captures the applicable session, workspace generation, draft or QTC identity, lane, radio/VFO/slice binding, connection generation, message-bank revision and intended payload. Use the existing identity fields; introduce only missing ones.

A focus change does not transfer an in-flight action to another radio. A retry of the same durable operation returns its recorded result without producing another transmission, QSO, serial allocation or tune. A deliberate repeat is a new explicit action with a new identity and a link to the original content.

### 3.3 Distinct evidence states

Do not collapse these into one success flag:

1. Prepared locally.
2. Claimed/submitted to the native output owner.
3. Accepted or completed according to the provider's documented semantics.
4. RF progress or completion, only when the evidence actually establishes it.
5. Counterparty acknowledgment, explicitly entered by the operator.
6. Contest accounting committed.

Represent failed-before-dispatch, stopped and uncertain outcomes. Keep uncertainty durable enough to prevent accidental replay. Restart or reconnect never rearms output or automatically continues a partly sent callsign or QTC.

### 3.4 Stop, recovery and data retention

Stop uses the existing emergency output owner and keeps the entered callsign, exchange, reserved serial and QTC edits. Release/cancel must still be attempted if ancillary preference or journal writes fail. Persist the resulting uncertainty when possible; a failed persistence step must not falsely report a clean release.

Restore temporarily changed speed when that is safe and supported. If speed restoration or release cannot be confirmed at the appropriate provider level, expose the unresolved state and prevent an automatic following transmission. Never report RF proof from a simulated timer.

### 3.5 Existing sessions and migrations

Use additive, versioned changes under existing store/snapshot ownership. Before changing a schema, define a representative populated pre-change fixture and prove its contacts, serials, references, messages, QTC ledger and exports survive.

Old data must load with truthful unknown/default metadata. Never retroactively invent transmission success, acknowledgment, station frequency or a verified rule edition. Preserve original received exchanges and sent snapshots. Display cut numbers only in the send representation; do not rewrite raw logged values.

Historical scoring stays pinned. New definitions or corrected rules apply to new sessions by default; any existing-log transition uses a separately explicit previewed operation and preserves audit history. Application rollback after a schema change requires a compatible store or matched backup; replacing only the app is not automatically a valid data rollback.

### 3.6 Shared surfaces and concurrent work

Reuse current band-map, keybinding, message-bank, recorder, call-stack and station-control components. If another Codex task is working on QLog-derived filters/shortcuts/band maps or an existing contest roadmap, agree file ownership and integrate one shared implementation. Do not duplicate controls or reset unrelated work.

## 4. Task register and progress policy

Status vocabulary: NOT_STARTED, IN_PROGRESS, IMPLEMENTED, VERIFIED_SOFTWARE, VERIFIED_HARDWARE, BLOCKED, DONE. DONE requires the applicable acceptance evidence; it is not synonymous with a visible control or passing mock test. Record hardware qualification separately for each adapter/route. A phase can have software verified while required hardware acceptance remains open.

Each task update records commit, relevant acceptance IDs, actual command/result or native evidence, and remaining limitations. Preserve failed checks and their resolution. Do not add test counts from overlapping suites.

| Task | Work package | Depends on | Current status |
| --- | --- | --- | --- |
| F-01 | Reconcile current HEAD, instructions and existing work | None | DONE |
| F-02 | Freeze capability and owner contracts | F-01 | VERIFIED_SOFTWARE |
| F-03 | Preserve representative old-session fixtures and migration contracts | F-01 | VERIFIED_SOFTWARE |
| P1-01 | Qualify the initial CW adapter and operation model | F-02 | VERIFIED_SOFTWARE |
| P1-02 | Shared typed CW sequence compiler and accurate preview | P1-01 | VERIFIED_SOFTWARE |
| P1-03 | Native sequence execution, speed restoration and Stop | P1-01, P1-02 | VERIFIED_SOFTWARE |
| P1-04 | Message editing/import and normal workflow integration | P1-02, P1-03 | VERIFIED_SOFTWARE |
| P1-05 | Early-start callsign state and plugin ESM integration | P1-01, P1-02 | VERIFIED_SOFTWARE |
| P1-06 | Real adapter append/cancel and recovery | P1-03, P1-05 | VERIFIED_SOFTWARE |
| P1-07 | Partial corrected-call policy and conservative fallback | P1-02, P1-05 | VERIFIED_SOFTWARE |
| P1-08 | OK/OM organiser-rule and reference audit | F-01 | DONE |
| P1-09 | OK/OM definition and independent scoring fixtures | P1-08, F-03 | VERIFIED_SOFTWARE |
| P1-10 | OK/OM operator setup and export integration | P1-09 | VERIFIED_SOFTWARE |
| P1-11 | Phase 1 integration, capability presentation and documentation | P1-04, P1-06, P1-07, P1-10 | VERIFIED_SOFTWARE |
| P2-01 | QTC durable operating/output context | F-03; Phase 1 message contract | VERIFIED_SOFTWARE |
| P2-02 | Keyboard QTC send/receive desk | P2-01 | VERIFIED_SOFTWARE |
| P2-03 | Real QTC output dispatcher and mode routing | P2-01, P2-02; shared F-02/P1-02 contract and a qualified existing whole-message path or P1-03 | VERIFIED_SOFTWARE |
| P2-04 | QTC opportunities in shared band maps | P2-01 | VERIFIED_SOFTWARE |
| P2-05 | QTC recorder bookmarks and review links | P2-01 | VERIFIED_SOFTWARE |
| P2-06 | Phase 2 migration, export and operating rehearsal | P2-02, P2-03, P2-04, P2-05 | VERIFIED_SOFTWARE |
| P3-01 | Versioned complete pass payload and legacy reading | F-03 | VERIFIED_SOFTWARE |
| P3-02 | Explicit recipient load/tune/acknowledgment actions | P3-01 | VERIFIED_SOFTWARE |
| P3-03 | Pass lifecycle, retry and authority integration | P3-02 | VERIFIED_SOFTWARE |
| P3-04 | Freeze additional rule profiles and official sources | F-01 | VERIFIED_SOFTWARE |
| P3-05 | Edition/category calculators and observation contracts | P3-04 | VERIFIED_SOFTWARE |
| P3-06 | Operator clocks, counters and explanations | P3-05 | VERIFIED_SOFTWARE |
| P3-07 | Phase 3 boundary checks and multi-station rehearsal | P3-03, P3-06 | IMPLEMENTED |
| R-01 | Consolidated release evidence and operator instructions | All applicable phase checks | DONE |
| R-02 | Final delivery and any authorised installation verification | R-01 | DONE |

### F-01 — Reconcile, without restarting completed work

Read AGENTS.md and docs/DEVELOPMENT_WORKFLOW.md. Fetch current main and record HEAD, app version, working-tree state and other active owners. Use fast-forward-only updates when permitted by the working-tree state. Preserve user changes; never reset, force-push or absorb unrelated edits.

Read this plan and inspect the selected implementation paths. Reconcile current capability evidence against the baseline. Update the task register when a task has genuinely been delivered meanwhile, with exact evidence. Do not re-run an old comprehensive audit or revive previously repaired findings just because a historical document lists them.

### F-02 — Freeze only the contracts needed by this roadmap

Document the initial adapter, its protocol/version, supported complete/append/cancel/speed operations, ordering, queue limits, completion semantics and reconnect behaviour. Record what current telemetry cannot establish. Trace Python intent through native claim/admission to the actual adapter; code in an unused abstraction is not delivery.

Choose shared message/output and pass/QTC intent schemas compatible with current owners. Keep one implementation owner per shared file. Resolve routine design choices within the scope without seeking repeated approval.

### F-03 — Preserve data before migration work

Use disposable copies/fixtures covering a normal log, serial contest, saved message banks, two-lane contest, WAE series with pending and confirmed items, and an authority/client pair. Record stable identities and relevant export digests. Reuse existing fixtures where they already cover this data. Do not make a new full production backup for each small edit.

## 5. Phase 1 — CW operation and OK/OM DX CW

**Original items:** 1, 2, 5 and 6.  
**Outcome:** More capable CW messages and optional early-start/correction operation through a real adapter, plus a reviewed OK/OM DX CW definition.

CW work and the OK/OM rule/plugin work can proceed independently after F-01. Within CW, establish compiler/provider behaviour before wiring early-start controls. A blocked live adapter does not prevent the OK/OM implementation or non-transmitting UI/data work.

### P1-01 — Initial provider qualification

Inspect current Flex, WinKeyer, TCI and native CW owners. Use primary protocol documentation and the actual source to decide which existing adapter can first support the new sequence. Record a capability matrix, not a universal boolean.

Required capabilities are explicit ordering, bounded message/queue size, append admission where early-start is enabled, cancellation/release semantics and speed control at a defined boundary. Per-character RF proof is not mandatory if unavailable, but the UI must never invent it. If protocol capabilities are insufficient, retain whole-message operation and mark the selected enhancement blocked for that adapter; do not call a fallback its completion.

### P1-02 — Shared typed sequence and preview

Extend the existing compiler with typed text and speed segments, bounded values and deliberate reset-to-base behaviour. Syntax/UI choices may fit current conventions; raw provider commands in imported text remain disallowed.

Resolve each message from the captured contest action, raw exchange, serial, station call, full/partial correction policy, message-bank version and CW formatting preferences. Compile once for both preview and dispatch. A preview must not allocate a serial, mutate a draft, claim output or send anything.

Show the actual formatted text and speed sections for the selected adapter, including limits and unsupported controls. Keep a clearly labelled example preview when there is no live draft; do not present example serials as reserved values. Preserve the current RST and serial padding/substitution options.

### P1-03 — Sequence execution and restoration

Execute the compiled sequence under the existing output owner, with one captured lane/provider context. Account for whether the adapter applies speed changes when queued or when executed; a sleep based on estimated Morse duration is not proof of a safe device boundary.

Bound admission and backpressure, prevent interleaving by another lane, and retain the existing emergency Stop path. Normal completion, cancellation, provider error and reconnect must leave speed/ownership truthful. Do not silently send the remainder after a lost reply.

For an adapter without speed-segment support, explain the limitation and provide an explicit ordinary single-speed send option. Do not silently flatten a configured variable-speed message while displaying it as executed as previewed.

### P1-04 — Message-bank editor and import

Extend current banks and Run/S&P F-key messages. Provide per-segment speed editing, effective preview, clear base-speed restore and validation before activation. Preserve imported original text/dialect reports and old bank identifiers.

When an import contains unsupported controls, identify them and keep the draft reviewable; do not reinterpret raw plus/minus characters as hardware commands without a declared supported syntax. Saving/importing/previewing a bank does not activate output. Existing complete-message banks must still render identically.

### P1-05 — Early-start operator state and ESM

Add opt-in Run/CW early start with a manual-start alternative and a bounded configurable threshold. Default it off for old/new sessions until explicitly selected; absence of provider capability keeps it unavailable with a reason. Do not start on programme-driven field hydration, SCP selection, restored draft, paste, replayed operation or background updates unless the operator has deliberately initiated that action's documented start path.

Capture a per-draft transmission session. Distinguish editable/queued/accepted text and only the progress actually established by the provider. Show estimated progress as estimated. Define append, backspace/edit, completed call and exchange-transition actions.

Keep stable stream identity separate from evolving draft revision: session, draft identity, lane, binding and provider generation remain fixed while explicitly admitted same-stream typing revisions advance monotonically. The current native context-refresh path stops output when canonical context changes; adapt that boundary deliberately so ordinary accepted typing does not cancel its own stream. Unrelated draft, bank, lane or provider changes still invalidate the action. Test this through real host draft updates, not just an isolated append interface.

Preserve plugin ESM as the logging/next-message authority. Early transmission must not log, allocate an extra serial or cause the already-sent call prefix to be emitted again when the exchange action is generated. Suppress only the matching captured call segment; an intentional repeat or changed call remains a distinct action.

When a correction affects text already submitted, do not pretend it can be unsent. Stop/retain the draft and use a clearly defined full or partial correction path. Do not append to an obsolete provider generation or a newly focused lane.

### P1-06 — Real append/cancel path

Implement the chosen adapter contract end to end, including the current native admission gate that otherwise requires idle/full-message output. Extend ownership checks; do not disable them to allow appends.

Handle queue-full, slow typing, transmission catching up, shorter-than-threshold calls, unknown send outcome, Stop during append, delayed replies, session change and reconnect. A character may be submitted at most once for one action identity. Deliberate retransmission is separately identified.

No recovered early-start state may resume output automatically. Recover the operator's call/exchange and any uncertain attempt, with a fresh explicit start/repeat required.

### P1-07 — Partial corrected-call policy

Keep existing automatic full-call correction in the pinned plugins. Add an optional component-aware partial policy through the common action/formatting boundary where feasible, without creating a second ESM state machine.

Policy choices: full-call default; partial correction where unambiguous; manual behaviour if already supported. For the new partial policy, compare against the exact previous complete call accepted by the provider, tied to its output operation and without an intervening Stop or unresolved delivery outcome. A planned/captured call alone is insufficient: the existing host can persist esmCallSent while creating actions, before native dispatch succeeds. Planned-only, partial-stream or uncertain evidence uses the documented full-call recovery path. This evidence is not a claim of RF reception by the other station. Treat prefix, numeral, suffix and portable components deliberately. Ambiguous/multiple-component changes and missing evidence fall back to the full call.

Keep normal QSO fields, serials and logged full calls unchanged by formatting. A correction before TU must not resend the exchange or log twice. Existing plugin-specific ESM behaviour and user F-key roles remain intact. Preserve upstream source provenance if a plugin overlay is necessary.

### P1-08 — OK/OM rule and reference audit

Add OK/OM DX **CW**, distinct from OK1WC Memorial and from any separately governed phone contest. Before shipping scoring, retrieve the current official organiser rules applicable to the selected edition and the official district reference.

Record source URL, retrieved date, edition, retained evidence/digest, entrant branches, permitted bands/categories, sent/received exchange, scoring, multipliers, duplicate scope, maritime/portable treatment, serial policy and Cabrillo identity/fields.

TLF's implementation supplies examples, not rule authority. In particular, inspect its behaviour for an unrecognised OK/OM district and maritime-mobile multiplier treatment rather than copying it. Resolve those branches against official evidence and independent expected values.

If an official source cannot be obtained, complete the independent CW work and the contest integration skeleton, but keep the scoring definition explicitly unverified/unavailable for a claimed valid submission. Record the exact missing rule/reference; do not fill it from a calendar or guess. See section 15 for the research boundary.

### P1-09 — Definition and independent oracles

Implement within the existing Python host/plugin architecture and finite registry. Follow current new-definition/reference pinning and source-provenance mechanisms. Reuse shared services for CTY, fields, serial allocation, duplicates, multipliers, scoring, correction/deletion and restart.

Provide both OK/OM and DX entrant cases from the reviewed rules. The entrant comes from the station's explicit operating identity and pinned country facts, not a heuristic based on the person's home callsign. Build district validation and reference versioning without inventing fallback district multipliers.

Create small, independently calculated fixtures for each meaningful scoring branch and multiplier/duplicate boundary. TLF-vs-xLog agreement alone is not an oracle: both could share an error. Test rebuild/correction equivalence through existing mechanisms where this definition uses them.

### P1-10 — Operator setup and exports

Add the definition to the current catalogue, setup/readiness presentation, exchange hints, multiplier display, messages and export declarations. Reuse existing entry/window composition; no separate contest desk.

Validate required entrant exchange before logging. Reserve/retain serials through the existing authority where the rules require them. Preserve logged sent snapshots when station settings later change.

Verify actual Cabrillo bytes and ADIF fields for both entrant sides, mode, station identity, time, frequency, sent/received exchange and claimed totals. Organiser acceptance is not established merely because a file was written. Existing logs and other definitions remain unchanged.

### P1-11 — Phase integration and delivery

Run the relevant acceptance cases in section 10, one coherent native CW/operator rehearsal, and the existing affected build gates. Demonstrate the actual selected adapter path; distinguish source/loopback success from physical keying qualification.

Update user-facing macro/early-start/correction help and OK/OM setup guidance. Correct stale capability statements in the affected host README/readiness documentation, without rewriting unrelated history. Record exact source, candidate version if packaged, adapter capabilities and remaining qualifications.

**Phase 1 exit:** all four selected features have code, operator integration and applicable software evidence. Required real-adapter functionality is implemented; physical qualification is separately recorded. Missing rule authority or an unimplemented early-send adapter remains an open delivery item, not DONE. Continue independent Phase 2/3 work while an external qualification is blocked.

## 6. Phase 2 — Complete live WAE QTC operation

**Original item:** 4, including QTC opportunity markers and recorder links.  
**Outcome:** The operator can receive, send, request a repeat, confirm and resume a QTC series through a keyboard-oriented desk, with the existing accounting and outputs connected correctly.

CW and SSB are the primary operating targets. Preserve existing WAE RTTY accounting and export. Use an existing qualified fldigi output route for RTTY actions where available; do not add a new modem, bypass its current release restrictions or imply an unavailable route is working. Explicit manual operation must remain available in every supported mode. Track route-specific completion separately.

This phase consumes the shared message/output contracts from Phase 1 but does not require early-start transmission: complete QTC messages can use the existing whole-message path. Do not block the QTC desk on unrelated streaming-hardware qualification.

### P2-01 — Durable QTC operating and output context

Preserve the existing series journal, source reservations, immutable sent snapshots, confirmed flags, score and export policy. Capture selected series, item, field and target lane/binding under the existing transaction/receipt owner.

Add versioned supplemental operating/attempt metadata rather than redefining accounting status. An attempt identifies the operation/action, series/item/field, exact captured source version and payload/digest, lane/provider generation, request time and outcome. Local output success never means the receiving station acknowledged it.

Reuse current xlog_operation, xlog_output_claim and native output admission. The original receipt suppresses repeat effects. A deliberate field/row/header repeat creates a new action against the same immutable QTC content. Interrupted or uncertain transmission never restarts itself.

Migration detail: wae.mutate currently reconstructs the QTC object as schema 1 plus batches. New nested metadata would be lost if that writer remains unchanged. Use a small versioned sibling/table or update every writer coherently under the existing store contract. Old series receive unknown output history, not invented success. Malformed future data must not trigger a journal reset.

### P2-02 — Keyboard operating desk

Replace mandatory bulk-entry flow with a compact row/field editor; keep bulk paste as an optional convenience. Show counterpart, header, series count, direction, current item, pending/confirmed state and output status. Persist unfinished editing state without treating incomplete rows as scoring records.

Provide scoped commands for:

- Send/repeat header and current row.
- Request repeat of time, callsign, serial or the complete row.
- Acknowledge an item, move next/previous and complete the series.
- Interrupt/resume and return to ordinary Entry.

Use existing configurable keybinding facilities. Normal Entry ESM must not fire while the operator types into the QTC desk. Stop cancels output without wiping a series or its editing fields. A combined acknowledge-and-next key is allowed only because the operator explicitly invokes it, not because local playback ended.

Keep confirmed historical records immutable under their current correction policy. Retain original source snapshots and correspondence to exported entries. An interrupted received series must reopen at the intended unfinished item/field.

### P2-03 — Real owner-level output dispatcher

Connect QTC output to the actual station path. Adding actions to wae.py is insufficient: the current savePlanning callback used by ContestQTC consumes waveResult only. Add explicit output consumption/claim handling at the shared owner, leaving the presentation component free of direct CAT/audio ownership.

Build messages from the historical QTC item and header, not the mutable normal Entry or its currently reserved sent serial. Sending a QTC must not reserve another normal serial, clear Entry, log an ordinary QSO or change the selected contest.

Route CW through the existing native keyer owner; use managed voice recordings/fragments for applicable SSB prompts, with manual spoken operation retained. Use only the already admitted digital bridge for supported RTTY output. Missing voice fragments, mode mismatch, stale lane, changed binding or unavailable output are detected before PTT/dispatch where possible.

Capture one target for an action. Reject pre-dispatch context changes; an in-flight change invokes Stop/release and records stopped/uncertain outcome. A final QSL message, series completion and QTC accounting retain distinct receipts. Failure to send the final message does not secretly delete confirmed items.

### P2-04 — QTC opportunities in existing maps

Add contest-scoped counterpart observations such as unknown, available, later and unavailable/refused, with observation time and an optional explicit reminder. Keep these operator observations separate from rule-derived eligibility, confirmed counts, reserved sources and remaining capacity.

Project the existing WAE journal into shared band-map/spot annotations and a QTC-opportunities filter. A QSO dupe may still offer a QTC opportunity. Unknown eligibility/capability stays unknown. Do not free cancelled-but-reserved sources or double-count incoming/outgoing allowance against the current mode's rule contract.

A marker opens a reviewable QTC counterpart/series intent. It does not transmit, publish a spot, start recording or overwrite ordinary Entry. All windows read the same revisioned projection; do not implement scoring/quota calculations independently in React.

Integrate with any current shared band-map/filter work. Preserve non-WAE display, existing marks/needed-multiplier navigation and normal logging.

### P2-05 — Recorder integration

Extend existing bookmark/index metadata with typed QTC session, series, item and operation references anchored to actual captured samples. Mark series start/end/interruption and relevant item boundaries in an already running recording.

An explicit record control may invoke the existing Recorder setup/start flow. Merely opening QTC must not start an input device. Missing or failed capture must not block QTC entry/confirmation or fabricate audio coverage.

Provide a review link from the series/item to covered audio. Keep gaps, unavailable intervals, listening-device selection and playback/TX restrictions visible. Include the QTC bookmark index in the current archive/export model. Preserve originals and all old QSO/manual bookmarks.

### P2-06 — Integrated rehearsal and migration

Exercise complete keyboard receive/send/repeat/resume journeys, real native output consumption and the score/export consequences against disposable sessions. Include one populated pre-change WAE session, one partial series and one interrupted output action.

Verify actual exported QTC records and submission archive references. Use existing recorder fixtures and a bounded authorised native route check; do not create another audio test programme. Run the scenarios in section 11 and record route-specific software versus physical results.

**Phase 2 exit:** the QTC desk is connected to actual output services, preserves existing accounting and recovery, exposes QTC opportunities, and links to truthful recording coverage. A journal-only Repeat button is not completion. Unsupported physical routes remain explicitly identified; independent Phase 3 work can proceed.

## 7. Phase 3 — Directed passes and operating guidance

**Original items:** 7 and 8.  
**Outcome:** A station pass contains usable radio context and can be deliberately acted on, while additional contest profiles provide evidence-based operating clocks/counters.

The pass workflow and rule-profile work can proceed in parallel, with one integration owner for shared station/lane and Info/time surfaces.

### P3-01 — Complete, versioned pass payload

Extend current directed Pass/Helper composition and capture from active lane or selected spot. Include callsign, explicit integer-Hz frequency, mode, destination station/lane, origin, creation/observation UTC, note and stable message identity.

Specify RX/TX or single-frequency meaning; do not infer split settings from an ambiguous number. Show the captured values before Send. Reuse existing frequency/mode/contest-band validation.

Keep the original payload immutable. An updated or withdrawn proposal has a clear supersession/version relationship. Presence freshness does not refresh the age of the suggested frequency.

Legacy zero-frequency/empty-mode messages remain readable and acknowledgeable. Mark them incomplete for tuning rather than replacing missing values with the recipient's current frequency/mode. Ordinary Talk messages remain compatible and need not contain radio fields.

### P3-02 — Explicit recipient actions

Offer distinct Acknowledge, Load into addressed lane, Tune and Decline/Dismiss actions. Arrival/acknowledgment causes no Entry, tuning, transmit or log effect.

Route actions through the existing contest owner/surface protocol. Capture message ID/version, recipient identity, session/workspace, lane, draft/revision, receiver/VFO/slice binding and connection generation. Reject wrong-recipient, foreign-session, stale-version and retired-binding actions.

Never overwrite an occupied draft. Offer the existing Park current entry workflow and then an explicit load, preserving its serial and both records. Do not silently clear the other lane or substitute the active lane for the addressed lane.

Tune uses the existing station/TuneCoordinator path and current output/operation guards. It does not grant TX ownership, key a transmitter or log a QSO. Missing split data stays unknown. An aged frequency is visibly reviewed as an old suggestion; review does not establish that the other station is still there.

### P3-03 — Lifecycle, receipts and authority

Keep received, acknowledged, loaded, tune-requested, tune-confirmed where observable, declined, failed and uncertain states distinct. Associate them with the same message/version and explicit operation IDs.

Retries, duplicate network packets, reopened windows and restart must not repeat a load/tune automatically. Do not equate a queued CAT command with an observed frequency change. Preserve uncertain tune outcomes.

Retain current authority leases, replica restrictions, serial reservations and contact-replication invariants. No automatic authority promotion or offline serial allocation is introduced. Loading a proposal and physically tuning are separate actions; do not pretend they form one reversible database transaction.

Use the focused multi-station scenarios in section 12. Independent subsequent logging uses the ordinary contest commit and provenance path.

### P3-04 — Finite rule-profile scope and official evidence

Keep this phase bounded to the following families rather than all 97 definitions:

| Profile family | Required action | Evidence boundary |
| --- | --- | --- |
| WPX 2026 CW/SSB Single Operator and Multi-Single | Preserve and reconcile the existing profiles; improve presentation only where selected behaviour needs it | Existing profiles are not new work to claim again |
| CQ WW 2026 CW/SSB Multi-Single | Add separate Run and Multiplier 10-minute guidance with explicit role evidence | Official rules and FAQ establish the relevant clocks; missing signal-role evidence must remain visible |
| WAE 2026 CW/SSB Single Operator and Multi-Single | Add applicable time/band guidance after auditing the official edition's relevant sections | Recover/retrieve the official snapshot and verify those sections; current WAE scoring-source checks alone do not certify time/category rules |
| WPX 2027, publication-dependent candidate | Add only if the organiser has published the edition and its source diff has been reviewed; otherwise retain explicit no-verified-profile status | Never relabel 2026 constants as 2027 rules |
| Later CQ WW/WAE editions or additional categories | Versioning readiness only in this batch | Additional profile implementation requires a later scope decision |

At execution, check publication status for the named WPX 2027 candidate. Record the reviewed edition and reason for selecting it if it becomes implementable; preserve historical profiles and fixtures. A calendar rollover does not expand this finite profile set or authorise unsupported categories.

For each profile retain URL, edition, retrieval date, source digest, applicable start/end/category, rule references, interpretation and required input evidence. Distinguish official rules from FAQ interpretation. Unresolved source access blocks only that profile, with the exact missing section documented.

### P3-05 — Calculators and observation inputs

Extend the current finite operating_rules owner, keeping scoring independent. Calculate counters from ordered, revisioned source facts and derive them consistently after edit/delete/import/restart. Preserve explicit UTC semantics, category/overlay limits and out-of-period handling.

CQ WW Multi-Single needs separately attributed Run and Multiplier signals. A lane selection by itself is not proof of the physical signal role. Use verified configuration/attribution or a clearly labelled operator declaration; show unknown where role evidence is missing. Start the appropriate clock from the rule-defined event, not from a spot click or receiver tuning.

Follow the official FAQ's logged whole-minute precision and role-specific start event: first Run QSO or first new-multiplier QSO for the Multiplier role. For example, a QSO recorded as 14:00 gives a 14:10 log-checking boundary even if xLog retained seconds. A more conservative live countdown must identify its different basis. Retain offending/non-scoring contacts as evidence rather than filtering them away. For WAE, explicitly audit whether QTC send/receive activity affects an off period or band restriction and add a QTC-only boundary fixture using the existing journal; do not assume a QSO-only timeline is sufficient.

Keep observed radio activity, operator-declared breaks, log-derived gaps and calculated allowances distinct. If adding manual break/return markers, store them as declarations with timestamps and history; they are not proof of silence. A physical status feed must carry source, freshness and gap information.

Do not infer total compliance from incomplete observations or freeze the UI during scoring. Ordinary logging remains under the existing contest policy; advisory timing warnings must not prevent emergency Stop.

### P3-06 — Operator presentation

Extend the current Info/time view. Show the selected contest edition/category, source-backed limit, current counter/countdown, next applicable eligibility time and the evidence basis.

For supported profiles provide compact warnings approaching a boundary and explain why a result is unknown. Receiving/listening/tuning is distinct from transmitting where the rule makes that distinction. Do not imply a tune button is forbidden simply because the next transmit window has not arrived.

Keep configuration adoption explicit and revisioned; opening a view must not silently activate a profile or rescore a completed contest. Correctly restore the selected profile on restart without carrying it into an unrelated contest.

### P3-07 — Phase integration

Complete the pass and rule scenarios in sections 12 and 13. Use one authority/client rehearsal for network/lane boundaries and independent rule vectors at exact time boundaries. Confirm changes to logs update the projections correctly while old submitted snapshots remain immutable.

**Phase 3 exit:** selected pass actions work through the existing owners, and each required rule profile either has documented implementation/verification or a precise unresolved source/evidence blocker. Do not claim every contest or all operating compliance is certified.

## 8. Milestones, verification and release policy

### 8.1 Delivery milestones

| Milestone | Concrete reviewable result | Exit evidence |
| --- | --- | --- |
| M0 — Baseline and contracts | Current-HEAD reconciliation, scoped owner/capability decisions, representative migration fixtures | F-01–F-03 recorded; no unrelated changes absorbed |
| M1 — Phase 1 | Working CW compiler/provider path, opt-in early start, optional partial correction and reviewed OK/OM definition | Applicable G, CW and OK scenarios; adapter-specific hardware status stated separately |
| M2 — Phase 2 | Live QTC desk connected to real output, local QTC opportunities and recorder links | Applicable G and QTC scenarios; durable accounting/export preserved |
| M3 — Phase 3 | Complete directed passes and finite source-backed rule guidance | Applicable G, PASS and RULE scenarios; exact blocked profiles identified |
| M4 — Delivery | Updated master ledger, operator instructions, source/build provenance and remaining limitations | R-01–R-02; no unsupported claim of physical acceptance or installation |

Treat milestones as coherent engineering batches, not calendar promises. The principal uncertainties are protocol guarantees and physical access for advanced CW, access to the current OK/OM rule body/reference data, and verification of WAE timing clauses. Estimate implementation effort after M0 resolves those facts; do not manufacture dates from a source-only review.

Within Phase 1, CW and OK/OM work may run in parallel with explicit file ownership. Rule-source collection for Phase 3 may happen early, without bringing Phase 3 implementation ahead of the agreed sequence. If a particular item is blocked, continue the remaining Phase 1 work and then independent later-phase work, retaining the blocked item in the ledger. A software milestone with open physical checks must be labelled accordingly.

### 8.2 Proportional verification

The acceptance catalogue contains **72 behavioural scenarios**, not a requirement to create 72 new test files or run 72 full application sessions. Reuse existing tests and table-driven fixtures wherever they establish the intended behaviour. A scenario may require several meaningful assertions; one suitable test can cover related scenarios. Report actual evidence, not a target test count.

During a work package, run focused tests for the changed owner, meaningful edge cases and relevant regressions. Run the appropriate type, compile or lint checks when their inputs change. Use protocol doubles for deterministic failure/retry tests, with no transmitter keyed by CI.

At a phase milestone, run the broader affected suites and a native build when native paths changed. Use one disposable integration rehearsal for the combined behaviour, adding more only for a concrete unresolved risk. Do not run a complete test/build/sign/install cycle after every small edit, and do not repeat an unchanged passing gate merely to increase the evidence volume.

After the final implementation changes, verify the actual source revision that will be delivered. Reuse an already valid phase-milestone build if it matches that revision; if code changes afterwards, rerun only invalidated checks and rebuild where necessary. Documentation-only follow-ups should not trigger unrelated native rebuilding.

Physical qualification records the real adapter, device/firmware, binding, observed procedure, outcome and limits. A protocol fake proves software handling, not RF output. Where hardware is unavailable, deliver the reviewable code and record the exact remaining procedure rather than claiming it passed.

### R-01 — Consolidated release and operator documentation

Keep this master plan as the durable execution ledger. Add a concise operator guide under the repository's existing documentation structure covering:

- How to select and preview a message with speed changes, and which adapters support it.
- How to enable early start, the threshold/manual-start options, edits after submission and Stop/recovery.
- Full versus partial corrected-call behaviour and its fallback rules.
- OK/OM domestic versus DX setup, exchange validation and export checks.
- QTC desk keys, deliberate repeats, confirmation, opportunity markers and recorder navigation.
- Received pass actions, target-lane handling and stale-frequency review.
- Which rule editions/categories have guidance and the difference between logged, declared and observed evidence.

Update the existing capability documentation and any directly misleading setup/README statements encountered in these paths. Do not conduct a repository-wide prose rewrite. Preserve previous release evidence; create a new entry rather than relabelling an old hardware result.

Follow the current repository rules for logical commits, pushing, version/release notes and packaged-candidate version bumps. Record code revision, application version, test commands/results, build artifact identity and any hardware evidence. Do not create an extra permanent branch/PR workflow if the current repository explicitly uses canonical main; reconcile that policy at F-01.

### R-02 — Final delivery and any already-authorised installation

Deliver the committed changes, updated task/acceptance ledger and a concise account of what works, what was verified and what remains blocked. Include the exact next action needed for each blocker. Do not end with a generic offer to continue work that is already authorised and executable.

Build, package, sign or install only as required by the current repository workflow and actual session authorisation. If installation is authorised, verify the installed app's version and source provenance and perform the focused smoke check required by the changed paths. Do not infer installation from a successful build or signing command. Do not remove the user's logs, settings or installed working copy as a shortcut.

## 9. Shared acceptance — G

Apply these scenarios to the relevant changed owners across all phases. Initial evidence status was **NOT_RUN**; current per-scenario evidence is in section 14.5.

| ID | Scenario and required outcome |
| --- | --- |
| G-01 | Open representative populated pre-change stores. Contacts, serial reservations, message banks, QTC references and relevant export bytes survive the additive migration; newly unknown facts remain unknown. |
| G-02 | With new options off, normal QSO entry, existing ESM/F-key flow, SO1V, saved banks, digital/voice paths and current export behaviour retain their existing contracts. Cover affected paths, not every unrelated feature again. |
| G-03 | Main and detached surfaces address the same current owner. Wrong workspace/session/draft revision, target lane, receiver binding or connection generation is rejected without dispatching on a fallback radio. |
| G-04 | Duplicate requests, lost replies, renderer restart and reconnect do not repeat output, allocate a second serial, log twice, retune or silently resume an incomplete action. An intentional repeat uses a new explicit identity. |
| G-05 | Stop during a pending action still reaches the original output owner when ancillary persistence fails. Failure/uncertainty is visible; draft/QTC edits remain; no late callback resumes the tail. |
| G-06 | An authority/client partition or stale lease preserves existing write/serial restrictions. No new feature promotes a replica or invents offline shared serials. |
| G-07 | Untrusted or malformed macro, pass and QTC inputs are bounded and validated. They cannot inject provider commands, execute code or cross owner/binding boundaries. |
| G-08 | The final capability matrix, task status and release evidence match the delivered source/build. Unavailable adapters, unverified profiles and pending hardware work are stated precisely; no simulator or unrelated engine has been introduced. |

## 10. Phase 1 acceptance — CW and OK/OM

### 10.1 CW scenarios

| ID | Scenario and required outcome |
| --- | --- |
| CW-01 | Load an existing CW contest and banks with the new options off. Existing complete messages, full-call correction, ESM and raw sent serial/exchange values remain unchanged. |
| CW-02 | Compile a call/RST/serial message with at least two speeds, padding and cut numbers. Effective preview and dispatched sequence agree in text and speed boundaries; logged/exported values retain their raw representation. |
| CW-03 | Repeated preview, example preview, missing values and invalid directives never allocate a serial, alter a draft, arm or send. Invalid speed/token syntax is explained before activation. |
| CW-04 | Change a call, serial, bank revision, base speed, lane or provider after preparation. Stale compiled output cannot dispatch; fresh preparation uses the captured current context. Imported old banks render identically and unsupported controls remain visible. |
| CW-05 | A real protocol adapter executes multiple speed segments with delayed replies. Boundaries follow documented device semantics, never guessed sleeps; restoration respects a newer explicit base-speed choice and does not guess an unknown previous speed. |
| CW-06 | Unsupported or stale capabilities, including the inspected direct TCI path, make the advanced action unavailable with a reason. A supported ordinary single-speed route remains usable; no directive is silently discarded. |
| CW-07 | With an explicitly enabled threshold of three, type OM0RX through real host draft revisions and perform the ordinary exchange/Enter flow. Admitted typing preserves the same stream; the call and exchange are each sent once, one original serial is used and logging occurs only through the ordinary deliberate commit. |
| CW-08 | Repeated input events, out-of-order append intents, stale draft revisions and lost acknowledgments do not start two streams or deliver a suffix twice. Monotonic same-stream revisions remain within the same native owner and bounded queue; unrelated context changes are rejected. |
| CW-09 | Edit text still provably local/unsent and then text already dispatched or uncertain. Local future content can change; accepted history cannot be rewritten. The latter path exposes Stop/correction and retains the draft. |
| CW-10 | SCP acceptance, spot grab, paste, history load, restore, background updates and an inactive entry do not automatically start output. A separately explicit send/start action remains available where supported. |
| CW-11 | Blank/short/invalid partial calls, S&P, a non-CW mode, unarmed output or another output owner do not trigger early start. Ordinary entry and ESM still work. |
| CW-12 | Interrupt early send before the exchange or let the device catch up during slow typing. Host serial policy remains consistent; no per-character serial allocation, automatic logging or automatic restart occurs. |
| CW-13 | Compare unchanged, changed-suffix and changed-prefix/district calls. Full remains the default; partial uses the previous provider-accepted complete call and sends the reviewed changed component once before TU. Planned-only, partial-stream, stopped, uncertain or ambiguous/multiple/portable cases use the documented full-call recovery/fallback. The final full call and original serial are logged. |
| CW-14 | An intentional repeat, F-key HISCALL or normal CALL token is not suppressed as an automatic correction or early-send duplicate. Exercise actual CQ WW and WPX plugin action flows. |
| CW-15 | Stop while append, speed change or segment submission is awaiting a reply. The tail is discarded, Stop targets the original provider, speed/ownership outcome stays truthful and late completion cannot advance ESM. |
| CW-16 | Exercise queue-full/XOFF, device break-in, uncertain sends and partial command writes applicable to the chosen adapter. Honour flow control; do not send retry/reset bytes into an unknown parser boundary or clear newly owned paddle output. |
| CW-17 | Disconnect/reconnect, lane/radio switch and app/worker restart cannot rearm, redirect restoration to a replacement connection or resume an old stream. Preserve unknown outcomes and require a fresh explicit continuation. |
| CW-18 | At least one production adapter reaches the actual send/append/stop/speed path. Record software evidence and physical procedure separately for main/detached entry. Test advanced exact-bound-lane operation where advertised; otherwise verify explicit unavailability with no fallback to another radio, while preserving existing lane behaviour. Report Oliver's Flex qualification independently of any WinKeyer success. |

### 10.2 OK/OM DX CW scenarios

The expected arithmetic and reference data for these scenarios must come from the verified organiser edition, not from this document or TLF alone. Prepare small independently calculated golden logs before implementing the corresponding scoring assertions.

| ID | Scenario and required outcome |
| --- | --- |
| OK-01 | Register a distinct OK/OM DX CW definition, identifier and mode. It does not replace OK1WC Memorial or select the separate SSB event; existing registry entries remain intact. |
| OK-02 | Store the selected official rule edition, retrieval/digest evidence, category/exchange interpretation and district reference provenance. An unresolved essential clause prevents a verified production-scoring claim. |
| OK-03 | Exercise OK and OM home entrants and a DX entrant with explicitly configured operating location, including a portable operating-location case. The correct sent/received exchange branches apply without assuming the operator's usual home call equals station location. |
| OK-04 | Use independent same-country, other-country/same-continent and other-continent golden cases, including contacts between non-OK/OM entrants where the reviewed edition allows them. Each point result matches that edition. |
| OK-05 | Verify every applicable country/district multiplier dimension, band scope and repeated contact behaviour using independent fixtures. Editing/deleting a contact updates exactly the affected totals. |
| OK-06 | Validate known, unknown and mismatched district exchanges, case/spacing normalisation and missing/invalid serial input. Preserve the raw exchange and an explicit validation result; do not silently fabricate a district or number. |
| OK-07 | Cover duplicate contacts, invalid/non-contest bands, unresolved DXCC and maritime-mobile/other special cases required by the official edition. Do not infer treatment from TLF's implementation alone. |
| OK-08 | Recalculate, close/reopen and migrate a populated contest. Score, multiplier identity, historical source/version, sent serials and prior confirmed records remain consistent; no automatic bulk reclassification occurs. |
| OK-09 | Inspect actual Cabrillo and ADIF output for identifiers, station/category metadata, exchange columns, serial formatting and score treatment. Parsing or string-generation tests alone must include exact expected content from the reviewed specification. |
| OK-10 | Complete a focused operator flow for both domestic and DX setup: create contest, validate exchange, preview/send through an available CW route, log/correct and export. If physical output is unavailable, report the software rehearsal and separate hardware limitation. |

## 11. Phase 2 acceptance — QTC

| ID | Scenario and required outcome |
| --- | --- |
| QTC-01 | Upgrade an old WAE session containing reserved, pending and confirmed QTCs. Identities, quotas, order, source links, score and export remain correct; old output history stays unknown. |
| QTC-02 | Perform every existing QTC mutation and reopen the store. New operating/output/bookmark metadata survives; no writer resets it when reconstructing the existing schema-1 accounting object. |
| QTC-03 | Operate a send series by keyboard: select eligible sources, inspect header/items, send and explicitly acknowledge. Ordinary entry is retained and score changes only at the existing accounting-confirmation boundary. |
| QTC-04 | Receive a series with row/field validation, correction, navigation and optional multiline paste. Incomplete edits are durably resumable without becoming confirmed/scoreable items. |
| QTC-05 | A CW send intent travels beyond savePlanning through the current owner to the real native dispatcher using the captured historical QTC payload. Returning an action object or marking a row sent is insufficient. |
| QTC-06 | Test header, full item and individual time/call/serial repeat actions plus receive-side repeat requests. Each deliberate repeat has a new operation ID, sends the intended content and does not duplicate a ledger item or acknowledgment. |
| QTC-07 | Change the normal Entry call, current serial, lane or bank while a QTC is prepared. It cannot send with mutated values, borrow the current QSO serial, clear Entry, log a QSO or switch to another radio. |
| QTC-08 | Retry the same action after a lost reply or renderer restart. No second transmission occurs; a new explicit repeat remains possible and the unknown prior outcome is retained. |
| QTC-09 | Stop/error/disconnect mid-series preserves edited and acknowledged items. Pending tail output does not resume on reconnect, no automatic series confirmation occurs and ordinary manual entry remains available. |
| QTC-10 | CW, SSB and any already supported digital route use their existing output contracts. A manual/unsupported route is labelled honestly; SSB playback does not pretend to speak dynamic data without a real configured mechanism; no new modem is added. |
| QTC-11 | Band-map opportunity status reflects actual WAE eligibility, remaining quota and the local journal. A QSO dupe can remain a QTC opportunity; an unknown/available/later/refused observation is not a confirmation or a quota deduction. |
| QTC-12 | Marking/clearing a local opportunity, refreshing spots or reopening a map neither transmits nor public-spots the station, overwrites Entry, reserves a QTC or duplicates the current spot model. |
| QTC-13 | An explicit QTC series/item bookmark points to the actual recording segment/capture timeline. An inactive or missing recorder produces a clear unavailable state; creating a marker never starts a device or fabricates audio. |
| QTC-14 | Capture gaps, recorder restart, missing files, archive reopen/verification and any already supported backup/snapshot restore retain truthful marker status and journal links. Recorder failure does not block logging; review never auto-edits a submitted/historical record. No new submission-archive restore capability is required. |
| QTC-15 | Rehearse send/receive, repeat, Stop, reopen, quota exhaustion and final Cabrillo export in one representative WAE session. Existing WAE RTTY accounting remains intact; there is no double score or silent loss of unfinished edits. |

## 12. Phase 3 acceptance — PASS

| ID | Scenario and required outcome |
| --- | --- |
| PASS-01 | Send a directed pass with its actual observed frequency/mode, source time, sender, recipient, target lane, session and version. Missing data is unknown, never fabricated as a valid zero frequency. |
| PASS-02 | Read a legacy zero-frequency/empty-mode pass and a supported new-version pass. Legacy content remains visible as incomplete; an unsupported version is handled explicitly without guessing tune parameters. |
| PASS-03 | Receive or reopen a pass. No automatic tune, load, transmit, log, focus takeover or serial allocation occurs. Acknowledgment alone changes only receipt state. |
| PASS-04 | Explicitly load into an empty addressed lane. The current owner validates all identities and binds the operation correctly; it does not silently substitute another lane/radio. |
| PASS-05 | Load with an occupied draft. Offer the existing Park workflow, preserve its call/exchange/serial, then load deliberately. Cancellation leaves both the pass and current draft intact. |
| PASS-06 | Explicitly tune a complete fresh proposal through the existing station coordinator. It uses current radio guards, never transmits or logs and distinguishes command acceptance from observed tuning. Missing split information remains unknown. |
| PASS-07 | Review an aged proposal or unavailable frequency/mode. The age and uncertainty are visible; a fresh station heartbeat does not make old frequency data fresh. Invalid parameters cannot dispatch. |
| PASS-08 | Duplicate packets, duplicate clicks, lost receipts and restart do not repeat a load/tune. A fresh explicit action has its own identity; received/acknowledged/loaded/tune-requested/confirmed/declined states remain distinct. |
| PASS-09 | Reject wrong recipients, sessions, retired bindings, stale versions, absent target lanes and conflicting owners without modifying another draft or station. Main/detached surfaces share the owner checks. |
| PASS-10 | Partition, reconnect and authority turnover retain current leases, replica restrictions, serial ownership and message history. No automatic promotion or offline serial creation appears. |
| PASS-11 | Rehearse one authority/client handoff: send, acknowledge, park/load, deliberate tune, decline/error and ordinary subsequent logging. Unknown CAT outcomes remain unknown; later logging uses existing provenance and commit paths. |

## 13. Phase 3 acceptance — RULE

| ID | Scenario and required outcome |
| --- | --- |
| RULE-01 | Each enabled profile has a finite contest/mode/category/edition, official source snapshot/digest and explicit interpretation. Unsupported categories or unpublished later editions show no verified profile, not a nearby profile silently substituted. |
| RULE-02 | Existing WPX 2026 CW/SSB Single Operator and Multi-Single behaviour remains consistent with its official source. Check off-period boundaries, hourly band-change boundaries and out-and-back transitions without replacing the rule with TLF's old dwell timer. |
| RULE-03 | CQ WW Multi-Single maintains independent Run and Multiplier clocks with explicit role attribution. Test each role's defined starting QSO, logged whole-minute boundaries including different seconds within one minute, and independent changes. Preserve offending/non-scoring evidence; distinguish any conservative live countdown. |
| RULE-04 | Listening/tuning, logged QSO activity and observed transmission are distinguished. A receiver tune does not restart the QSO-defined clock; an incomplete log cannot certify that no prohibited transmission occurred. |
| RULE-05 | Missing/changed role attribution, stale physical telemetry or unknown radio mapping creates an explicit evidence gap. A radio/lane number alone is not silently treated as Run or Multiplier. |
| RULE-06 | WAE CW/SSB timing profiles activate only after the relevant official category/time/band clauses, including treatment of QTC-only send/receive activity, are verified. Golden boundary cases cover each implemented clause and the existing QTC journal inputs; retained scoring-source evidence alone does not pass this scenario. |
| RULE-07 | Late start, early stop, midnight/hour rollover, contest start/end, UTC conversion and any supported declared breaks produce consistent counters. A local-time/DST change does not change the underlying timeline. |
| RULE-08 | Out-of-order imports, log edit/delete, corrected timestamps, restart and projection rebuild give the same result from the same facts. Prior submitted snapshots and profile identities remain immutable. |
| RULE-09 | The UI states limit, remaining allowance/eligibility, source edition and evidence basis. Manual break markers remain declarations; warnings never block emergency Stop or claim universal contest compliance. |
| RULE-10 | Switch session/category/edition and reopen. Profile adoption is explicit/revisioned, no state leaks into an unrelated contest and no existing log is silently rescored; unsupported future rules are shown honestly. |

## 14. Execution ledger, risks and completion reporting

### 14.1 Keep one ledger

Update the task table in section 4 or add a current-status column there. Keep the following concise evidence register below it or in this section; link detailed test/build output in the repository's normal evidence location. Do not create three competing plans with different statuses.

| Task / acceptance IDs | Status | Code commit | Evidence: actual command/result or procedure | Limitation / next action |
| --- | --- | --- | --- | --- |
| F-01 | DONE | baseline `4b17f102` | 4 November 2026: canonical main clean; `git fetch origin main && git merge --ff-only origin/main` already current; version 1.5.6 | No production installation or physical station action inferred from software scope |
| F-02 | VERIFIED_SOFTWARE | implementation follows | Shared schema-1 CW text/speed/restore sequence; Python owns formatting and preview, native owns claimed output. WinKeyer buffered speed/FIFO is initial advanced route; Flex immediate WPM has no documented queued speed boundary; direct TCI stays unavailable for these enhancements | Hardware evidence remains separate; no RF completion inferred from queue admission |
| F-03 / G-01, G-02, G-06 baseline | VERIFIED_SOFTWARE | fixture source `4b17f102` | Python 3.12 baseline suites `test_wave2_messages_host test_wave5_qtc_host test_lanes_host test_group_coordination`: 28 passed. Pristine baseline Python tree retained in `.build/tlf/prechange-source`; populated WAE pending+confirmed QTC and active message-bank/serial stores retained in `.build/tlf/prechange/manifest.json`, including exact state and Cabrillo digests | Post-change reopen/digest verification required at integration. Existing two-lane and authority/client fixtures are reused; no production store touched |
| P1-08–P1-10 / OK-01–OK-09 | VERIFIED_SOFTWARE | `968d1f8e`, `8694b94e` | Official CW body and all 165 district codes retained; independent arithmetic, actual Cabrillo/ADIF, correction/reopen and catalogue tests. Real React/Python OK/OM desk commit passed after correcting the score-label list contract | Native GUI/physical CW procedure remains separate; organiser submission acceptance is not claimed |
| P1-01–P1-07 | VERIFIED_SOFTWARE | `c0fed776` | Shared typed compiler; native WinKeyer FIFO/speed/stream tests; previous-serial and provider-evidence fences; real host revisions, explicit ESM logging and original serial tested | Hardware NOT_RUN; advanced Flex/TCI and exact-lane streaming remain unavailable |
| P3-01, P3-04–P3-06 | VERIFIED_SOFTWARE | `ace87093` | Versioned pass records; source-pinned CQ WW/WAE 2026 profiles; exact-minute role clocks, QTC-only activity and retained WPX 2026 tests | WPX 2027 publication unavailable; physical activity is not inferred from logs |
| P2-01, P2-03, P2-05 | VERIFIED_SOFTWARE | `27c9894e` | Versioned sibling metadata, original output claims, literal historical payloads, native voice target binding, fldigi generation/Stop fences and captured-sample recorder markers | Route hardware/audio-device qualification NOT_RUN; exact multi-lane QTC output unavailable |
| Integration / G, CW, OK, QTC, PASS, RULE | VERIFIED_SOFTWARE | `1cf9a145` | Broad Python 603 passed. Broad Vitest: 5,151 passed and one OK/OM label-shape failure; that source defect was fixed and the failing real-host operator case then passed. Latest affected QTC binding cases and native surface tests passed. Production frontend build passed | Final single-lane binding tests and signed 1.5.7 build subsequently passed; see sections 14.5–14.7; no installed candidate or physical acceptance claimed |
| Owner/UI integration and native candidate preparation | VERIFIED_SOFTWARE | `1cf9a145a9191be845c159a7ec8cde38169cf0a8` | Directed single-lane tuning now freezes its original radio before authority awaits; 45 related helper/setup tests and four pass-owner tests passed. Node checks: six passed. Version 1.5.7 prepares one separate signed Mac candidate using the exact-source build recipe | Native rehearsal subsequently recorded below. Existing installed 1.5.6 app/worker remain running from `/Applications`; its retained 1.5.6 archive SHA check passed before any build-output reuse |

Execution owners: native CW adapter/backend and tests; OK/OM first-party definition/reference/setup and tests; pass/rule owners and tests; integration owner for Python host/compiler and renderer CW/QTC. Shared files have one editor. Changes remain additive; QTC supplemental operating metadata uses a versioned sibling of the existing schema-1 accounting journal, so legacy writers cannot erase it. Durable original operation/claim receipts remain the replay boundary. Initial Python 3.9 test invocation lacked the module search path; corrected to the repository's Python 3.12 runner before recording the passing baseline. A lean-ctx environment override was rejected without execution; no repository/permission policy was changed.

Use PASS, FAIL, NOT_RUN, BLOCKED or NOT_APPLICABLE for acceptance evidence. NOT_APPLICABLE needs a concrete reason and cannot remove an approved feature. Record software and physical evidence separately when both matter. A missing primary rule source is BLOCKED, not a passing test with guessed expectations.

### 14.5 Delivered tasks and verification register

Task statuses describe the evidenced delivery level, not universal RF acceptance. F-01–F-03 retain their baseline evidence. P1-01–P1-07/P1-11 are software verified against the compiler, actual host/plugin action flow and real production WinKeyer adapter code; physical WinKeyer acceptance is open. P1-08–P1-10 use the official 2026 OK/OM rules and complete district reference. P2-01–P2-06 are software verified, with physical mode/recorder-route checks open. P3-01–P3-06 are software verified for the finite published profiles and existing owners. P3-07 is IMPLEMENTED with passing owner/boundary tests and a partial native authority/client rehearsal; successful native park/load/tune remains unqualified. R-01/R-02 are DONE for source/candidate/document delivery; production installation was not authorised by this implementation request and was not performed.

| Evidence key | Actual verification and source boundary |
| --- | --- |
| SW-MIG | Pre-change populated WAE and active-message stores were created from archived pre-change source and reopened with changed source. Draft, station/settings, references, message workbench, old QTC journal, serials and exact Cabrillo SHA-256 matched. WAE `3e5edceee728c298020809c203303a5a6503ea73b698a87cf15110a0bab90419`; messages `8edc5256b4c2f4eb3b4d6b0e33b94755223034234b5f0e31ea058027a4242efb`. Retained result: `docs/audits/tlf-contesting-2026-11-04/prechange-reopen-result.json`. Existing lane/authority/normal-store fixtures supplemented those populated stores. |
| SW-PY | Broad Python runner: **603 passed** (archive `b6edd83c521f1611`). Later Python changes received focused rechecks: QTC binding/accounting 11 passed (`eda8b51a703d7cba`); OK/OM 10 passed plus the added score-label regression passed; affected CW cases passed. This is broad-plus-focused evidence, not a claim that a later single 603-test run included every later regression. Runner `/opt/local/bin/python3.12 .build/tlf/run_python.py` supplied the repository path to spawned Python processes. |
| SW-CW | `python/tests/test_tlf_cw_host.py`, `test_wave2_messages_host.py` and existing CQ WW/WPX ESM cases; renderer `Not1MMContestWorkspace.test.tsx`, `contestCWCorrection.test.ts`, `ContestMessageWorkbench.test.tsx`; native `cw_session` 38 passed, `winkeyer` 24 passed, renderer direct-dispatch guard 1 passed (archive `7825ec411c196a1b`). Actual serial actor admits typed FIFO speed/restore/stream operations. Protocol doubles establish ordering and failures, not physical keyer conformance or RF. |
| SW-OK | `python/tests/test_okom_host.py`: official snapshot/district hash, domestic/DX/portable arithmetic, multiplier/dupe/edit/reopen and exact Cabrillo/ADIF vectors. Actual React/Python `AllContestsPythonDesk.test.tsx -t okom_dx_cw --maxWorkers=1`: 1 passed, 100 unrelated cases skipped after the label-contract fix (`8fa6b37e45a0ce88`). |
| SW-QTC | `test_tlf_qtc_operating.py`, `test_wave5_qtc_host.py`, `test_remediation_wae.py`, `ContestQTC.test.tsx`, owner output/Stop tests in `Not1MMContestWorkspace.test.tsx`, `contestQTCOpportunities.test.tsx` and shared map tests. Output tests trace original payload/claim to the native CW, voice or fldigi port, including delayed reply/binding changes. Native surface tests 40 passed; voice 16 plus voice UI 11 passed; `LiveFldigiBridgeTests` 22 passed with compiled worker/support (`b2daada93554f622`). |
| SW-REC | Existing recorder 31 passed; two new typed-QTC captured-sample/idempotence/reopen/export tests passed; renderer recorder helper 5 passed. Marker creation requires an advancing capture watermark and never starts audio. Real device capture remains unqualified. |
| SW-PASS | `test_group_coordination.py`, `test_multi_operator_host.py`, `test_lanes_host.py`, `contestDirectedPass.test.ts` and owner pass tests cover immutable payloads, authority/version/recipient, park/load, duplicates and uncertainty. Final original-radio capture changes passed 45 manual-tune/spot-tune/detached-setup tests and four workspace pass tests; TypeScript passed. Tune freezes its original radio before authority awaits and cannot fall back to a newly selected radio. |
| SW-RULE | `python/tests/test_operating_rules.py` covers retained WPX, independent CQ WW Run/Multiplier whole-minute clocks, unknown roles, WAE QTC-only activity, ordered revisions, boundaries and unsupported editions/categories. Existing Info/time and profile-adoption tests cover presentation/restart. Source snapshots/digests are retained in `docs/contesting/tlf-2026-sources/` and the first-party JSON references. |
| SW-UI | Broader Vitest run: **5,151 passed, one failed** across 373 files (`b1aeeff115d89bd8`). The one real-host OK/OM failure exposed `labels` as an object where the renderer expects a list; `8694b94e` fixed it and SW-OK re-ran the failed case successfully. The associated unhandled error came from that same failed render. Do not describe this as one all-green 5,152-test run. Earlier affected eight-file UI batch: 274 passed; subsequent changed owner cases passed. Node gate 6 passed. Production frontend and final native build passed in BUILD. Browser-only visual fixture checked QTC at 1280/1000 px; no output APIs were connected. |
| BUILD | Exact clean release source `4de56b1aeaa1fad93309b0d9a2cc382c04c994da`, version 1.5.7. `bash docs/releases/build-1.5.7-macos-arm64.sh 4de56b1aeaa1fad93309b0d9a2cc382c04c994da` completed exit 0. Developer ID signature, extracted ZIP/version/source/arm64 and payload checks passed. First signed-worker gate **9/9 passed** under unchanged deadline. Archive SHA-256 `ab2f14cecf30c2056d49ed2a1b1891080a09fabdf58143b8881f6f0a1a96ef35`. See `docs/releases/v1.5.7-tlf-software-candidate.md` and retained audit receipts. |
| NATIVE | Same signed source, disposable `contesting` roots with explicit launch arguments and exact app/direct-worker process checks before binding/input. Native OK/OM rejects unknown district then logs valid contact; preview displays 20 WPM → 5NN → 35 WPM → PRE → restore; WAE keyboard row/save/acknowledgment/completion and Quit/restart pass, preserving normal Entry/serial. Real native loopback authority/peer pass send/arrival/acknowledgment and occupied-entry refusal pass. Park/load is safely blocked by the isolated CW service error; successful native park/load and tune are NOT_RUN. All candidate processes retired by ordinary Quit; installed app/worker remained running. Detailed procedure, PIDs and exact limits are in the candidate receipt. |

The following table accounts for all **72** scenarios. PASS means the stated software boundary passed; it does not turn a protocol double into hardware evidence. Mixed scenarios retain their missing native/physical component explicitly. No scenario is removed as not applicable.

| Scenario | Current evidence | Basis and remaining limit |
| --- | --- | --- |
| G-01 | PASS software | SW-MIG; old output history remains unknown. |
| G-02 | PASS software | SW-PY, SW-UI, SW-CW, SW-QTC; defaults retained. |
| G-03 | PASS software | SW-CW, SW-QTC, SW-PASS; exact owner/binding fences. |
| G-04 | PASS software | Durable operation/claim and delayed/lost-reply tests across changed owners; no auto replay. |
| G-05 | PASS software; physical NOT_RUN | Original-owner Stop despite persistence failure; SW-CW/SW-QTC. |
| G-06 | PASS software | Existing authority/replica/serial tests and native loopback lease context; no promotion. |
| G-07 | PASS software | Compiler/parser, bounded QTC and pass validation plus direct-dispatch guard. |
| G-08 | PASS software | BUILD, this ledger and adapter/operator guides; explicit missing qualifications below. |
| CW-01 | PASS software | SW-MIG, existing message banks, full-call default and actual ESM regressions. |
| CW-02 | PASS software; physical NOT_RUN | Shared formatted sequence/dispatch tests and NATIVE two-speed preview; raw exchange retained. |
| CW-03 | PASS software | Preview/invalid-token/no-mutation tests; native preview creates no output claim. |
| CW-04 | PASS software | Captured bank/draft/revision/provider checks and old-bank tests; unsupported adapter rejects. |
| CW-05 | PASS protocol; hardware NOT_RUN | Actual WinKeyer FIFO speed/restore actor tested with delayed writes/status; physical speed/restoration unmeasured. |
| CW-06 | PASS software | Explicit Flex advanced/direct-TCI unavailability and ordinary whole-message contract. |
| CW-07 | PASS software; hardware NOT_RUN | Real host monotonic stream/ESM test sends call/exchange once and commits only through ordinary logging. |
| CW-08 | PASS software | Same-stream revision, duplicate/out-of-order/lost-ack and bounded native queue tests. |
| CW-09 | PASS software | Local future edits versus immutable submitted prefix; Stop/uncertain history retained. |
| CW-10 | PASS software | Typing-origin gate excludes paste/hydration/SCP/history/restore; explicit manual start separate. |
| CW-11 | PASS software | Run/CW/threshold/armed/output-owner admission and ordinary Entry regression tests. |
| CW-12 | PASS software; hardware NOT_RUN | Serial remains one reservation; slow type/idle-gap/Stop host/native vectors. |
| CW-13 | PASS software | Component vectors and accepted-complete-call requirement; WinKeyer queue acceptance alone does not qualify, so full fallback retained. |
| CW-14 | PASS software | Intentional HISCALL/CALL repeats and actual CQ WW/WPX ESM flows remain explicit. |
| CW-15 | PASS protocol; hardware NOT_RUN | Pending append/speed Stop, original target, late outcome and restoration uncertainty tests. |
| CW-16 | PASS protocol; hardware NOT_RUN | XOFF/break-in/partial-command parser boundary tests; no retry bytes into uncertain parser. |
| CW-17 | PASS software; hardware NOT_RUN | Generation/retirement/reconnect/restart tests; no automatic continuation/rearm. |
| CW-18 | PASS production-path software; hardware NOT_RUN | Real native WinKeyer send/append/Stop/speed code reached by shared owner; advanced detached/exact-lane operation unavailable. Flex advanced path unimplemented. |
| OK-01 | PASS software | Distinct `okom_dx_cw` registry; OK1WC/SSB retained. |
| OK-02 | PASS source/software | Official 2026 body and all 165 country-validated districts retained/hash-pinned. |
| OK-03 | PASS software | Domestic, DX and portable operating-location vectors; declared country checked against actual operating call. |
| OK-04 | PASS software | Independent domestic 2/3/5-point vectors and DX 10/1/3/5-point branch. |
| OK-05 | PASS software | Country/district per-band dimensions, repeated contacts and correction/deletion vectors. |
| OK-06 | PASS software/native | Invalid district/serial/country tests; native XYZ refusal; raw exchanges/snapshots preserved. |
| OK-07 | PASS software | Dupe/invalid band/unresolved country and maritime-mobile credit vectors. |
| OK-08 | PASS software | Historical source/version, sent snapshots, correction/reopen and no automatic adoption tests. |
| OK-09 | PASS software | Actual exact expected Cabrillo/ADIF exports and metadata in SW-OK. |
| OK-10 | PASS software; physical output NOT_RUN | Domestic/DX host/operator fixtures, real React host case and native manual district/log flow; physical send unqualified. |
| QTC-01 | PASS software | SW-MIG plus WAE quota/reference/confirmed/pending fixtures; old output unknown. |
| QTC-02 | PASS software | Every old accounting writer preserves versioned sibling metadata; reopen tests. |
| QTC-03 | PASS software; physical output NOT_RUN | Keyboard/send series owner tests retain Entry and separate output/ack/accounting. |
| QTC-04 | PASS software/native | Row validation, keyboard navigation, correction/paste tests; unfinished native W1AW row survives restart. |
| QTC-05 | PASS dispatcher software; physical output NOT_RUN | Historical literal payload travels through original native claim and real shared CW dispatcher; no Entry serial borrowing. |
| QTC-06 | PASS software; physical output NOT_RUN | Header/item/time/call/serial and receive-request vectors; distinct repeat operation IDs. |
| QTC-07 | PASS software/native retention | Captured payload, voice target and fldigi generation tests; native Entry K9KEEP/777/002 unchanged. |
| QTC-08 | PASS software | Original durable claim/outcome retry and no resend after lost reply/restart. |
| QTC-09 | PASS software; physical Stop NOT_RUN | Original-owner Stop before journaling, mid-host reply/error/generation changes; no resume/automatic acknowledgment. |
| QTC-10 | PASS routing software; physical routes NOT_RUN | Native CW, configured managed SSB fragments and existing fldigi routes; absent assets fail before PTT; exact-lane QTC remains manual. |
| QTC-11 | PASS software | Host quota/eligibility and dupe-opportunity tests; native local Later observation remains separate from accounting. |
| QTC-12 | PASS software | Shared maps/local annotation tests, review banner preserves edits; no public-spot or Entry/tune mutation. |
| QTC-13 | PASS captured-sample software; audio device NOT_RUN | SW-REC actual-watermark prerequisite; inactive capture unavailable; no automatic device start. |
| QTC-14 | PASS software; device gap run NOT_RUN | Recorder gap/missing coverage/archive/reopen/idempotence tests preserve truthful links. |
| QTC-15 | PASS owner/export software; native rehearsal PARTIAL | Send/repeat/Stop/quota/export/RTTY tests plus native receive/ack/completion/restart; physical transfer not attempted. |
| PASS-01 | PASS software/native transport | Versioned integer-Hz RX/mode/time/target payload validated by actual loopback native authority. |
| PASS-02 | PASS software | Legacy incomplete/unknown version fixtures remain readable without fabricated tune values. |
| PASS-03 | PASS software/native | Arrival and acknowledgment leave Entry/output/accounting unchanged. |
| PASS-04 | PASS owner software; successful native load NOT_RUN | Original lane/draft binding tests; isolated CW error safely blocks native load. |
| PASS-05 | PASS owner software; native PARTIAL | Explicit Park preserves raw draft/serial in tests; native occupied load refused and blocked park request preserved original Entry. |
| PASS-06 | PASS coordinator software; native/physical tune NOT_RUN | Original binding captured before authority await; no fallback, TX or log. Isolated station I/O disabled. |
| PASS-07 | PASS software | Original observation time/age retained; invalid/missing parameters cannot dispatch. |
| PASS-08 | PASS software | Requested/owner result distinct; duplicate/lost receipt/restart tests prevent second effect. |
| PASS-09 | PASS software/native guard | Wrong owner/session/version/lane/generation tests and isolated output-error refusal. |
| PASS-10 | PASS software | Existing partition/lease/replica/serial constraints plus actual loopback authority context. |
| PASS-11 | PARTIAL native; PASS owner software | Actual send/ack/occupied refusal/error and ordinary OKOM logging checked; successful native park/load/tune still pending healthy output/radio owner. |
| RULE-01 | PASS source/software; WPX 2027 BLOCKED | Finite edition/category sources pinned; organiser page still 2026 and named 2027 PDF unavailable. No guessed future profile. |
| RULE-02 | PASS software | Existing WPX 2026 minute/off-period/hourly/out-and-back fixtures retained. |
| RULE-03 | PASS software | Independent functional role clocks, first Run/new-multiplier starts and logged whole-minute exact boundaries. |
| RULE-04 | PASS software | Tuning/receiver labels do not create transmission facts or restart QSO-defined clocks. |
| RULE-05 | PASS software | Explicit role declaration/fact digest required; absent/stale/changed role remains unknown. |
| RULE-06 | PASS source/software | Hash-matching official WAE timing snapshot recovered; CW/SSB SO/MS and QTC-only activity vectors passed. |
| RULE-07 | PASS software | UTC/minute/hour/midnight/start/end/offset/invalid/future boundary vectors. |
| RULE-08 | PASS software | Edit/delete/import/revision/rebuild equivalence, retained historical source and snapshots. |
| RULE-09 | PASS software | Existing Info/time UI shows edition/limits/basis/unknown; declared gaps do not certify silence or block Stop. |
| RULE-10 | PASS software | Explicit profile adoption, category/session/edition mismatch and restart tests; no silent rescore. |

### 14.6 Native evidence and failed-check resolution

The detailed [1.5.7 candidate receipt](../releases/v1.5.7-tlf-software-candidate.md) records signed hashes, UUID roots, session/workspace identities, launch PIDs and ordinary Quit/restart evidence. The sanitized JSON in `docs/audits/tlf-contesting-2026-11-04/candidate-receipt.json` was collected from read-only databases after Quit. It confirms zero output claims in all rehearsed sessions, unchanged WAE Entry/serial, durable unfinished rows/acknowledgments/completion, and the original loopback Entry after refused/blocked load. Private seed, process and peer receipts remain under those disposable roots; authenticated lease tokens are not copied into repository evidence.

The initial path binding exposed a detached Main Logging title rather than the main UUID title. No input was sent until its embedded session/workspace matched the private fixture; opening the main window subsequently showed the expected UUID. Candidate survival was always established through process-only checks, never by app/path observation. Every ordinary Quit was followed by process inspection; no force quit, blind Escape or production fallback was used.

Retained failed checks and resolutions: initial Python 3.9/module-path invocation corrected to Python 3.12 with inherited child-process path; broad Vitest OK/OM label object/list mismatch fixed in `8694b94e` and the failed real-host case passed; initial disposable external Vite fixture import failure corrected by placing the browser-only fixture under `prototype/tests/visual/`, then checking actual styles at 1280/1000 px. Native pass park/load remained blocked by the offline CW-service error and was **not** reclassified as a success or bypassed. One direct private-root read and one shell redirection were refused by lean-ctx; subsequent native read-only evidence collection used an explicit script, without changing permissions or repository policy.

### 14.7 Exact remaining work

| Component / IDs | Current limit and next concrete action | Resolver |
| --- | --- | --- |
| WinKeyer / P1-01, P1-03, P1-06, CW-05/07/12/15–18 | Real production software path implemented; physical NOT_RUN. On the actual WK2/WK3 device record firmware, exact binding, two-speed output/restoration, slow typing/ESM once, XOFF/break-in/Stop and disconnect/reconnect under a controlled non-live/dummy setup. Follow `docs/cw/TLF_ADAPTER_PROTOCOL.md`. No purchase assumed. | Station operator with connected device and physical-action authorisation |
| Flex / CW-06, CW-18 | Ordinary whole-message path retained. Advanced append/indexed progress/buffered-speed semantics remain unimplemented; no claim that WinKeyer qualifies Oliver's Flex. Implement a source-backed Flex contract separately before physical qualification. | Future adapter implementation, then station operator |
| Detached/exact lanes / CW-18, QTC-10 | Advanced stream and exact-lane QTC output deliberately unavailable with explicit reason; existing ordinary lane operation retained. New route qualification must preserve exact target ownership, not use SO1V fallback. | Future route implementation/qualification |
| QTC mode/recorder routes / QTC-03/05/06/09/10/13–15 | Native dispatch/captured-sample software tests passed; real CW/managed SSB/fldigi output, Stop and audio capture/review NOT_RUN. Use historical QTC samples, configured assets/bridge, an active recorded sample timeline and controlled station setup; verify no Entry/serial mutation. | Authorised operator with configured devices/routes |
| Native full directed pass / P3-07, PASS-04–06/11 | Native transport/ack/refusal passed; park/load blocked by the isolated CW error; tune NOT_RUN. Repeat private authority/client procedure with positively healthy/disarmed output and observed radio binding, then park/load, explicit tune, decline/error and ordinary commit. Keep original-radio, output and lease guards. No physical CAT action is authorised by this source task. | Suitable isolated native test environment and authorised operator for physical CAT |
| WPX 2027 / P3-04, RULE-01 | Official publication was unavailable: organiser page served 2026; named 2027 PDF returned 404. Recheck organiser publication, retain/diff exact source and implement only the published edition. Existing 2026 profiles remain active only for matching sessions. | Official organiser publication, then implementation owner |
| Package operations / R-02 | Signed local candidate exists. Notarization, production installation, controlled cold startup and connected acceptance NOT_RUN. They require their own actual operational authorisation/evidence; source delivery does not imply them. | Release/station operator |

### 14.2 Initial risk and dependency register

| Risk/dependency | Impact | Planned resolution and completion boundary |
| --- | --- | --- |
| Selected adapter lacks reliable append or segment-speed semantics | Items 1/2 may not be fully deliverable for that adapter | P1-01 prototype against primary protocol evidence; implement the supported real path; retain exact unsupported capability and Oliver's Flex status |
| Stop/progress is weaker than UI assumptions | Duplicate tail, uncertain ownership or incorrect restoration | Explicit acceptance/uncertainty states; original binding; delayed-response and disconnect cases |
| OK/OM current full rules/district reference inaccessible | Cannot responsibly certify arithmetic/validation | P1-08 obtains an official edition/reference; implement independent work meanwhile; do not substitute TLF or SSB rules |
| Existing WAE accounting rewrite drops extension fields | Loss of operating/recorder metadata on mutation | P2-01 chooses compatible metadata storage and verifies every writer plus migration |
| QTC actions stop at planning response | UI appears to send without radio output | P2-03 traces intent through actual native admission/dispatch and tests captured historical payload |
| Station pass uses old/missing frequency or wrong lane | Unexpected load/tune | Versioned payload, freshness display, explicit recipient action and existing binding checks |
| WAE timing evidence not yet verified | Profile could provide incorrect guidance | Recover hash-matching source or retrieve organiser rules, then audit the exact missing clauses |
| Other active work touches the same contest surfaces | Lost work or duplicate controls | F-01 file ownership; small logical commits; integrate shared components without resets |
| Hardware not available in execution environment | Physical acceptance cannot be performed | Complete software work, document an exact short hardware procedure and truthful remaining status |

### 14.3 Blocker format

For a real blocker record: **task and acceptance IDs; attempted action; exact missing source/capability/access; evidence; affected functionality; independent work continued; next concrete action; who/environment can resolve it**. Do not invent a user approval requirement when the real problem is unavailable hardware or an inaccessible source.

### 14.4 Milestone report format

Lead with the user-visible result, then provide completed task IDs, focused verification, source/build version, hardware qualification and remaining limitations. Mention a changed plan only when scope or a material dependency changed. Finish with the next already-authorised batch and continue it; do not stop for ceremonial approval.

At final delivery, distinguish **completed**, **implemented but awaiting physical qualification**, and **blocked/unimplemented**. List exact remaining work. Avoid a single “all done” label if the actual adapter path, official rule audit or required acceptance remains missing.

## 15. Source and implementation map

### 15.1 Evidence snapshots

- [xLog reviewed revision f15dbb11eb727419689869f8f4907ed9b4809970](https://github.com/oliverbross/OM0RX-xLog/tree/f15dbb11eb727419689869f8f4907ed9b4809970).
- [TLF reviewed revision b44403bfb2c5d54a2be13ba7aa901c839ea6622d](https://github.com/Tlf/tlf/tree/b44403bfb2c5d54a2be13ba7aa901c839ea6622d).

Use the current execution HEAD for implementation. These links make the planning claims reviewable and are not instructions to restore those old revisions. Recheck protocol documentation and applicable official rules during implementation because capabilities and editions can change.

### 15.2 xLog owners and current integration points

| Work | Source anchors at the planning baseline |
| --- | --- |
| Instructions, workflow and existing roadmap | [AGENTS.md](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/AGENTS.md), [development workflow](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/docs/DEVELOPMENT_WORKFLOW.md), [existing contest roadmap](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/docs/planning/00_N1MM_NEXT_LEVEL_MASTER_PLAN.md) |
| Contest registry, host and durable state | [plugins.py](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/python/contest_host/plugins.py), [host.py](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/python/contest_host/host.py), [store.py](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/python/contest_host/store.py) |
| Message compiler and native CW owner | [messages.py](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/python/contest_host/messages.py), [cw_session.rs](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/prototype/src-tauri/src/cw_session.rs), [cw_session_backend.rs](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/prototype/src-tauri/src/cw_session_backend.rs) |
| CW providers | [winkeyer.rs](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/prototype/src-tauri/src/winkeyer.rs), [FlexRadioClient.swift](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/Sources/XCatIntegrationCore/FlexRadioClient.swift), [LiveFlexSession.swift](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/Sources/XLogPrototypeSupport/LiveFlexSession.swift), [LiveTCISession.swift](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/Sources/XLogPrototypeSupport/LiveTCISession.swift), [TCIWebSocketSession.swift](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/Sources/XCatIntegrationCore/TCIWebSocketSession.swift) |
| Correction and real plugin actions | [contestCWCorrection.ts](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/prototype/src/contesting/contestCWCorrection.ts), [CQ WW CW plugin](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/python/vendor/not1mm/upstream/not1mm/plugins/cq_ww_cw.py), [WPX CW plugin](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/python/vendor/not1mm/upstream/not1mm/plugins/cq_wpx_cw.py) |
| Entry owner, detached surfaces and lane binding | [Not1MMContestWorkspace.tsx](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/prototype/src/contesting/Not1MMContestWorkspace.tsx), [DetachedContestSurface.tsx](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/prototype/src/contesting/DetachedContestSurface.tsx), [contestStationControl.ts](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/prototype/src/contesting/contestStationControl.ts) |
| QTC accounting and operator desk | [wae.py](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/python/contest_host/wae.py), [ContestQTC.tsx](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/prototype/src/contesting/ContestQTC.tsx), [contestVoiceOutput.ts](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/prototype/src/contesting/contestVoiceOutput.ts) |
| Recorder capture and durable markers | [contest_recorder.rs](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/prototype/src-tauri/src/contest_recorder.rs), [contest_recorder_store.rs](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/prototype/src-tauri/src/contest_recorder_store.rs) |
| Directed passes and replicated authority | [coordination.py](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/python/contest_host/coordination.py), [DetachedContestGroupChat.tsx](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/prototype/src/contesting/DetachedContestGroupChat.tsx), [contest_group_chat.rs](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/prototype/src-tauri/src/contest_group_chat.rs), [contest_group_replica.rs](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/prototype/src-tauri/src/contest_group_replica.rs) |
| Existing tune coordination | [TuneCoordinator.swift](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/Sources/XStationIntegrationCore/TuneCoordinator.swift) |
| Rule guidance and WAE source provenance | [operating_rules.py](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/python/contest_host/operating_rules.py), [WAE_2026_RULE_REFERENCE.json](https://github.com/oliverbross/OM0RX-xLog/blob/f15dbb11eb727419689869f8f4907ed9b4809970/docs/contesting/WAE_2026_RULE_REFERENCE.json) |

Test attachment points already present include python/tests/test_wave5_qtc_host.py, python/tests/test_remediation_wae.py, python/tests/test_group_coordination.py, python/tests/test_multi_operator_host.py and python/tests/test_lanes_host.py, together with the adjacent message, CW, QTC and lane UI/native tests. Verify the current names at execution and extend the nearest owner tests; this is not a requirement to create parallel test frameworks.

### 15.3 TLF behaviour references

| Selected behaviour | Reviewed TLF sources and limits |
| --- | --- |
| Early callsign sending and segmented CW | [callinput.c](https://github.com/Tlf/tlf/blob/b44403bfb2c5d54a2be13ba7aa901c839ea6622d/src/callinput.c), [sendbuf.c](https://github.com/Tlf/tlf/blob/b44403bfb2c5d54a2be13ba7aa901c839ea6622d/src/sendbuf.c), [write_keyer.c](https://github.com/Tlf/tlf/blob/b44403bfb2c5d54a2be13ba7aa901c839ea6622d/src/write_keyer.c). Borrow the operator behaviour; estimated progress and provider-specific control handling do not establish xLog adapter guarantees. |
| Partial corrected calls | [logit.c](https://github.com/Tlf/tlf/blob/b44403bfb2c5d54a2be13ba7aa901c839ea6622d/src/logit.c), [utils.c](https://github.com/Tlf/tlf/blob/b44403bfb2c5d54a2be13ba7aa901c839ea6622d/src/utils.c). Review call components and conservative fallbacks rather than copying an arbitrary text difference. |
| Live QTC and opportunity presentation | [qtcwin.c](https://github.com/Tlf/tlf/blob/b44403bfb2c5d54a2be13ba7aa901c839ea6622d/src/qtcwin.c), [qtcutil.c](https://github.com/Tlf/tlf/blob/b44403bfb2c5d54a2be13ba7aa901c839ea6622d/src/qtcutil.c), [bandmap.c](https://github.com/Tlf/tlf/blob/b44403bfb2c5d54a2be13ba7aa901c839ea6622d/src/bandmap.c). Extend xLog's current durable accounting and recorder. |
| OK/OM definition | [rules/okom/okom](https://github.com/Tlf/tlf/blob/b44403bfb2c5d54a2be13ba7aa901c839ea6622d/rules/okom/okom), [okom.py](https://github.com/Tlf/tlf/blob/b44403bfb2c5d54a2be13ba7aa901c839ea6622d/rules/okom/okom.py), [addmult.c](https://github.com/Tlf/tlf/blob/b44403bfb2c5d54a2be13ba7aa901c839ea6622d/src/addmult.c). Country and district tokens are intentionally split by the multiplier machinery. Do not report that representation, or maritime-mobile behaviour without tracing country lookup, as a proven TLF bug. |

### 15.4 Official contest-rule evidence and unresolved sources

**CQ WW:** [2026 rules](https://www.cqww.com/rules/), [organiser FAQ](https://www.cqww.com/rules/faq.htm) and [2026 PDF](https://www.cqww.com/rules/2026_rules_cqww.pdf). The Multi-Single Run/Multiplier clocks and role attribution are supported by the current rules and FAQ. Reconcile edition/source dates and save the actual copies used during implementation. These sources do not make every other contest use the same timing model.

**CQ WPX:** [official 2026 PDF](https://cqwpx.com/rules/2026_cqwpx_rules.pdf). Retain the existing profile family and verify against this edition. Its Multi-Single hourly band-change rule is a different rule from CQ WW's clocks; copying TLF's older generic timing behaviour would be wrong. Keep exact values and independent vectors in the implementation's rule reference.

**OK/OM DX CW:** [CRK contest landing page](https://www.ceskyradioklub.cz/zavody/okomdx) and the organiser's [CW rules endpoint](http://okomdx.crk.cz/index.php?page=CW-rules-english). The complete current CW body and district reference were not successfully retrieved during this planning pass. The [SZR 2024 announcement archive](https://hamradio.sk/main/main_pag2024.htm) supports the broader contact format introduced that year, but does not establish all current point, multiplier, special-case and export rules. P1-08 must obtain the authoritative material before the corresponding production rule claims are accepted.

**WAE:** [DARC English rules](https://www.darc.de/der-club/referate/conteste/wae-dx-contest/en/wae-rules/) and [German rules](https://www.darc.de/der-club/referate/conteste/wae-dx-contest/regeln/). These returned access errors during this planning pass. xLog's existing rule-reference JSON records an official snapshot retrieved 2026-10-27, displayed edition 2025-06-17/event year 2026, 94,008 bytes, SHA-256 9693e5e843a6bfb054deafe2004d55384c0224a764816c66248f5f13e54c668c. The original evidence path is .build/wave5/rules/darc-wae-rules.html on the development workstation. Recover that file and verify its digest, or retrieve a new official copy. Existing audited exchange, eligibility, multiplier, QTC and scoring sections do not certify the unreviewed category/time/band clauses for Phase 3.

Primary organiser rules govern scoring and compliance guidance. TLF is useful implementation evidence; agreement with another logger is not an independent scoring oracle.

## 16. Copy-ready Codex execution prompt

The following prompt is identical to OM0RX-xLog_TLF_Codex_Execution_Prompt_2026-11-03.txt. Attach this complete master plan to the Codex task, then paste the prompt. Keep implementation progress in this master plan; do not maintain a separate competing specification.

```text
Implement Oliver's approved TLF-inspired contesting roadmap in oliverbross/OM0RX-xLog.

The authoritative specification is the attached OM0RX-xLog_TLF_Contesting_Master_Plan_2026-11-03.md. Read it completely. Place it in docs/planning/OM0RX-xLog_TLF_Contesting_Master_Plan_2026-11-03.md if it is not already there, preserving any newer execution ledger. Use that one document as the living plan, task register and evidence record. The prompt is a launcher, not a competing specification. If the attachment cannot be located, explain the missing file rather than improvising the detailed requirements.

This is an implementation instruction. Inspect current code, make the changes, verify them and deliver the work. Do not stop after another comparison, a new proposal, interface scaffolding or a list of suggestions. Continue through the authorised phases without asking for routine confirmation between them.

APPROVED SCOPE AND ORDER

Phase 1 contains original comparison items 1, 2, 5 and 6:
1. Different CW speeds within one message and an accurate preview of the actual send sequence.
2. Optional early-start/type-ahead CW, using a real supported output adapter.
5. A distinct OK/OM DX CW contest definition based on the applicable official organiser rules.
6. Optional component-aware partial corrected-callsign resend, extending the existing full-call correction.

Phase 2 contains original item 4: live WAE QTC send/receive operation, field/row repeats, QTC band-map opportunities and integration with the existing recorder.

Phase 3 contains original items 7 and 8: complete directed station passes with frequency/mode and explicit recipient actions, followed by the finite edition/category-specific operating-time and band-change profiles in the master plan.

Original item 3, the contest simulator, is explicitly excluded, not deferred. Preserve existing Practice functionality without expanding it. Do not add a TLF runtime, second scoring engine, new digital modem, automatic authority failover or unrelated roadmap items.

START WITH THE REAL REPOSITORY

Read current AGENTS.md, docs/DEVELOPMENT_WORKFLOW.md and applicable local instructions. Inspect current HEAD, branch, working-tree changes, app version and active work. Follow the repository's current canonical-main/commit/push policy, use safe fast-forward updates where appropriate and preserve unrelated changes. Never reset or force-push to restore the planning baseline.

The reviewed xLog baseline was f15dbb11eb727419689869f8f4907ed9b4809970; TLF was b44403bfb2c5d54a2be13ba7aa901c839ea6622d. These identify evidence, not a checkout target. Reconcile already completed work and update the ledger with proof rather than implementing it again. Historical stop notes apply to their old tasks and do not cancel this new scope. Coordinate shared-file ownership with any parallel work, especially existing contest or QLog-derived UI work.

Complete F-01–F-03, then implement dependency-sized batches. CW and OK/OM work may run independently. Delegate independent work when useful, with clear file ownership. Do not spend the whole turn rewriting this plan or repeating a comprehensive repository audit.

NON-NEGOTIABLE IMPLEMENTATION CONTRACTS

Keep the Python contest host as the single owner of contest fields, duplicate policy, serials, scoring and exports. Keep the current native services as the owner of CW, radio, voice and digital output. Reuse the existing durable operations, exact lane/radio bindings, call stack, message banks, maps, recorder and replicated authority.

Capture immutable session/workspace/draft-or-QTC identity, revision, lane, provider binding, connection generation and payload for each action. A duplicate operation or lost reply must not send twice, allocate another serial, log twice or retune. An intentional repeat is a new explicit operation. Preserve uncertainty; reconnect and restart never rearm or resume output automatically.

Stop must target the original owner even after focus or binding changes. It must still be attempted if an ancillary journal/preference write fails. Preserve the operator's draft, exchange, serial and QTC edits. Do not report release, speed restoration, RF progress or completion beyond the provider evidence.

Make additive, versioned migrations and verify populated pre-change fixtures. Preserve raw exchanges, sent snapshots, historical scoring/profile identity and existing exports. Do not silently rescore or renumber logs.

PHASE-SPECIFIC DELIVERY REQUIREMENTS

Phase 1: establish the actual provider contract before claiming advanced CW. Existing Flex complete-message CWX send/clear/WPM handling does not yet prove character progress or safe segmented speed boundaries. WinKeyer's current idle-only send/speed admission and ignored echoes require a deliberate owner/adapter extension if chosen. Direct TCI must not be advertised as a qualified CW transmit path merely because it is connected. Inspect current code and primary protocol documentation; these baseline findings may have changed.

Deliver at least one real production adapter path. A fake backend, universal disabled controls or unchanged full-message fallback does not complete items 1 and 2. Prioritise Oliver's Flex path where its protocol permits; record Flex qualification separately from another adapter's success. No hardware purchase is assumed.

Use one typed compiler for preview and dispatch, with actual formatting and speed segments. Preview never sends or allocates a serial. Do not use guessed timing sleeps as device completion evidence. Early start defaults off, is tied to a deliberate Run/CW operator action and cannot start from hydration, history, SCP, paste or restored state. Keep stable stream identity separate from explicitly admitted monotonic draft revisions so ordinary typing does not cancel its own stream. Integrate actual plugin ESM so the call prefix/exchange is not duplicated and ordinary logging remains explicit. Partial correction defaults to existing full-call behaviour, uses reviewed components and requires evidence of the previous complete provider-accepted call, not merely planned esmCallSent state; uncertain/partial/stopped or ambiguous cases fall back conservatively.

Obtain the official OK/OM DX CW edition and district/reference material before accepting scoring constants. Distinguish it from OK1WC and the SSB event. Cover domestic/DX station-location branches, independent arithmetic fixtures and actual Cabrillo/ADIF output. TLF is a behaviour reference, not the scoring oracle. Current-source access was incomplete during planning; do not fill that gap with guesses.

Phase 2: extend existing WAE accounting instead of rebuilding it. Trace QTC actions through Not1MMContestWorkspace/ContestQTC to a real claimed native output dispatch; the present savePlanning/waveResult path alone is insufficient. Keep prepared, submitted, provider outcome, operator acknowledgment and confirmed accounting distinct. Preserve new metadata across every existing wae.mutate writer. Use historical QTC item snapshots, not the mutable normal Entry or its current serial. Whole-message CW is sufficient; early-start hardware qualification must not block independent QTC work. Use existing SSB/digital routes honestly, retain RTTY accounting and avoid a new modem. Opportunity marks stay local; recorder bookmarks refer to real captured audio and do not start devices automatically.

Phase 3: send a complete versioned pass with real frequency/mode and target context. Keep acknowledgment, load, tune and decline separate. No action on arrival; park occupied drafts through the existing workflow; tune through the current coordinator without TX or logging. Preserve leases, serial ownership, stale-data handling and uncertain CAT outcomes.

For timing guidance, retain/reconcile existing WPX 2026 profiles, add the specified CQ WW Multi-Single profiles and the applicable WAE CW/SSB profiles only after the missing official timing clauses are verified. Distinguish Run/Multiplier roles from radio/lane labels and logged/declared activity from observed transmission. Preserve CQ WW's documented logged-minute precision; audit QTC-only activity in the WAE timing model. WPX 2027 is the sole publication-dependent next-edition candidate in this batch. Do not apply rules to unsupported categories or relabel old constants as an unpublished future edition. Recover the existing hash-pinned WAE snapshot if available, or retrieve official rules. The source limitations are component blockers, not a reason to abandon unrelated work.

TESTING, PROGRESS AND COMPLETION

Use the 29-task register and 72 behavioural acceptance scenarios in the master plan. They are coverage requirements, not a demand for 72 new test files or repeated full-suite runs. Reuse existing fixtures; add focused meaningful tests at the correct owner/protocol boundary. No CI test should key a transmitter.

Run focused checks during implementation, broader affected suites at phase milestones and native builds when changed native paths require them. Do not repeat full tests, builds, signing or installation after every small edit. Verify the actual delivered code revision, rerunning only invalidated checks. Follow repository packaging/version/provenance requirements for real candidates.

Update the ledger with task IDs, implementation commits, actual commands/results and limitations. Distinguish IMPLEMENTED, VERIFIED_SOFTWARE, VERIFIED_HARDWARE and DONE. Do not label a feature complete because a control exists or mocks pass. Record adapter-specific physical qualification separately; an unavailable device does not prevent reviewable software delivery.

If blocked, record the exact missing source, capability or access, affected task/acceptance IDs, attempted evidence and next concrete action. Continue independent authorised tasks and later phases; keep the blocked work visible. Resolve routine design choices yourself. Do not insert artificial approval gates or stop after Phase 1 when the remaining authorised work is executable.

Use actual session authorisation for physical station actions, production installation, provider/account writes and log submission. Do not infer live RF or contest-submission permission from software implementation alone, and do not ask again for authorisation already given. Finish all possible reviewable source/test/build work before raising a genuinely missing operational approval.

Deliver logical committed changes following the current repository workflow, an updated master ledger, concise operator documentation, exact source/build provenance and a clear account of completed features, pending physical checks and genuinely blocked work. Do not claim installation or RF acceptance without evidence. Begin F-01 now and proceed into implementation in this session.
```
