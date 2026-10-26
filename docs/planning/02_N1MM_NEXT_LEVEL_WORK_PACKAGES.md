# N1MM Next Level — retained execution specification

**Planning integration: 27 October 2026.** Read [the master plan](00_N1MM_NEXT_LEVEL_MASTER_PLAN.md) first. Its consolidation baseline and NL-owner dispositions take precedence over the older review's statements about implementation status. This document retains the scope, dependencies and completion obligations of **all W01–W24 packages** from the supplied 26 October N1MM Next Level programme. It is an execution specification, not a second status register, a new audit, or authorization to begin every package.

## Source and interpretation

The source is the user-supplied `00_N1MM_NEXT_LEVEL_MASTER_PLAN.md`, prepared 26 October 2026, SHA-256 `1dd6aec6e4f270b950426fb62ea89fc52d6f7a9f540d25e66b6cf4813ada1d90`. Its review was pinned to `36e4cfdfa19853b376151dad1f16b4659e5d2879` and refreshed through documentation-only `e1f023f111194d2c19590f254e9166c6bf1b0e6b`. The original full comparison, capability matrix and source register remain in Oliver's supplied package. This repository copy carries forward the implementation requirements; it does not claim that the older observations were independently reverified against today's application.

References **N** below mean the supplied N1MM Logger+ manual printed 3 October 2026, using its printed page numbers. **T** means the supplied 43-page Not1MM guide, using physical PDF pages. They are software-behavior references, not current organizer-rule authority. For a rule-dependent implementation, verify the selected contest edition and retain its source. Do not silently import rules or rescore a completed log.

The 27 October consolidation reports accepted application **1.3.36**, source `079570505b06f0a5aba403aa6105909148652c91`. It already includes readiness/analytics, sync receipts, recorder/playback, radio settings, workspace switching, Log Review, timer, cluster and map fixes. Those are foundations to preserve. An existing timer is not necessarily the category-specific time-rule feature below; existing Log Review is not necessarily whole-log sorting or deleted-contact recovery. Trace the exact requested behavior once, reuse delivered parts, and implement only the remaining delta.

The numbered **A01–A77** ranges are acceptance obligations associated with their packages, not 77 new full test suites to run on every commit. Use existing meaningful fixtures. Test the actual `not1mm-python` route and its current native/UI owners; retired Swift compatibility or general smoke tests cannot substitute for a feature's operating journey.

## Shared implementation contract

Keep one authoritative contest log and plugin scoring path. Reuse the current Python host/SQLite store, native station/radio/output owners, cluster, Recorder, Analytics, durable receipts and audit infrastructure. Do not create another rules engine, radio client, audio pipeline, database warehouse or generic framework merely to increase parity counts.

All optional results carry the existing session/draft/provider/log identities needed to reject stale work. An uncertain mutation is not a failed mutation to replay with a fresh ID. Imported data, heard exchange, CTY inference, callbook profile, remote spot and decoded text retain their distinct meaning. Unknown is not zero, absent or permission to act.

Protect the completed CQ WW log, normal logbook, recordings, settings, credentials and recovery refs. Use disposable storage and fake transports. No real radio command, PTT, RF, rotor motion, audio capture/playback, account write/upload, live restore, app replacement or gated-feature activation is authorized by this documentation update. Those actions require their existing operator authorization.

## W01 — Contest readiness, setup and practice profiles

**P0 foundation; M; existing setup/readiness owner. N pp.49–58, 127–139; T pp.10–16.**

Extend existing Setup with a concise capability summary for the selected definition, category and rule edition: core logging/export, installed workflow, analytical dimensions, output provider and verification date. Show accepted, limited, not applicable and unverified separately. Preserve CQWS's partial-score warning and RTC restriction until NL-01 is actually closed. Do not present passing lifecycle fixtures as current sponsor certification.

Show category, sent exchange and sample transmitted/logged exchange together; prevent duplicated signal reports. Link official rules and xLog setup notes. Preserve pinned CTY/history/SCP coordinates, showing missing or incompatible data explicitly. Optional keyer absence must not block manual SSB logging.

Provide an explicit Practice copy with a new session identity and native-disabled output/public posting. Copy appropriate preferences, not completed contacts, active leases or real serial reservations. Preflight UTC/event period, station location, exchange, message tokens, selected radio, backup and requested output capabilities. Updates remain deliberate; no mid-contest rules replacement.

