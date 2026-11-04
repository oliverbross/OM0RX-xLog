# OM0RX-xLog 1.5.7 — Independent TLF Delivery Review

**Review date:** 4 November 2026  
**Reviewed repository:** oliverbross/OM0RX-xLog  
**Reviewed revision:** `5016751a03f2adc6eea27def34ed4675e6bdc67a`  
**Purpose:** Verify the reported three-phase delivery and define a bounded correction pass. This review supplements the existing master plan; it does not replace its task or acceptance registers.

## 1. Decision

**Keep 1.5.7 as an implementation candidate. Complete the nine corrections below before treating the affected software acceptance claims as closed.**

The three phases have substantial implementations, real native output integration, retained official rule sources and useful release evidence. However, focused tests against the actual Python contest Host reproduced scoring, exchange-preservation, recovery and QTC defects. A green CI run and the recorded signed-worker checks do not exercise all of these sequences.

Three findings have high operational impact: an incorrect OK/OM single-band claimed score, incomplete support for the advertised two-transmitter submission category, and parked contacts losing their original sent exchange. Five findings affect scoring eligibility, CW recovery or operating guidance. One smaller issue affects rapid QTC correction and acknowledgement.

The existing master ledger remains authoritative. Reopen its affected software acceptance claims, attach the reproductions, then close them with corrective evidence. Retain successful evidence for unaffected behavior and retain the separate physical/native qualifications.

### Delivery identity and evidence

| Item | Verified fact or evidence boundary |
| --- | --- |
| GitHub main reviewed | `5016751a03f2adc6eea27def34ed4675e6bdc67a` |
| Product implementation source | `1cf9a145a9191be845c159a7ec8cde38169cf0a8`, as recorded in the release receipt |
| Candidate build source | `4de56b1aeaa1fad93309b0d9a2cc382c04c994da`, including the version and build recipe |
| Candidate | 1.5.7, macOS arm64 |
| CI at reviewed HEAD | Success, GitHub Actions run 41800792990 |
| Signed-worker check | Repository release evidence records 9 passed, 0 failed; this review did not rerun the signed Mac application |
| Native evidence already recorded | OK/OM validation/logging, typed preview, QTC editing/acknowledgement/restart, and directed-pass transport/acknowledgement |
| Native evidence still open | Successful full park/load/tune rehearsal; the recorded park/load attempt was stopped by the isolated CW-service guard |
| Physical evidence still open | Actual WinKeyer, CW/voice/fldigi routes and recorder capture qualification |
| Installed application | The release receipt reports installed 1.5.6 unchanged; this review did not inspect or modify Oliver's Mac |

Sources: [candidate and provenance][s-release], [exact CI run][s-ci], [master ledger][s-master].

## 2. Scope and method

This was a read-only review of the pinned source and release records. Retrieved source copies used in the tests were checked against their Git blob identities. Focused probes created disposable databases and exercised the actual `Host`, its pinned Not1MM plugins and, for parking, the unchanged TypeScript `ContestCallStack` connected to that Host.

The review did not rebuild the Mac application, operate the native GUI, invoke a radio/keyer, transmit RF, install software, copy production stores or change application/remote repository files.

The retained OK/OM rules, CQ WW rules/FAQ and DARC WAE rules were recovered from the repository and checked against their recorded digests. The findings concerning those rules therefore have an available primary-source basis. They are not consequences of an unresolved rules download.

Evidence is described precisely below:

- **Host reproduction:** an actual production Host action or projection in a disposable store.
- **Shared-controller reproduction:** the actual TypeScript controller and actual Host, without React or the native app.
- **Source confirmation:** the production consumer or dispatcher establishing the rest of a path.
- **Recorded native/physical evidence:** evidence reported in the repository, separate from tests run for this review.

The reproductions below are deliberately small and include their expected corrected results. They can become regressions in the existing suites without creating a second testing framework.

## 3. Findings at a glance

Severity describes impact; it is independent of the project's Phase 1/2/3 labels.