**A01–A03:** meaningful CQ WW/WPX/NAQP/IARU/VHF/CQWS capability examples; a practice commit cannot mutate or act through the real session; historical sessions retain their scoring/reference policy. Reuse the current readiness matrix rather than generating a competing one.

## W02 — Call Stack / On Deck

**P1 first productivity wave; M; W01 identities, W05 only for macro stage. N pp.742–746.**

Deliver a manual stack first: add, select, promote, swap, remove and load-next, with a compact optional On Deck strip. Each item has a stable identity/revision. Retain heard partial calls containing `?` as assistance, not automatically valid contacts. Use visible manual/FIFO ordering initially; multiplier-first needs authoritative evidence. Reclassify duplicate status when the log, band or scope changes. Show suppression/recovery instead of silently losing a queued duplicate; that is an intentional xLog improvement.

Loading is a draft mutation, not a log or station action. A nonempty draft needs an explicit swap/park/discard decision. Only meaningful exchange fragments and their provenance travel with the queued item. Never carry the previous caller's name/grid/report into the next one implicitly.

Add Log and load next only after durable-commit handling is correct. Invalid, failed or uncertain saves preserve both current entry and queue. Restart reconciles a half-completed commit/pop once. Allocate the next serial at the normal reservation point, not when a caller is merely stacked. Macro/ESM integration follows later, evaluating the next call/exchange after the transition rather than expanding the previous `!` or `#`.

**A04–A07:** two callers plus a partial can be stacked/swapped without logging; WPX Log-and-next uses the correct next serial; failure/restart never pops or logs twice; a changed dupe scope is reflected without automatic tuning/transmission.

## W03 — Reverse Call History, richer Check and Visible Dupesheet

**P1; M; existing assistance/read-only log owners. N pp.259–265, 285–289, 411–412.**

Add exchange-to-call search only for plugin-declared stable fields: name/state, locator/partial call and comparable known roles. A rolling serial is not a permanent identity. Use bounded cancellable queries over existing history/log stores, explicit prefix/contains behavior and a sensible minimum query. Show source/date and compared fields. Suggestions never overwrite heard data; old replies cannot replace a newer query/draft.

Add an optional Visible Dupesheet within Log/Check over the whole contest, with call-area/suffix grouping or an accessible equivalent. Use the actual contest/band/band-mode/grid/time duplicate scope, not a second algorithm or a CQ-WW-only assumption. Do not reproduce an old fixed display limit as a product requirement; undisplayed calls remain queryable. Retain current whole-call rendering, difference highlights and source-pane controls.

**A08–A10:** traceable NAQP and VHF reverse candidates; a serial-only unsupported search is explained; stale replies discarded; Dupesheet and Entry agree after mutation, band change and timed-repeat boundary.

## W04 — Skeds, return contacts and operator reminders

**P1; M; current station/spot/draft owners; W15 for later network routing. N pp.368–370.**

Create durable contest-scoped items with call/reminder text, frequency, mode, UTC due time, optional lane/station, note and source context. Prefill deliberately from draft, spot or last QSO. Support Add/Edit, Snooze, Dismiss, Complete, Cancel and history. Notifications must not steal entry focus.

Due items offer Load, Load and tune, or Later. Loading protects an occupied draft. Tuning requires an explicit target and fresh existing station receipts/readback. A failed/uncertain action does not mark the item complete; notification alone never tunes, transmits, posts or logs.

Handle sleep, restart, clock correction and overdue batches without repeated floods or missed reminders. Cancellation is not destructive deletion; do not copy an automatic purge without an explicit retention policy. Local delivery comes first. Later station assignment requires an acknowledgement, not just a multicast send.

**A11–A13:** midnight/restart reminder delivered once; snooze survives sleep; occupied draft and failed tune preserve the item, with no output on notification.

## W05 — Macro/message workbench and safe N1MM compatibility

**P1; M/L per token family; existing output owners, W02/W11 for their actions. N pp.154–200; T pp.20–23.**

Preserve Not1MM syntax and both F1–F12 banks. An N1MM `.mc` import must explicitly identify its dialect, stage a draft, report supported translations/warnings/rejections and retain the original file. Similar token spelling is not semantic compatibility; do not overwrite an active bank automatically.