| ID | Severity | Finding | Primary master-plan tasks |
| --- | --- | --- | --- |
| TLF-R01 | High | OK/OM single-band claimed score includes contacts on other bands | P1-09, P1-10 |
| TLF-R02 | Medium | OK/OM scores contacts outside the pinned contest period | P1-09, P1-10 |
| TLF-R03 | High | OK/OM MO2T export lacks mandatory transmitter identification and supported serial sequencing | P1-09, P1-10 |
| TLF-R04 | Medium | CQ WW Multiplier clock accepts a duplicate as a new multiplier | P3-05, P3-06 |
| TLF-R05 | High | Park/load reuses the parked reservation and changes the original sent exchange on return | P3-02, P3-03, P3-07 |
| TLF-R06 | Medium | WAE RTTY opportunity display applies the one-way CW/SSB direction model | P2-04 |
| TLF-R07 | Medium | WAE timing attributes a QTC attempt to the old series band | P2-01, P3-05, P3-06 |
| TLF-R08 | Low | Saved QTC correction remains durably marked pending until autosave | P2-01, P2-02, P2-06 |
| TLF-R09 | Medium | Persisted early-CW receipt suppresses the callsign after the live continuation is lost | P1-05, P1-06 |

## 4. Detailed findings and correction contracts

### TLF-R01 — OK/OM single-band score includes other bands

**Observed through the actual Host.** Configure OM0RX, sent exchange PRE, SINGLE-OP and BandCategory 20M. Log:

| UTC | Contact | Received | Band | Points |
| --- | --- | --- | --- | --- |
| 2026-11-14 12:00:00 | OK1ABC | APA | 20 m | 3 |
| 2026-11-14 12:01:00 | DL1ABC | 001 | 40 m | 3 |

The Host reports **18**, `scoringComplete=true`, and Cabrillo contains both `CATEGORY-BAND: 20M` and `CLAIMED-SCORE: 18`.

The correct 20 m claim is **6**: 3 points multiplied by two multipliers, the OK country and APA district. An all-band entry would legitimately claim 18 from this fixture. Official OK/OM sections 3 and 3.2 permit retaining other-band contacts for checking; they do not make those contacts part of a single-band claim.

**Cause:** `okom.py` aggregates all contacts and all multiplier keys. The existing score-band handling in `host.py` is restricted to another contest. The same unfiltered total supplies the Cabrillo claim. [Scoring/export implementation][s-okom] · [primary rules and edition metadata][s-okom-reference]

**Required correction:** Derive the selected category's score and multiplier projection from eligible contacts on its band. Keep all contact records and export rows required for checking. Use the same authority for live totals, recalculation and export.

**Acceptance:** The fixture above yields 6 for 20M and 18 for ALL. Category switching, edit/delete and close/reopen or projection rebuild produce the same totals. No contact is deleted or renumbered.

**Ledger:** P1-09/P1-10; OK-05, OK-08, OK-09.

### TLF-R02 — OK/OM scoring ignores the contest period

**Observed through the actual Host.** For the pinned 2026 edition, log:

| UTC | Contact | Received | Observed points |
| --- | --- | --- | --- |
| 2026-11-14 11:59:59 | OK1ABC | APA | 3 |
| 2026-11-15 12:00:00 | K1ABC | 001 | 5 |

The Host returns a complete **24-point claim**: 8 points × 3 multipliers. Both contacts are outside the official period, which runs from 2026-11-14 12:00:00 UTC up to, but excluding, 2026-11-15 12:00:00 UTC. Their contest credit should be zero.

**Cause:** `row_points()` checks band, mode, identity and exchange but not the timestamp. General Host validation only establishes timestamp syntax. Because OK/OM duplicate accounting uses positively credited contacts, an early outside-period row can also occupy a duplicate key before the valid contest contact. The score defect was reproduced; the duplicate consequence is established by the same eligibility/duplicate source path. [Eligibility and duplicate implementation][s-okom] · [pinned period][s-okom-reference]

**Required correction:** Apply the selected official edition's period before scoring and duplicate-credit decisions. Retain outside-period contacts, their raw times and an understandable non-credit reason. Do not shift timestamps, delete contacts or perform an unrelated database-wide rescore.

**Acceptance:** Test one second before start, exact start, the last in-period second and exact end. An outside-period contact must not suppress a later eligible contact. Rebuild and export must agree with the corrected projection.

**Ledger:** P1-09/P1-10; OK-07, OK-08, OK-09.

### TLF-R03 — Advertised OK/OM two-transmitter submission is incomplete

**Observed through the actual Host.** Create a DX entry with DL1ABC, numeric sent exchange, MULTI-OP and TransmitterCategory TWO. Log OK1ABC/APA on 20 m and OM1ABC/BAA on 40 m.

The setup is accepted. Cabrillo declares `CATEGORY-TRANSMITTER: TWO`, but each QSO line stops after its received exchange and contains no transmitter identifier. The active serial policy is contest-wide and the fixture allocates 001, 002.

Official OK/OM section 5.1.2 requires transmitter identification on each MO2T QSO and serial sequences per band or per transmitter. A global sequence could coincide with one transmitter's sequence in a small trace, so the two example serials alone do not prove every such log invalid. The concrete problems are the absent mandatory identifiers and the absence of an implemented, attributable MO2T serial policy. [Setup and exporter][s-okom] · [serial owner][s-host] · [official-category reference][s-okom-reference]

**Required correction:** Complete MO2T using the existing transmitter attribution and authoritative serial owners. Persist the actual per-QSO transmitter and the chosen permitted serial scope. Export the genuine transmitter identity. Never manufacture it from a default `Run1Run2` value or infer it from the currently focused radio.

If the current architecture cannot support this category within the bounded correction pass, explicitly gate its valid-submission claim and keep its acceptance open with the exact missing capability. Do not invalidate ordinary SO/MOST operation or hide the limitation behind a successful export.

**Acceptance:** Exercise two actual declared transmitters and the supported serial scope, retain attribution through edits/reopen and verify exact expected Cabrillo columns. Unknown historical attribution remains unknown. Do not renumber historical sent exchanges.

**Ledger:** P1-09/P1-10; OK-09, with the category/serial interpretation recorded under OK-02.

### TLF-R04 — A duplicate can reset the CQ WW Multiplier clock

**Observed through the actual Host.** In CQ WW CW 2026 Multi-Single, declare:

1. Run: K1ABC, 20 m, zone 5 at 14:00.
2. Multiplier: JA1ABC, 40 m, zone 25 at 14:02.
3. Multiplier: a duplicate K1ABC on 20 m at 14:10, entered with zone 4.

The second contact gives the Multiplier role an eligible time of **14:12**. The third is stored with `Points=0`, `IsMultiplier1=0` and `IsMultiplier2=0`. Nevertheless, operating guidance sees the newly typed zone 4, records an early band change and moves that role's eligibility to **14:20**, with `complete=true`.

**Cause:** The clock rebuild independently accumulates country/zone sets without applying the contest authority's duplicate/credit decision. It can therefore create a valid clock start from a contact that is not a valid new multiplier. [Clock implementation][s-operating] · [retained CQ WW rules and FAQ provenance][s-rule-sources]

**Required correction:** Reuse authoritative contact eligibility before evaluating new-multiplier status. Retain offending or non-credit activity in the event trail, but do not turn it into a valid new-multiplier clock start. Preserve independent Run and Multiplier clocks and the reviewed whole-log-minute interpretation.

**Do not replace this with `Points > 0`.** A legitimate zero-point same-country CQ WW contact can still provide a multiplier.

**Acceptance:** The duplicate above leaves the valid Multiplier eligibility at 14:12 and explains its nonqualifying status. Add a valid zero-point multiplier case and verify edit/rebuild consistency.

**Ledger:** P3-05/P3-06; RULE-03, RULE-04, RULE-08.

### TLF-R05 — Park/load does not preserve the original sent exchange

**Observed with the actual TypeScript CallStack connected to the actual Host.** The disposable WPX trace was:

| Step | Active contact and sent exchange | Host reservation behavior |
| --- | --- | --- |
| Original entry | K1ABC, sent report 589, sent serial 001; received 579/007 | Original draft owns 001 |
| Park and load passed call | DL1ABC, using 001 | Same Host draft ID and same reservation |
| Commit passed contact | DL1ABC logged with 001 | Next active draft receives 002 |
| Resume parked contact | K1ABC returns with sent report 599 and sent serial 002 | Original 589/001 exists only in the parked audit snapshot |