Provide a no-output preview with a synthetic contact/plugin exchange and simulated serial. Separate literal, log, UI, station and output actions. Detect undefined tokens, recursion, unavailable providers and conflicting commands within bounded size/depth/runtime. Expand the template once: heard text containing braces, `#`, carets or XML must stay literal, not become control syntax.

Add named mode/contest/operator banks, next-ESM-action preview and managed-asset references. Reject escaping file paths or missing assets. Save versus Export must be explicit. Not1MM radio-memory VOICE slots and managed WAV slots are not identical; declare translations. Do not execute shell, arbitrary Python, unrestricted CAT or Windows automation scripts from imported macros. Unsupported control actions stay unsupported until mapped to a typed owner.

**A14–A17:** import/report representative CW/SSB banks; previews cannot key; hostile-looking field text remains literal; next-call references bind the next draft/serial; missing voice configuration does not block manual logging.

## W06 — Whole-log exploration, notes and reviewable edits

**P1; M; existing query/mutation/audit owners. N pp.59–61, 69, 342–346.**

The older reviewed renderer sorted supplied rows and labelled this honestly. Check current whole-log support once. Where absent, add stable server-side ordering/filtering over the complete contest with identity tie-breakers, bounded pages/cursors and an allowlist of columns. Use numeric/time semantics, not lexical serial/frequency sorting. Preserve inspected-row selection when new contacts arrive.

Reuse accepted Log Review and editing. Add fast Note current / Note last QSO and a Notes view with explicit stable draft/QSO binding. Separate notes, exchange warnings, review flags and correction reasons. A late note must not attach to the next contact. Corrections show identity, before/after and recalculation consequences; heard data must not be silently corrected from QRZ/SCP/audio/comparison logs.

Paper-log entry or timestamp adjustment is later explicit scope: preview all affected rows, preserve originals, record reason/uncertainty and avoid interpolation to make a log appear compliant.

**A18–A20:** multi-page full-log sort with stable selection; delayed note binds correctly; edits from either pane retain raw plugin fields and update dependencies once. Do not rebuild the already delivered explicit callsign-correction flow.

## W07 — Deleted-contact recovery and independent recovery record

**P1 data protection; M/L; existing audit/backup/outbox owners. N pp.59–61; independent recovery is an xLog extension.**

First trace any existing independent recovery stream. An audit table inside the same corrupt database is not independent protection, but do not create a competing archive if the current stream suffices.

Expose Deleted contacts through existing tombstone/audit data with read-only preview and explicit restore. Preserve QSO ID, sent serial, original UTC, recording link and deletion/restoration history. Recalculate through the host; do not reuse a restored serial for a new contact or overwrite a newer row from a stale restore.

If missing, extend the existing transaction/outbox with bounded versioned append-only recovery records containing session/sequence/operation/reference/schema identity and reconstructable state. Do not claim cross-file SQLite atomicity: persist the outbox transactionally, drain safely, expose independently durable extent. Optional copy failure must be visible without indefinitely holding logging.

Replay into a new recovery destination only. Validate identity/order/integrity/version, allow a valid prefix before a truncated tail, and deduplicate replay. Never restore secrets or armed output leases.

**A21–A23:** fixture deletion/restoration preserves identity/serial/audio; truncated-tail recovery reconstructs prior committed data in a fresh store; disk failure exposes degraded recovery and bounded correct logging.

## W08 — General imports, submission preflight and final archive

**P1; M, native N1MM migration L; W01/W06/W07 where applicable. N pp.31, 60–63; T p.34.**

The older reviewed importer explicitly required CQ-WW-SSB and its exchange shape. Reconcile newer code before extending it. Generalization belongs in the existing service with plugin/family mappings and a read-only preview. Preserve IDs, raw exchange, submode, station/site and operator metadata; historical imports must not reserve new sent serials. Unsupported values are rejected/quarantined explicitly, not dropped.

Distinguish repeated delivery, probable duplicate, conflicting ID and legitimate repeated QSO. Reordered input must not create duplicates because a fallback ID uses row ordinal. Test Unicode/length/unknown-field preservation through the existing ADIF decoder.

Build a Submission workbench over current Cabrillo/EDI writers: entrant/category/rule edition, sent exchange, counts, UTC, other-band contacts, partial-score warnings and output format. Preflight is read-only. Export exact bytes with log revision/source/reference/hash manifest. Later legitimate edits produce new snapshots, never modify an already submitted file invisibly. An organizer receipt alone supports Submitted; opening a web page is not receipt evidence.

Keep ordinary-log transfer separate. Archive summary/notes/checks/recording index with optional selected audio. Native N1MM `.s3db` conversion is a separate read-only known-schema import, not established by ADIF support.

**A24–A27:** serial/name-location/grid imports preserve meaning and repeat safety; invalid data cannot silently partially import; submission bytes/manifest reopen consistently and retain intended records; no false Submitted state.

## W09 — Unified opportunities and Move Multipliers

**P1/P2; M; current spot preview/family dimensions, W04 for planning. N pp.267–284, 347–354.**

Retain Cluster, Band Map and Needed views. One opportunity represents call/band/mode with supporting observations, source age, known exchange, duplicate state, dimensions, conditional value and uncertainty. Several spots are evidence for one opportunity, not extra multipliers or another cluster connection.

A Move Multipliers view distinguishes spotted, worked, conditionally new, unknown exchange and ineligible across relevant bands/modes. Revision-driven refresh may improve on N1MM's manual refresh, but preserve user selection. Use category/radio/configured-band filters.

Separate known duplicate status from unknown serial/state/grid. Never manufacture an exchange to force score prediction. Conditional score gain is not probability-weighted expected score, and CQ WW's formula is not universal. Opportunities sharing the same new multiplier are not additive.

Watch/Planned/Requested/Waiting/Worked/Abandoned states can link to skeds or directed passes. Only actual committed evidence establishes Worked. Feed disappearance, changed rank or attractive value never triggers automatic tune/log/transmit.

**A28–A30:** WPX unknown serial preserves independently knowable dupe; shared-new-multiplier opportunities show nonadditivity; planned move survives restart and explicit routing, then resolves from a real commit.

## W10 — Contest Info, rule-aware timers and operating plan

**P1/P2; M; W01 verified category profile, W11/W15 where scope needs lanes/stations. N pp.333–341.**

Extend the accepted timer/Rates/Info implementation, not a parallel dashboard. Distinguish event period, time since QSO, observed operating time, inferred inactivity and qualifying rules-defined off-time. Add allowance/band-change counters only with an identified contest edition/category/source.

Define elapsed versus clock-minute rules, band versus mode changes, transmission versus QSO evidence, and station/transmitter scope. Missing observations/rules show unverified, not a green compliance guarantee. An idle contact log does not establish an idle receiver.

Use appropriate saved events/QSOs. Live and retrospective calculations should agree for the same evidence, including correction/deletion/import, midnight, daylight saving and clock adjustments. Do not change the system clock. Operator notes/rest/targets are plans, not retroactive proof. Respect single-band category; no generic recommendation to change to an ineligible band.

**A31–A33:** test qualifying-time boundaries below/at/above; band-change counters at UTC boundaries and after correction; distinguish unknown evidence from a violation and never rewrite contacts to fit rules.

## W11 — Genuine SO2V/SO2R operating lanes

**P2 strategic; L; W01, current radio owners, W05 for lane macros. N pp.303–304, 721–742.**

Independent connection slots and an active radio already exist. Verify any newer lane work once; do not render one shared draft twice and label that SO2R. Extend the existing session minimally: one log/scoring authority/serial policy, two lane-specific drafts, Run/S&P/ESM/focus/CQ context, each bound to exact radio/receiver/VFO/slice/generation.

Separate keyboard focus, listening routing, requested TX target and observed TX state. Typing in another lane does not acquire TX authority or interrupt valid output. Explicit output switching follows existing confirmed stop/release/reclaim and uncertainty policies. Keep single-transmitter semantics by default; loss of renderer focus is not proof RF stopped.

Route typed spot/tune/message actions by explicit lane rather than active-radio fallback. Delayed replies/reconnects cannot cross lanes. Preserve actual sent serials and applicable reservation scopes. Split RX/TX frequencies and the logging lane are separate facts; physical VFO state alone cannot distinguish split from SO2V. Preserve unknown historical attribution.

Stage delivery: two entry lanes with fake radios; explicit tuning/focus; single-transmitter message/audio routing; then separately authorized physical qualification. Alternating CQ/audio switching/two-keyboard input are later options, not excuses to block the first useful stage.

**A34–A38:** separate entries/logging once; nonfocus tune isolation; no reply crossover; competing outputs retain single-owner protection; WPX serial/split export/restart; physical claims require actual separately authorized station evidence.