This probe did not transmit anything. If 589/001 had already been sent to K1ABC, the resumed entry would no longer match that exchange.

**Cause:** The stack captures a raw parked snapshot but applies the new call through `draft_apply` to the same live Host draft/reservation. Restoring a stack item restores received fields while using the current sent defaults and serial. The new test explicitly expects the original serial to change. The accompanying documentation calls the old serial audit-only, but the accepted PASS-05 requirement says to preserve the parked call, exchange and serial. [Stack controller][s-stack] · [workspace integration][s-workspace] · [current stack test][s-stack-test] · [accepted requirement][s-master]

**Required correction:** Parking must preserve a distinct authoritative draft/reservation and its sent context. Loading the incoming call needs its own appropriate reservation through the existing owner. Returning to the parked draft must restore its still-valid original exchange without assigning that serial to a different contact.

Copying the old visible number into the new draft is insufficient: it can conflict with a reservation already consumed by the passed contact. Do not solve this with serial renumbering, offline allocation or a second serial authority.

If exact preservation cannot yet be guaranteed, reject the park/load operation with a clear reason and retain both entries; keep the task open. That is an interim containment, not completion of the requested workflow.

**Acceptance:** Exercise park → log passed contact → resume original using the actual Host, then cover restart and duplicate operation/retry. Both contact identities, received fields, sent report and original reservation must survive. The incoming contact cannot consume the parked reservation. Follow with the previously missing isolated native rehearsal.

**Ledger:** P3-02/P3-03/P3-07; PASS-05, PASS-08, PASS-11 and relevant G-04/G-06 invariants.

### TLF-R06 — WAE RTTY opportunity display hides valid receiving

**Observed through the actual Host.** For WAE RTTY, own call K1ABC, counterpart DL1ABC and no sendable source QSOs:

- Explicit receive eligibility succeeds.
- The map projection reports eligible, direction send, ten remaining, zero available sources and `opportunity=false`.
- Creating a valid receive series succeeds.

The display assumes the CW/SSB direction rule: Europe receives, non-Europe sends. The RTTY ledger supports both directions across continents, so a non-European operator's valid receive opportunity disappears. European RTTY operators similarly see only receiving capacity. [Opportunity projection][s-qtc-operating] · [strict frontend contract and labels][s-opportunity-ui] · [existing WAE accounting][s-wae]

**Required correction:** Keep CW/SSB direction behavior. For RTTY, project sending and receiving independently and derive the overall opportunity from either legal direction with quota. The Host remains the owner of shared quota, reservations and eligible-source arithmetic. Change the frontend schema validator and tooltip together.

**Acceptance:** Cover a non-European RTTY operator receiving with zero sources and a European RTTY operator with eligible sending sources. Verify shared quota exhaustion and unchanged CW/SSB behavior. Displaying an opportunity must not reserve or confirm anything.

**Ledger:** P2-04; QTC-11, QTC-15.

### TLF-R07 — WAE timing uses the series band for a later QTC attempt

**Actual Host reproduction plus source-confirmed consumer defect.** Create a receive series at 14,025,000 Hz, change the current draft frequency to 7,025,000 Hz and prepare a time-repeat request.

The Host returns `AGN TIME`, keeps the historical series frequency at 14,025,000 and correctly captures `attempt.frequencyHz=7025000`. No native output was invoked; the attempt remains prepared.

The operating-rules consumer pairs this attempt's new timestamp with the **batch's old frequency**, ignoring the captured attempt frequency. The operator activity writer also uses the saved batch frequency for later ledger actions. A historical series header does not establish the band of every later repeat or acknowledgement. [Attempt capture][s-qtc-operating] · [timing consumer][s-operating] · [activity writer][s-wae]

**Required correction:** Attribute an attempt to its own validated captured frequency and evidence basis. Review activity records so their timestamp/frequency pair describes what is actually known. For legacy records lacking that information, retain an explicit qualified fallback or unknown state. Keep the original series/header/export snapshot intact.