## W12 — Advanced CW operating assistance

**P2; M/L per provider; existing keyer, W05, W11 for alternate lane. N pp.104–105, 146–153, 721–741.**

Keep CW receive/decoding separate from CW transmission. Retain working ESM/keyer/radio output; N1MM's historical transport restrictions do not require removing a correctly implemented xLog provider.

Add opt-in corrected-call and next-action handling based on what was dispatched/confirmed, not current text alone. Sent history and editable unsent text are separate where supported. Full/partial correction before TU is capability-dependent.

Early-send thresholds are off by default, explicitly armed, Run/lane-scoped and visibly described. Handle slash calls, partials, backspace, Stop and provider uncertainty. Never claim per-character cancellation for a whole-string-only provider. Preserve literal stored serials when applying padding/cut-number rendering. Use existing shortcut customization and preserve Mac/system text editing. Stop must not wipe another draft.

**A39–A41:** fake keyer binds corrected call/next serial; unsupported incremental cancellation cannot be enabled; backspace/Stop leaves truthful sent/unsent state. Physical timing remains a separate gate.

## W13 — Digital operating desk and WSJT Decode List

**P2/P3; L; existing WSJT/fldigi owners, W02 queue, W11 lanes. N pp.413–433, 638–720, 745–746; T p.17.**

Preserve existing activity/completed-QSO ingress and destination fences. Add instance/period/mode/frequency/report/call/grid classification, distinguishing decoded candidate, selected caller, externally completed QSO and durably committed contact. External WSJT-X/JTDX remains the engine.

Deliberate Select/Reply targets an exact current instance/version/radio context with allowed actions and timeout handling. UDP delivery is not TX success. For fldigi, extend existing text/typed-output with deliberate token selection, grab list and stack; conflicting decodes stay evidence, not automatic corrections. Do not embed Windows engines merely to claim parity.

One logging authority must deduplicate repeated external events while allowing genuine contest duplicates. Preserve mode/submode, serial, station and external identity. Contest/session/engine changes invalidate stale commands and late-contact destinations.

**A42–A45:** competing simulated engines cannot cross-route; repeated logged datagram commits once; expired period/instance needs renewed review; fldigi selection maps plugin fields. Real engine/audio/PTT acceptance stays distinct.

## W14 — WAE and first-class QTC handling

**P3 specialist; L; W01 rules, W05/W12 or W13 output. N pp.506–511 and WAE digital section.**

Verify official edition/participant/mode rules before declaring WAE support. Generic serial logging alone is not QTC readiness. Model separate batches: direction, counterpart, batch/count, time/call/serial items, source-QSO links, confirmed/cancelled states. Eligible QTC interaction can be distinct from ordinary duplicate-QSO status; never manufacture fake QSOs for QTC points.

Provide keyboard-first send/receive grids, repeat fields/items, header corrections and explicit return to Entry. Preserve already confirmed items through interruption; retries cannot resend/recredit silently. Select only rule-eligible source contacts with counterpart/prior-send exclusions. Sent snapshots remain immutable even after source-QSO correction.

Use typed output owners and required QTC exports/score reconciliation. Manual microphone entry works without WAV automation; bidirectional digital behavior has separate qualification.

**A46–A48:** partial ten-item batch survives restart; already sent/ineligible source excluded; a dupe does not improperly block valid QTCs; independent expected QSO/QTC totals and export agree.

## W15 — Multi-operator dashboard, passing and handover

**P2/P3; L; existing first-party authority, W04/W09, W11 as needed. N pp.355–366, 747–757; T pp.18–19.**

Reuse shared serial/dupe/contact/change operations, not another replication protocol. Dashboard peer/operator/role/band/mode/lane, last confirmed change, lag/queue, authority/lease and category counters. Disconnected/stale/conflicting/silent differ. Publication ACK is not verified remote storage unless the actual protocol establishes it.

Directed Talk/Pass and helper-stack proposals require a target/acknowledgement; they cannot overwrite an active runner draft. Operator handover changes selected identity/preferences, not credentials or output arming. Passes are not public spots.

Exercise pairing, incompatible rules/reference/schema, replay/out-of-order changes, loss/restart and competing masters. Retain bounded reconciliation/conflict policy; never pick the higher score to resolve split-brain. Where offline serial/merge guarantees are unavailable, disclose that before accepting unsafe continuation. Do not expose LAN multicast/lease tokens as Internet authentication.

**A49–A52:** two disposable workers preserve serial/contact/correction identities through loss; unknown authority visible; passes reach intended station without editing current entry; real two-Mac/network acceptance separately authorized.

## W16 — Qualified CW receive and contest-spectrum integration

**P2/P3; L; existing CW programme and its unchanged launch gates. N pp.290–294, 371–392.**

Do not commission another decoder or enable disabled code. NL-06–10 own the two-span/32-track capacity, real-radio RF mapping, held-out corpus, durable actions and soak gates. Preserve source from the CW branch; main's earlier disabled milestones are not proof the later branch is accepted.

After necessary gates qualify, reuse those streams for spectrum/waterfall with explicit receiver/RF center/span/freshness/sample identity, filter and carrier/decoded-call overlays. A carrier without a reliable call is not a known multiplier; raw model scores are not calibrated probabilities.

Offer explicit tune/signal navigation/zoom. A quiet gap is only a candidate CQ frequency requiring listening, never autonomous tune-and-CQ. Retune/gap/inversion/TX quarantine/stale stream invalidates actionable markers. Agent CAT does not prove native IQ; do not acquire another client's slice or enable RX2 on reconnect.

**A53–A55:** synthetic coordinate tests are separate from real-source qualification; exact package must pass authorized provider gates before live spot/tune enablement; stale mapping cannot produce falsely precise actions; stopping decoder preserves CAT/logging. No quiet scope reduction to pass capacity.

## W17 — VHF/rover/transverter operating depth

**P3; L; existing VHF/EDI, W01/W11 identities. N pp.523–530, 758–763.**

Preserve existing VHF/grid/distance/EDI support. Extend with grid map, current/historical rover sites, alternate locator suggestions, beacon overlays and band/site notes. A site change is explicit, timestamped and historically bound to contacts; changing current grid must not recalculate old sent locators/distances silently. Home callbook/history does not establish a rover's present location.

RF/IF transverter mapping must be provider-aware with offset/injection/inversion and band identity. A plugin's microwave bands do not grant an HF provider new tuning capability. Do not merely widen the native 1 GHz guard; send only valid provider IF requests and retain RF meaning in display/log/export.

Beacon sources/ages are explicit and separate from transient spot retention. Maps/beacon updates do not move equipment autonomously. Distances/headings use the station/site, not the remote laptop location.

**A56–A58:** two sites retain original QSO/EDI semantics; declared fake-provider RF/IF mapping sends valid IF commands; stale locator/beacon data never becomes confirmed worked evidence.

## W18 — Extensible contest packages without a second engine

**P3; M/L; current registry/readiness/versioned references. N pp.550–594, 765–780.**

Use the existing Python model rather than a parallel universal UDC engine. First ship a developer template kit: official source/identity, field roles, valid/conditional examples, dimensions, exports, fixtures and reproducible manifest. Reuse lifecycle/readiness tooling; generated code is not verified rules.

A limited later UDC converter must report precisely supported/rejected semantics and retain original/conversion evidence. Never silently approximate bonus/QTC/dynamic exchanges. Setup distinguishes reviewed built-ins, local modifications and unreviewed third-party definitions; pin versions per session.

Install/update only deliberately through an established trust strategy. Do not fetch/execute arbitrary Python in the live worker. Keep developer installation explicit until that trust path exists. Preserve dependency licenses/source notices; no copied proprietary binaries/assets/manual corpus.

**A59–A60:** a scaffold uses current lifecycle/export checks without changing other contests; unsupported conversion is diagnostic, not false success; updating a definition does not rescore completed sessions.

## W19 — Analytics completion and operator learning

**P2; M; existing Analytics/adapters, W10/W11 for measured intervals. N pp.333–341, 393–396; xLog extensions.**

Do not recreate pivots, timelines, comparisons or Recorder links. NL-02 owns AADX history; NL-03 finite Needed; NL-04 analytical candidate evidence. Preserve not-applicable/open-ended dimensions and existing live spot preview as distinct from analytical-copy evidence.

Connect insights to full immutable analysis snapshots. Unknown is not zero; aggregate distinct calls/multipliers at the real scope. Compare equivalent categories/time/reference bases and distinguish claimed/reconstructed/adjudicated scores.