Prepared, submitted, uncertain, received and operator-declared activity must retain their distinctions. Correcting the band must not turn a prepared request into proof of RF transmission.

**Acceptance:** An in-period 40 m attempt from a 20 m series is projected as 40 m with its actual evidence status. Test a legacy missing-frequency record and preserve the immutable series header. Verify the relevant WAE clock/boundary result rather than only checking the presence of a field.

**Ledger:** P2-01/P3-05/P3-06; RULE-04, RULE-05, RULE-06, RULE-08.

### TLF-R08 — Saving a correction leaves a stale durable pending edit

**Observed through the actual Host; UI timing confirmed in source.** Persist a pending correction for receive row 0, then save its valid corrected values through `qtc_item`. An immediate `qtc_confirm` rejects it:

> Save or explicitly discard this pending QTC correction before acknowledgement

Clearing `pendingEdit` through `qtc_workspace` makes the same acknowledgement succeed.

The UI clears pending state in React after the item save, but durable clearance waits for the 400 ms workspace autosave. A fast Save → Alt+Enter therefore gets a misleading rejection. A crash in that interval can reopen the already-saved correction as pending. The data is retained; later successful autosave normally resolves the mismatch. [Editor save and autosave][s-qtc-ui] · [Host guard and item mutation][s-wae]

**Required correction:** Commit clearance of the matching pending editor state atomically with the item correction, preserving unrelated operating metadata; or keep acknowledgement unavailable until durable clearance finishes. Do not remove the guard for genuinely unsaved corrections. Protect against stale workspace autosave reintroducing the cleared edit.

**Acceptance:** Save → immediate acknowledgement succeeds for the saved row. Reopen shows no stale pending correction. Unrelated pending metadata and genuinely unsaved edits retain their protections.

**Ledger:** P2-01/P2-02/P2-06; QTC-02, QTC-04, QTC-15.

### TLF-R09 — Early-CW recovery can omit the callsign after restart

**Observed through the actual Host; native fallback confirmed in source.** In a disposable CW contest:

1. Enable Run, admit early call OM0 and finish OM0RX.
2. Claim the operation and record WinKeyer native-queue acceptance at provider generation 1.
3. Close/reopen the Host and reopen the same contest.
4. Execute ordinary callsign ESM with provider generation 999.

The Host emits only **`5NN TT1`**. The full OM0RX callsign is suppressed. Retiring the stale early admission restores the ordinary call-plus-exchange path. No QSO is logged and the reserved serial is unchanged.

**Cause:** The HISCALL suppression condition trusts persisted admitted/complete/accepted-operation state. It does not require a matching live native continuation or current generation. A restarted native session has no continuation and its ordinary ESM fallback sends the already-shortened sequence. Queue acceptance from the old process/device session is insufficient evidence for omitting the call in the new one. [Host suppression][s-host] · [persisted receipt][s-cw-operations] · [native session and fallback][s-cw-session]

**Required correction:** Authorize suppression only from a live matching continuation bound to the owner/epoch, provider identity/generation and relevant draft/stream. Restart, disconnect or loss of continuation must retire its sending authority while preserving draft and audit history. The next deliberate operation must recover with the full call or explicitly require that recovery. Never automatically replay or restart output.

A provider-generation comparison alone is insufficient if a restarted owner can expose the same generation value: live ownership must also be established.

**Acceptance:** Actual-Host restart with a changed generation cannot omit the full call. Add a native-boundary case with no continuation, plus the valid uninterrupted same-stream case in which the call/exchange are each sent once. Keep ordinary serial/logging behavior and deliberate full-call repeats intact.

**Ledger:** P1-05/P1-06; CW-04, CW-07, CW-12, CW-17 and G-04.

## 5. What the review supports

The review found no additional concrete defect in the following inspected paths:

- Typed speed segments and append operations reach the production WinKeyer actor. Unsupported advanced adapters reject the operation explicitly.
- Partial corrected-call behavior has a production route: ordinary non-WinKeyer CW output can record provider-accepted complete-call evidence, and the correction policy checks the matching provider/generation. WinKeyer queue evidence deliberately retains the full-call fallback.
- QTC actions reach existing native CW, managed voice and fldigi owners after a durable one-use claim. Historical row text is used. Deliberate repeats have distinct identities; replay does not automatically output again.
- Output outcome and QTC acknowledgement/accounting remain distinct. Stop or failure does not automatically confirm or retry the item.
- Recorder bookmarks refer to an existing captured timeline; unavailable coverage remains explicit.
- The release record clearly identifies the missing native park/load/tune and physical qualification.

These are bounded source-review conclusions, not proof that all such behavior has passed on Oliver's physical station. Sources: [native CW backend][s-cw-backend], [native session][s-cw-session], [QTC output bridge][s-workspace], [candidate limits][s-release].

## 6. Completion and qualification policy

### Keep the accepted roadmap

The scope remains Phase 1 items 1/2/5/6, Phase 2 item 4, and Phase 3 items 7/8. The contest simulator remains excluded. These findings complete and correct selected work; they do not create a new phase or justify replacing the original architecture.

Use the existing 29-task/72-scenario master ledger. Associate each finding with the existing IDs listed above and add the small reproduction as a subcase. Do not remove scenarios, rewrite their requirements to match the current behavior, or count one passing unit test as evidence for an untested native/hardware boundary.

### Preserve the known limits

| Boundary | Current status and next evidence |
| --- | --- |
| Advanced WinKeyer CW | Production software exists; device/firmware speed, append, flow-control, Stop and reconnect measurements remain open |
| Advanced Flex CW | Still unavailable; ordinary Flex CW remains available. WinKeyer qualification does not establish Flex support |
| Direct TCI CW output | No new transmit capability |
| Advanced detached/exact-lane streams and exact-lane QTC output | Explicitly unavailable in the candidate |
| Full native directed pass | Repeat park/load with a healthy, positively disarmed output owner; complete tune only with the required observed binding and applicable authority |
| QTC voice/fldigi/recorder | Physical route and captured-audio qualification remain open |
| WPX 2027 | No verified profile until official publication is available; preserve the 2026 profiles and their edition scope |
| Installation, notarization and connected-station acceptance | Separate from this source review and correction package |

Source: [release qualification table and procedure][s-release].

## 7. Recommended execution order

1. **Protect scores and exchanges:** fix TLF-R01/R02/R03, TLF-R05 and TLF-R09. They affect the truth of a claimed score, a submitted log or an already-sent exchange.
2. **Correct projections:** fix TLF-R04/R06/R07 through the existing contest authorities and consumers.
3. **Close the editor race:** fix TLF-R08 with a focused persistence/acknowledgement test.
4. **Reconcile the master ledger:** retain failures and their resolutions, close only the boundaries actually demonstrated, and preserve remaining physical/native limitations.
5. **Produce one new candidate after integration:** follow the canonical checkout/version/provenance rules. Do not replace different application code under version 1.5.7. Run focused affected tests during development, one required integrated gate, then one final signed build and its required worker checks.
6. **Finish the bounded native rehearsal:** exercise the repaired parked-serial flow and QTC Save → immediate acknowledgement in disposable storage. Preserve output guards. If isolated startup or owner validation fails, retain evidence and stop that UI sequence while completing independent work.

No repeated full build/sign/install cycle is needed after every small correction. The accompanying Codex prompt contains this work as one bounded follow-up. Keep the existing installed application unchanged unless a separate installation instruction already authorizes replacement.

## 8. Reproduction inventory

| Probe | Actual boundary exercised | Observed result |
| --- | --- | --- |
| OK/OM mixed-band, outside-period and MO2T fixtures | Real Host create/commit/score/export | 18 instead of 6; 24 instead of 0; TWO without transmitter columns |
| CQ WW duplicate with changed zone | Real Host commit/role declaration/operating guidance | Invalid multiplier resets eligibility from 14:12 to 14:20 |
| Park → passed QSO → resume | Unchanged TypeScript CallStack plus real Host | Original 589/001 returns as 599/002 |
| RTTY receive with no sources | Real Host eligibility/opportunity/create | Valid receiving hidden by send-only opportunity |
| QTC repeat after band change | Real Host output preparation plus consumer source | Attempt captures 40 m; timing consumer selects series' 20 m |
| Save correction → immediate ack | Real Host QTC mutations plus UI source | Rejected until durable pendingEdit clearance |
| Early stream → Host restart → ESM | Real Host plus native fallback source | OM0RX omitted; exchange only |