Actual operating efficiency requires observed style/operator/lane intervals, not QSO Run flags alone. Historical missing durations/radio attribution remain unknown. Radio comparisons cannot establish receiver quality from QSOs or routine 59 reports. Documented official LCR input is read-only, separate from heuristic warnings; audio/LCR learning does not auto-correct completed calls/exchanges. Any edit-assistance policy needs current sponsor constraints.

Explain recommendations using observed evidence, not unsupported propagation or contact-probability claims; no cloud/LLM dependency in logging.

**A61–A63:** enabled histories reconcile with host scores; unknown duration/radio remains unavailable; insights drill into contributing records; LCR/audio analysis preserves submitted snapshots and log bytes.

## W20 — External integrations with exact semantics

**P2; M; existing XML/RTC/bridge owners. N pp.810–820; T p.14.**

Preserve actual RadioInfo/contactinfo/replace/delete/lookup/score senders. Verify fields/units against selected protocols and consumers, including semantics different from ADIF. The manual's documented packet frequency unit is 10 Hz; retain version/source rather than assuming every export field uses that unit.

Fixtures cover call/time corrections, deletes, mixed modes, actual sent serial versus placeholder, station/operator/lane and RX/TX frequencies, partial-score restrictions, escaping and bounds. UDP send is not persistence, submission or an ACK.

Use committed-event/outbox identity where available. Optional provider failures cannot undo a QSO or block an independent provider; uncertainty/retry is explicit. Native N1MM replication, compatible telemetry, Renfield publication and xLog first-party authority remain different claims.

**A64–A65:** simulated consumer sees coherent IDs/units/create-correct-delete; failed transport preserves log and truthful delivery state; qualify a selected actual integration separately before enabling its compatibility claim.

## W21 — Operator profiles, accessible density and contextual help

**P1 continuing polish; M; existing appearance/layout/bindings. N pp.210–215, 248–258, 295–298, 721–724.**

Keep accepted Classic/Modern and radio setup. Named profiles may change panels, logical geometry, scale/density, optional rows, shortcuts and approved message associations—not secrets, hardware, station identity, categories or arming.

Actions need consistent accessible names, keyboard routes and outcomes. Detect collisions across system/app/contest contexts. Grow the current finite binding format with versioned tested bounds when needed, never by discarding user settings or removing all limits. Explain N1MM/Not1MM shortcut differences.

Use text/badges with color; show focus/lane/muted/unavailable states. Why-unavailable help links to existing settings. Observed RX is not permission to transmit. Validate native-minimum/webview/flex-grid/viewport chains, preserving manual sizing and clamping off-screen positions without erasing layouts. Readable fonts and one intentional list viewport beat hidden overflow.

**A66–A68:** profiles have no radio/log side effects; compact/expanded controls remain reachable; keyboard/color-independent states are clear; custom shortcuts survive upgrades.

## W22 — Rules/reference provenance and assisted-operation boundaries

**P0 foundation/P2 polish; M; W01 and current references. N pp.57, 259–265, 793–809.**

Expose origins: heard exchange, prior QSO, history, CTY, home callbook, remote spot, local decode and official table. None silently becomes the authority for a portable exchange.

Show rule/scoring revision and reference coordinate in Setup/diagnostics/manifests. Pre-contest updates are explicit; historical adoption requires separate reviewed migration/score delta. Preserve pinned/unknown states.

A category-assistance checklist records selected feeds/operator choices with edition-specific sources, not a universal rules verdict. Restricted profiles must not silently activate cluster/decoder or alter declared category. Physical station region/location, not laptop locale, determines applicable contextual band information; unknown permission is not a guarantee.

**A69–A70:** conflicts labelled without replacing heard data; updates cannot mutate completed contacts; restricted profiles do not start assistance behind the user's back; fixture success never certifies rule currency.

## W23 — Recorder reliability and recording-coverage assurance

**P1 reliability; M; existing Recorder and device owners. N pp.790–791 for QSO linkage; continuous archive is an xLog extension.**

Recorder already exists. NL-11 owns remaining actual input/coverage/recovery acceptance, NL-12 deferred independent/direct sources. Preserve accepted QSO links and audible playback. Focus on device/format loss, overflow, sleep, low disk, channel changes, gaps, clock map and simultaneous replay/capture.

Retain durable segments and stable bookmarks; restart/handover cannot silently start capture. Show source/channel map, actual activity, durable extent, gaps and space. A moving meter or one replay is not complete RX/TX/operator-ear coverage. Compliance claims need current rules and verified routing.