Each reproduction used disposable state and no station I/O. The correction prompt includes the case parameters and desired results so implementation does not depend on access to the review's temporary filesystem.

## Source index

All GitHub source links below are pinned to the reviewed revision. Official rule interpretations use the retained primary sources referenced by the repository.

[s-release]: https://github.com/oliverbross/OM0RX-xLog/blob/5016751a03f2adc6eea27def34ed4675e6bdc67a/docs/releases/v1.5.7-tlf-software-candidate.md
[s-ci]: https://github.com/oliverbross/OM0RX-xLog/actions/runs/41800792990
[s-master]: https://github.com/oliverbross/OM0RX-xLog/blob/5016751a03f2adc6eea27def34ed4675e6bdc67a/docs/planning/OM0RX-xLog_TLF_Contesting_Master_Plan_2026-11-03.md
[s-okom]: https://github.com/oliverbross/OM0RX-xLog/blob/5016751a03f2adc6eea27def34ed4675e6bdc67a/python/contest_host/okom.py
[s-okom-reference]: https://github.com/oliverbross/OM0RX-xLog/blob/5016751a03f2adc6eea27def34ed4675e6bdc67a/docs/contesting/OKOM_CW_2026_RULE_REFERENCE.json
[s-host]: https://github.com/oliverbross/OM0RX-xLog/blob/5016751a03f2adc6eea27def34ed4675e6bdc67a/python/contest_host/host.py
[s-operating]: https://github.com/oliverbross/OM0RX-xLog/blob/5016751a03f2adc6eea27def34ed4675e6bdc67a/python/contest_host/operating_rules.py
[s-rule-sources]: https://github.com/oliverbross/OM0RX-xLog/blob/5016751a03f2adc6eea27def34ed4675e6bdc67a/docs/contesting/tlf-2026-sources/source-reference.json
[s-stack]: https://github.com/oliverbross/OM0RX-xLog/blob/5016751a03f2adc6eea27def34ed4675e6bdc67a/prototype/src/contesting/contestCallStack.ts
[s-stack-test]: https://github.com/oliverbross/OM0RX-xLog/blob/5016751a03f2adc6eea27def34ed4675e6bdc67a/prototype/src/contesting/contestCallStack.test.ts
[s-workspace]: https://github.com/oliverbross/OM0RX-xLog/blob/5016751a03f2adc6eea27def34ed4675e6bdc67a/prototype/src/contesting/Not1MMContestWorkspace.tsx
[s-qtc-operating]: https://github.com/oliverbross/OM0RX-xLog/blob/5016751a03f2adc6eea27def34ed4675e6bdc67a/python/contest_host/qtc_operating.py
[s-opportunity-ui]: https://github.com/oliverbross/OM0RX-xLog/blob/5016751a03f2adc6eea27def34ed4675e6bdc67a/prototype/src/contesting/contestQTCOpportunities.ts
[s-wae]: https://github.com/oliverbross/OM0RX-xLog/blob/5016751a03f2adc6eea27def34ed4675e6bdc67a/python/contest_host/wae.py
[s-qtc-ui]: https://github.com/oliverbross/OM0RX-xLog/blob/5016751a03f2adc6eea27def34ed4675e6bdc67a/prototype/src/contesting/ContestQTC.tsx
[s-cw-operations]: https://github.com/oliverbross/OM0RX-xLog/blob/5016751a03f2adc6eea27def34ed4675e6bdc67a/python/contest_host/cw_operations.py
[s-cw-session]: https://github.com/oliverbross/OM0RX-xLog/blob/5016751a03f2adc6eea27def34ed4675e6bdc67a/prototype/src-tauri/src/cw_session.rs
[s-cw-backend]: https://github.com/oliverbross/OM0RX-xLog/blob/5016751a03f2adc6eea27def34ed4675e6bdc67a/prototype/src-tauri/src/cw_session_backend.rs