Replay uses a selected listening-only path with no PTT/voice-keyer authority. Device changes cannot reroute replay into a transmitter. Capture failure must not lose QSOs. Clip/coverage exports are explicit and redact private speech/identifiers from diagnostics as appropriate.

**A71–A73:** fake disconnect preserves durable prefix and gap; replay remains listening-only during capture; ID links survive authorized correction/restart without rewriting audio evidence; actual route acceptance is separately authorized.

## W24 — Performance, rehearsal and release acceptance

**P0 across each selected wave; M; only changed-path dependencies. N pp.57–58; current AGENTS/workflow.**

Test the actual Python-backed desk. Generic native gates, retired Swift compatibility and mocked-render-only tests cannot prove the operating journey. Profile a named workstation/disposable contest with realistic spots/windows and optional recorder/analytics/decoder load; measure input, commit/readback, station-queue and optional workload separately. Engineering targets are measured proposals, not claims inferred from unit tests. Degrade optional overload visibly before starving Entry.

Reuse caches, fixtures and tools. Add meaningful boundary checks once rather than redundant source-string assertions. Broad relevant gates happen at coherent milestones; keep failed-run history. Rehearsal uses unmistakable isolated storage and fake station/public-output boundaries.

Build from canonical clean source, uniquely version each different executable candidate, and record bundled/installed identities. Documentation updates need no candidate or version bump. Installation/live actions require permission; preserve accepted recovery policy. Do not delete artifacts merely to declare completion.

**A74–A77:** actual UI/native/Python feature journey; measured load preserves correct logging; restart keeps identities/uncertain operations; final report separates source, package, installed and physical evidence, then stops the selected wave.

## Release sequencing and closure

The master plan selects priorities and tracks NL carry-forward owners. Default original sequence, after authorization, is:

1. Reconcile once: preserve completed source, identify actual missing scope and active owners.
2. Productivity: W01 minimum practice/preflight, W02 manual stack/receipt-safe next, W03 reverse history, W06 sort/notes, W08 preflight, relevant W21/W24.
3. Strategy/messages: W04/W09/W10/W05 and selected W19 gaps.
4. Dual-radio depth: W11, capability-dependent W12/W05, focus and route acceptance.
5. Connected capabilities: W13/W15, existing W16 qualification, W20.
6. Specialist work: W14/W17/W18 and advanced W08/W19.

W07/W22/W23/W24 safeguards apply proportionately where affected. A hardware blocker in one package does not stop unrelated safe software work. No newly discovered actual data-loss defect is deferred just because its original feature wave is later.

Every closeout cites exact implementation source, actual runtime/fixture, relevant package/installed evidence, remaining external gate and owner. Do not sum overlapping suite counts. Do not re-open an accepted feature simply because an older document has an unchecked marker. Preserve all scoped restrictions, current user preferences and original full-programme commitments.

## Existing authority paths to reuse

Before edits, follow current equivalents of these reviewed paths rather than assuming filenames prove whole-product absence:

- `python/contest_host/host.py`, `plugins.py`, `multipliers.py`, `analytics.py` and the current store/audit/query owners.
- `prototype/src/contesting/Not1MMContestWorkspace.tsx`, `DetachedContestSurface.tsx`, `contestSurfaceProtocol.ts`, `contestKeyBindings.ts`, `contestAdifImport.ts`.
- `prototype/src-tauri/src/radio_slots.rs`, `station_session.rs`, `contest_group_chat.rs` and existing CW/PTT/voice admission owners.
- `Sources/XLogPrototypeSupport/LiveWSJTXBridge.swift`, Recorder and worker/session services.
- `python/contest_host/n1mm.py` for current external XML output.
- `docs/cw/IMPLEMENTATION.md` and the preserved CW branch gates; `docs/contest-recorder/IMPLEMENTATION_PLAN.md`.
- `docs/contesting/ALL_CONTESTS_READINESS.md`, its acceptance report, and `REMAINING_LIMITS_ACCEPTANCE_2026-10-26.md`.
- `AGENTS.md`, `docs/DEVELOPMENT_WORKFLOW.md`, `docs/CONSOLIDATION_2026-10-27.md` and current release evidence.

This specification preserves future scope. Reading or publishing it does not start an implementation wave or relax any output, account, platform or protected-data boundary.
