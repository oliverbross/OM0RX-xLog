# OM0RX-xLog — CQRLOG C01–C06 Implementation Programme

**Current delivery — 5 November 2026:** signed isolated candidate 1.5.14 passed
bounded macOS checks but failed the repeated Windows responsiveness gate; the
next correction/candidate is in progress. [Section 14](#14-focused-release-candidate-close-out--5-november-2026-darwin)
and its [release record](../releases/v1.5.14-cqrlog-candidate.md) give exact
source/native/package/CI evidence and qualification limits. Section 13 and the
1.5.13 archive retain their historical evidence. Installed production remains 1.5.9.

**Comprehensive project management and implementation contract**  
**Version:** 1.0  
**Prepared:** 3 November 2026  
**Product owner:** Oliver Bross, OM0RX / VK8RX  
**Implementation lead:** the existing OM0RX-xLog Codex integrator  
**Repository:** [oliverbross/OM0RX-xLog](https://github.com/oliverbross/OM0RX-xLog)  
**Reviewed GitHub `main`:** `2d54f4c2886319def58fc33ba2982b794b9408b6`  
**CQRLOG reference:** `ok2cqr/cqrlog`, `1d2018c386c3cdbe8d478ea26c88e32f67a5004c`  
**Status:** C01–C06 approved by Oliver; implementation and acceptance remain to be reconciled against the active checkout. This document does not claim that the new features have been delivered.  
**Canonical destination:** `docs/planning/OM0RX-xLog_CQRLOG_C01-C06_Implementation_Plan_2026-11-03.md`  
**Companion prompt:** `OM0RX-xLog_CQRLOG_C01-C06_Codex_Prompt_2026-11-03.txt`, reproduced verbatim in section 11.

**Execution update — 4 November 2026:** implementation is active in the canonical
checkout. The original planning labels below are historical initial states;
section 12 and its linked owner evidence record the current task states and
actual checks. No physical qualification or production installation is inferred.

### Contents

- [1. Purpose, scope and immediate handoff](#1-purpose-scope-and-immediate-handoff)
- [2. Verified baseline and authority](#2-verified-baseline-and-authority)
- [3. Joint ownership and collision prevention](#3-joint-ownership-and-collision-prevention)
- [4. Delivery sequence and managed work](#4-delivery-sequence-and-managed-work)
- [5. Shared implementation and migration requirements](#5-shared-implementation-and-migration-requirements)
- [6. Detailed epic specifications and work packages](#6-detailed-epic-specifications-and-work-packages) — C01, C02, C03, C04, C05, C06
- [7. Combined acceptance, validation and release](#7-combined-acceptance-validation-and-release)
- [8. Project tracker, decisions and risks](#8-project-tracker-decisions-and-risks)
- [9. Definition of done and operator handoff](#9-definition-of-done-and-operator-handoff)
- [10. Source and reference register](#10-source-and-reference-register)
- [11. Copy-ready Codex execution prompt](#11-copy-ready-codex-execution-prompt)

## 1. Purpose, scope and immediate handoff

Implement all six selected improvements as an addition to the ongoing QLog programme. Preserve the selected QLog features, their task identifiers, the existing TLF selections, the working application and the progress already made. The intended result is a consistent callsign/location foundation and a more complete station operating surface: native TCI PTT/CW, better WinKeyer control and feedback, useful live CW composition, and reliable voice memories in ordinary SSB operation.

This is an execution document. It includes scope, ownership, dependencies, data and runtime contracts, task breakdowns, acceptance scenarios, integration checks, evidence tracking and a Codex prompt. Start implementation after a short reconciliation of the current checkout; do not turn the handoff into another open-ended comparison exercise. A type definition, settings toggle, disconnected mock or unfinished backend does not complete an operator workflow.

### 1.1 Selected CQRLOG comparison items

The original candidate IDs are retained. `C1–C6` in Oliver's instruction means `C01–C06` below; these IDs are separate from QLog's `EP-*` IDs.

| Epic | Required operator outcome | Main delivery concern |
|---|---|---|
| C01 | One consistent callsign/country result, with home identity separated from actual operating location | Shared interpretation and provenance across logging, cluster, maps, alerts and award inputs |
| C02 | Richer versioned country data and a selective, explainable correction review | Controlled data evolution without rewriting protected or historical evidence automatically |
| C03 | Native TCI PTT and CW through the current radio session | Real provider-aware transmit admission, Stop/release and honest device capability |
| C04 | Useful WinKeyer preferences, physical speed-pot behavior and reported progress | Extend the existing host actor without losing flow control or paddle interruption |
| C05 | Deliberate CW keyboard composition and refined messages | One CW scheduler with the selected TLF work and one command registry with QLog |
| C06 | Existing voice memories available in normal SSB, with reliable native device routing | Reuse the voice library and native owners; verify the selected audio and PTT route |

All six are required. Delivery order is based on dependencies and operating value; a later milestone is not permission to omit an epic. Ordinary supporting migrations, compatibility adapters, focused tests, operator help and diagnostics are included where they directly enable these outcomes.

### 1.2 Continuing approved work

The canonical QLog plan remains authoritative for its own scope and progress:

`docs/planning/OM0RX-xLog_QLog_Implementation_Plan_2026-11-03.md`

| QLog epic | Previously selected scope, unchanged |
|---|---|
| EP-01 | Structured reusable logbook filters and consistent list/count/export semantics |
| EP-02 | Actionable awards and supporting-QSO drilldown; local WAC, WPX, IOTA, POTA, SOTA and WWFF progress |
| EP-03 | Richer actionable DX alerts |
| EP-07 | Nearby spotted-callsign suggestions with explicit acceptance |
| EP-08 | Software antenna profiles and association with existing rotor facilities |
| EP-09 | Narrow portable presets, per-QSO own-station context and POTA export |
| EP-12 | Geographic display of the existing own-call RBN reports |
| EP-15 | Context-aware normal-logging shortcut customization |
| EP-16 | Editable visual band-map guides and optional beacon markers |

The separately approved TLF work remains: phase 1 per-part CW speeds and preview, early-start CW typing, OK/OM DX CW and partial-callsign correction; phase 2 WAE live QTC workflow/opportunities; phase 3 station-pass actions and operating-time/band-change guidance. The simulator remains excluded. At startup, locate the actual existing TLF task/evidence record in the active session or repository. Its canonical filename was not established in this review; do not invent one or falsely claim a TLF task complete. C05 owns only its new composition requirements and coordinates shared CW primitives with the existing TLF owner.

This plan is an additive contract. It does not replace the QLog plan, reset its states, renumber its tasks, restart its programme or assign its completed work to a new implementation. A shared change can satisfy requirements in two plans; both point to one implementation and the same evidence.

### 1.3 Explicit scope limits

C07–C12 from the CQRLOG comparison remain later candidates: radio-internal voice slots, broader radio-memory management, general station-profile orchestration, physical SO2V/SO2R contest-lane qualification, paper-QSL/manager workflows and club/activity data. Do not introduce them as prerequisites. Existing functionality in these areas continues to work.

Native TCI **transmit-audio injection** is also a separate later stage. C03 supplies PTT/CW; C06 uses qualified native OS audio routes and the existing supported radio paths. A future TCI audio-stream engine is not required for this selected tranche and must not be implied by a working TCI PTT button.

The unselected QLog scopes remain unselected: a universal activity/profile system, new confirmation-provider integrations, sponsor-granted award credit, general bulk editing, paper QSL, clubs and generic CSV export. C02's country/location correction review is a specifically approved, bounded extension to the existing data-quality tools; it does not authorize an arbitrary bulk-record editor.

## 2. Verified baseline and authority

### 2.1 What was checked for this handoff

The GitHub branch and compare APIs were read on 3 November 2026. `main` at `2d54f4c2886319def58fc33ba2982b794b9408b6` is one commit ahead of the comparison baseline `f15dbb11eb727419689869f8f4907ed9b4809970`. The sole changed path is the added 980-line canonical QLog plan. The commit is titled `docs: import selected QLog implementation contract and baseline`. Therefore the reviewed application-source findings from the CQRLOG comparison still apply to this pushed snapshot. [B01–B03]

The imported QLog plan already records implementation as in progress, an integrator for EP-01/02 and shared release, three lanes covering EP-03/07/15, EP-08/09 and EP-12/16, and an existing CW-skimmer worktree to preserve. Those are recorded assignments, not proof that every worker is still active. The implementation environment may contain newer commits or unfinished work that GitHub cannot reveal. Reconcile those before making changes. [B03]

The repository's installed-version record at the reviewed baseline is 1.4.8, with package source `2ae0939d1a69fb8c8210a24880b04929b8d46d7c`. That is historical source evidence, not a fresh inspection of Oliver's installed application and not the requested next version. [B04]

### 2.2 Source-confirmed foundations and gaps

| Area | Existing foundation | Selected completion work |
|---|---|---|
| Country | Core resolver with exact exceptions, slash calls and dated XML; separate live cluster directory | Remove the real algorithm and active-data divergence; preserve domain-specific contest identity |
| Location | Online enrichment and current data-quality/correction tools | Prevent a same-entity portable call's home coordinates from masquerading as its operating site |
| Reference data | Validated staged update and usable downloaded data, with bundled fallback | Richer normalized rules, one publication path and a per-field selective impact review |
| TCI | Direct receive control, status, spots and IQ; typed encoders for some control messages | Implement and admit PTT/CW through current native ownership, not merely expose a flag |
| WinKeyer | Existing WK2/WK3 host actor with XOFF, status, urgent Stop and paddle interruption | Add bounded documented preferences, pot events and character-echo presentation |
| CW | Twenty ordinary memories, token preview and contest message/ESM ownership | Add composition modes, exact preview/output agreement and integration with TLF speed/correction work |
| Voice | Contest microphone recording, validated PCM assets, ordered preparation and PTT lifecycle | Share with normal SSB and replace the playback routing boundary with a dependable native route |

Detailed source anchors and behavioral requirements are attached to the epic sections and section 10. The current presentation is React/TypeScript under `prototype/src`, the desktop bridge is Rust/Tauri under `prototype/src-tauri`, and shared Swift services are under `Sources`. The historical directory name `prototype` is not a reason to implement only in the older SwiftUI application. [B03, X01–X23]

### 2.3 Execution authority and precedence

Use Oliver's selected scope and current session authorizations, the actual current repository instructions, the canonical QLog/TLF task records, and this addendum together. If a routine design detail differs from a historical example here, choose the implementation that meets the behavior in current code and record the decision. Never reset to a pinned planning SHA. Never replace a newer canonical plan with an older downloaded copy.

The reviewed `AGENTS.md` and development workflow require logical commits, proportional tests, immediate push of completed commits, exact source/version provenance and packaging only from the canonical checkout. Their older recovery baseline is historical; it is not an instruction to roll back current `main`. Preserve unrelated user and worker changes. Documentation-only changes require no application version bump. [B05–B06]

Oliver has authorized learning from and reusing the friend's project. Use that permission to move forward. Retain source attribution and check the actual terms for any specific code or data incorporated; permission from one project contact does not identify every contributor or reference-data right. Independent implementation of the observed behavior is a practical default where direct reuse is unclear. Do not stop unrelated implementation or create a new approval ritual around this routine provenance work. The plan does not require wholesale Pascal-to-Swift/Rust copying. [R01–R03]

## 3. Joint ownership and collision prevention

### 3.1 One integrating session

Prefer giving the companion prompt to the **same Codex session currently implementing QLog**. Finish its current coherent edit/test/commit batch, import this file, and add the new work to its queue. Do not start a second uncontrolled writer in the same checkout.

If another implementation session is required, inspect actual branch/worktree/process/task ownership first. Use the repository's existing isolation rules and a nonoverlapping file scope. Shared-owner edits need an explicit handoff to the current integrator. A planning table is coordination evidence, not a filesystem lock, permission bypass or reason to wait indefinitely. While an owner finishes a bounded batch, continue independent implementation, fixtures and review. Preserve the existing CW-skimmer worktree and any unique work in it.

### 3.2 Existing owner map

| Owner boundary | Continuing authority | C01–C06 responsibility |
|---|---|---|
| Logbook queries, transactions and evidence projections | Existing native logbook owner and QLog EP-01/02 lane | Supply resolution facts and narrow correction operations through that owner |
| Country and reference snapshots | Existing reference updater/resolver owner, extended by C01/02 | Consolidate resolution and publish coherent immutable snapshots |
| Alerts, suggestions and spot activation | Existing retained observation/draft owners and EP-03/07 lane | Supply fact/provenance fields; preserve current action admission |
| Normal command registry and conflict checking | EP-15 owner | Register CW/voice actions once; retain native execution and Stop owners |
| Antenna and own portable context | EP-08/09 owner | Consume the existing IDs/context; do not introduce a general station profile |
| Maps/RBN and visual guides | EP-12/16 owner | Supply honest location precision; do not create feeds or visual mode authority |
| Native radio/PTT/TX ownership | Existing radio slot, PTT and station services | C03 provider-aware extension and C06 bounded voice admission |
| CW scheduling and transport | Existing native CW owner plus selected TLF worker | C04 device feedback and C05 composition through the same queue |
| Voice assets and audio | Existing contest voice/recording owners | C06 shared assets, normal-mode adapter and native output route |
| Shared settings, schema migration, release | Current integrator | Serialize shared edits, reserve migration versions once, verify combined delivery |

Use current source paths as navigation anchors, not a command to give each worker an entire file. Changes to `LiveLogbookMethods`, `LiveClusterMethods`, central worker routing, native command registration, preferences, `Map.tsx`, the QSO editor and keyboard handlers are integration points. The same integrator reviews and commits overlapping hunks.

### 3.3 Required cross-programme contracts

1. **Facts and policy:** C01/02 supply callsign, location and reference provenance. QLog awards/alerts and contest owners decide eligibility, counting and action behavior. An ADIF entity number is not a universal WPX prefix or CQ WW multiplier key.
2. **Contact and own station:** A contacted station's home/operating location is separate from EP-09's own transmitting station/operator context. Both keep historical evidence; the computer's location is not either station's RF location.
3. **One keyboard dispatch:** EP-15 owns action IDs, chord normalization, context and conflicts. C05/06 supply actions and their execution adapters. Native/contest Stop remains authoritative; buttons work while optional shortcut configuration is still being completed.
4. **One CW/TX route:** C03/04/05/06 extend current owners and share the process-wide transmit exclusion. Radio selection is not transmit ownership. Stop/release targets the original acquired route even if a visible selection changes.
5. **Input origin:** Suggested calls, Tune & load, provider enrichment, imported corrections, preset restoration, undo and reference refresh are programmatic changes. They cannot trigger early-start CW. Only deliberate operator input admitted by the explicit armed CW surface or selected TLF live-typing mode can do so; Paste/import is staged for explicit Send, including in character mode; IME preedit never sends. Programmatic field changes and manual entity/location corrections remain non-typing origins. An input-origin label alone confers no transmit authority: native admission, arming and route checks still apply.
6. **One migration/publication:** Reserve schema and preference changes through the integrator. Country publication emits one coherent revision to ordinary consumers. Stored-record correction uses canonical mutation receipts. Pinned contest snapshots and frozen export/award transactions stay internally consistent.

### 3.4 QLog collision matrix and C05/TLF integration

| Existing QLog owner and unchanged IDs | CQRLOG intersection and shared contract | Integration order and concrete regression protection |
|---|---|---|
| **EP-01 — structured filters**, EP-01.1–EP-01.6; A01-01–A01-05 | EP-01 remains owner of the typed predicate/compiler, saved-query migration and list/count/frozen-export semantics. C01/C02 supply clearly distinguished recorded and derived entity/zone/location evidence; C02 consumes EP-01 selection for selective repair where available. Agree field provenance and dataset-version behavior before modifying query projections. C02 does not introduce another saved-filter schema or query evaluator. | Continue filter delivery independently. Repair can initially select explicit QSO IDs through existing native selection; it need not wait for the complete filter editor. Country-table updates must not silently change the meaning or membership of an already frozen query/export/repair preview. Reuse A01-01/03/04 for exact IDs, snapshots and concurrent preferences; add C02-specific invalidation/receipt assertions. |
| **EP-02 — awards**, EP-02.1–EP-02.7; A02-01–A02-06 | EP-02 owns award rules, programme-specific membership/eligibility, compact contact projections, aggregate caches and supporting-QSO navigation. C01 owns canonical contact identity/geographic resolution; C02 owns dataset versions and explicit repair. Provide stable entity IDs, provenance, as-of date, uncertainty and reference revision without replacing sponsor rules. A DXCC operating prefix is not automatically a WPX award prefix. | Agree the resolver adapter and invalidation event early; existing drilldown and independent calculators continue against compatible existing data. Add resolver/data revision to affected derived cache identities, retaining manual recorded values and recorded own-country scope. Preserve worldwide candidate selection, local-evidence-versus-credit distinctions and existing specialist packs. A02-01/02/04/05 plus C01/C02 cases prove totals and evidence change together. |
| **EP-03 — DX alerts**, EP-03.1–EP-03.6; A03-01–A03-06 | The existing Swift cluster path (`LiveClusterMethods`, `ClusterSessionService` and `ClusterCountryDirectory`, reconciled against current source) supplies shared C01 facts through retained spot projections. The Rust `dx_alerts` owner continues to evaluate rules and own baselining/history. Preserve DX-versus-spotter distinctions and retained observation identity. Do not implement another resolver in Rust or the renderer, or open another cluster connection. Country fallback and precise station location remain separate. C03 expands only the existing station adapter's proven capabilities behind the normal activation transaction. | Country resolution and alert UI may proceed separately once DTO/fixture expectations are agreed. A table refresh does not emit historical alerts anew or make a historical observation tunable. Review/Tune & load remains explicit and generation-checked. Programmatic callsign fill from Tune & load must never trigger C05/TLF early-start CW. Reuse A03-01/03/04/05/06 and attach cross-feature assertions to the existing fixture. |
| **EP-07 — nearby callsigns**, EP-07.1–EP-07.5; A07-01–A07-06 | EP-07 remains owner of the RX-frequency candidate projection and the explicit callsign-only draft mutation. C01 may enrich the candidate's description, preserving the exact reported call. C03 must distinguish fresh selected RX identity from TX identity; C05 must recognize the mutation's non-typing origin. C05/TLF contest partial-call correction does not replace EP-07 Normal Logging assistance. | Deliver the button/admission path without waiting for C01/C03/C05 or the complete shortcut editor. Later bind the stable action through EP-15. Acceptance still emits no tune, CW, PTT, voice, rotor or save action—even when the CW workbench is armed or contest early-start was enabled elsewhere. Reuse A07-02–05 with an output-command spy. |
| **EP-08 — antenna profiles**, EP-08.1–EP-08.6; A08-01–A08-07 | EP-08 owns software antenna records, deterministic TX-band association, existing rotor references/offsets, QSO metadata snapshots and backups. C01/C02 keep own-station location distinct from remote-computer location; C03 must expose trustworthy TX context or unknown. C04/C06 may refer to the existing radio slot identity, but this does not add broad composed station presets (C09) or rotor protocols. | No epic-level dependency on new TCI CW or CQRLOG work: manual profiles work with current backends. With unverified TCI TX band, retain explicit/manual antenna selection and show unknown; never substitute RX band for TX. Profile edits do not transmit, connect, rotate or reconfigure a keyer. Preserve A08-03/04/06/07. New rotor limits/jog/controller support is outside C01–C06. |
| **EP-09 — portable context/POTA**, EP-09.1–EP-09.6; A09-01–A09-09 | EP-09 owns portable defaults, current-draft choice, immutable per-QSO own context, on-air call preservation and POTA projection. C01 owns interpretation and provenance; C02 may offer separate explicit historical repair, never automatic backfill from current defaults. C05/C06 render future outgoing messages from the current approved draft/context without rewriting an already accepted output plan. | Settle own/context field precedence with EP-09.2; let the portable editor/export proceed independently. Loading/ending a preset, provider enrichment, reference refresh and other programmatic field changes never count as live-CW typing. An already accepted message retains its captured station/serial context; a changed context requires a new explicit send. Preserve A09-01/02/04/06/09, particularly exact portable calls and one local QSO versus expanded export records. |
| **EP-12 — own-call RBN map**, EP-12.1–EP-12.4; A12-01–A12-08 | EP-12 owns one retained reception feed, exact monitored on-air call, source-time freshness and receiver-location projection. C01's base-call parsing must not broaden exact OM0RX versus OM0RX/P matching or invent receiver coordinates from a country centroid. C03/C05/C06 do not attribute reports to a radio/antenna solely because it was selected or sent under the same call. | Independent work; no need to await the resolver, voice, keyer or new decoder. Feed callbacks and marker interactions are passive. Preserve A12-02/03/06/07 with C01 portable identities and uncertain location data. A marker does not gain transmit or reply authority from the new backend capabilities. |
| **EP-15 — shortcut customization**, EP-15.1–EP-15.6; A15-01–A15-06 | EP-15 owns typed action IDs, chord normalization, conflict/reserved-context policy, settings and help. Normal CW and contest owners retain their existing execution/admission, macro mappings and Stop routes. C04/C05/C06 register supported actions and capability/applicability metadata through that policy; they do not create a second shortcut editor, OS-global hook or independent keydown dispatcher. Contest binding ownership remains separate and contextual. | Agree action registry/conflict contracts early with the recorded EP-03/07/15 lane. Visible CW/voice controls can ship before the customization editor. Serialize shared key-routing edits and integrate registrations after the contract lands. Preserve A15-01–06; prove one action per intent across native/webview/detached delivery and preserve Stop during capture/IME/dialog activity. |
| **EP-16 — band-map guides**, EP-16.1–EP-16.6; A16-01–A16-06 | EP-16 owns visual ranges/markers and per-surface guide preferences. C01/C02 may improve spot labels through existing classification; C03 extends only the admitted station route. Guide colors, labels and mode hints never become country evidence, transmit permissions, radio memory plans or CW start signals. Radio memories (C08) remain outside C01–C06. | Independent implementation. Keep guide/default migrations separate from resolver and keyer settings. Existing explicit marker Tune remains a tune-only action via the current owner. Later telemetry may follow the existing draft policy, but must not trigger C05 because field changes were programmatic. Preserve A16-01/03/04/05/06; no new map window or feed is needed. |

## 4. Delivery sequence and managed work

### 4.1 Integration milestones

These are coherent integration boundaries, not separate compulsory releases. Keep the existing QLog milestone/task IDs unchanged. If the active QLog lane has already passed a boundary, adapt to its implemented contract and avoid repeating that work.

| Milestone | Required CQRLOG work | Relationship to ongoing work | Exit evidence |
|---|---|---|---|
| CM0 — Reconcile and assign | Import plan, inspect actual SHA/dirty changes, identify owners, agree shared contracts | Finish current QLog batch; do not restart QLog or TLF | Actual baseline, owner table, completed-work reconciliation and next tasks |
| CM1 — Consistent identity | C01 neutral result and consumer adapters; C02 pack/schema contract | Agree facts needed by EP-02/03/07/09/12; those UIs may continue against the contract | Slash/portable corpus, cross-consumer agreement and no historic mutation |
| CM2 — Controlled country evolution | C02 validation/publication, per-field review/apply and recovery | Reuse EP-01 query contract when present; never block on the whole filter editor | Invalid-pack retention, same-entity correction, conflict/manual protection and one invalidation |
| CM3 — Device capability | C03 TCI PTT/CW; C04 WinKeyer settings and feedback | Independent of most QLog UI work; serialize native TX/CW contract edits | Provider-aware protocol/admission evidence and device qualification matrix |
| CM4 — Operating surfaces | C05 CW composition/TLF integration; C06 normal voice/native routing | Reuse EP-15 registry and current TLF scheduler; visible controls have no whole-epic shortcut dependency | Actual normal/contest workflows, Stop/paddle/route/device-loss evidence |
| CM5 — Combined delivery | Selected epics, combined QLog regressions, migration/restore, operator help and exact-source candidate | Combine with QLog's integrated delivery when appropriate | Evidence ledger, required gates and a concise feature/qualification handoff |

CM3 can proceed while CM1/CM2 mature in nonoverlapping files. C06 asset/native-audio work can proceed independently of C03; its initial PTT adapter uses a supported current route. C05 can develop composition/UI against the existing CW interface while the TLF/EP-15 owners settle shared fields. A whole QLog epic, a whole TLF phase or deferred native TCI audio must not become an artificial prerequisite.

### 4.2 Coordination tasks

| Task | Deliverable | Dependency | Acceptance/evidence | Current state |
|---|---|---|---|---|
| CP-T01 | Record current checkout/SHA, relevant changes since the planning baseline, actual QLog/TLF progress and unique existing work | Current coherent batch boundary | CM0 baseline entry; no reset or duplicated completed feature | Verified: reconciliation preserved canonical work |
| CP-T02 | Assign shared-owner edits and settle neutral facts, command/input-origin, CW/TX and migration contracts | CP-T01; existing owners participate | Ownership table; cross-links to affected existing task IDs | Verified: bounded ownership and handoffs |
| CP-T03 | Integrate C01/02 with QLog awards, alerts, suggestions, portable context and maps | Relevant C01/02 tasks and consumer adapters | CX-A01–CX-A05, CX-A11 | Software verified; native country apply/recovery verified |
| CP-T04 | Integrate C03/04/05/06 with TLF, EP-15 and current station controls | Relevant station/CW tasks and shared registry contract | CX-A06–CX-A10, CX-A12 | Software verified; connected output qualification Not run |
| CP-T05 | Verify combined settings/backup migration and measured shared performance | A coherent integrated candidate | CX-A09–CX-A11; existing applicable QLog acceptance | Combined restore and signed 100k verified; controlled-cold Not run |
| CP-T06 | Complete source/evidence review, operator help and permitted release candidate/handoff | Required tasks and integrated acceptance | Section 9 definition of done; truthful platform/hardware boundaries | Signed/private/platform source gates verified; physical/runtime-package boundaries separate |

### 4.3 Working ownership table

Populate at CM0 and update only when ownership or integration boundaries change. Refer to the actual existing worker identity; do not invent a worker or spawn a replacement for an active owner.

| Scope | Owner at execution | Branch/worktree and base SHA | Shared files/interface reserved | Current task / handoff point | State |
|---|---|---|---|---|---|
| Integrator, schema, shared native routing, release | To reconcile | To record | Common schemas and overlapping hunks | CP-T01/02 | Planned |
| Existing QLog EP-01/02 | Preserve actual owner | To record | Query/award evidence interfaces | Keep current QLog task | Existing programme |
| Existing QLog EP-03/07/15 | Preserve actual owner | To record | Alert/suggestion/command registry | Keep current QLog task | Existing programme |
| Existing QLog EP-08/09 | Preserve actual owner | To record | Antenna/own-station snapshots | Keep current QLog task | Existing programme |
| Existing QLog EP-12/16 | Preserve actual owner | To record | RBN/map/guide contracts | Keep current QLog task | Existing programme |
| Existing TLF CW work | Reconcile actual owner | To record | Message segments, early start, corrections | Shared C05 boundary | Existing programme |
| C01/02 | Assign bounded owner | To record | Resolver/pack and correction interfaces | CM1/CM2 | Planned |
| C03/04 | Assign bounded owner | To record | Provider target and device actor | CM3 | Planned |
| C05/06 | Assign bounded owners if files separate | To record | CW/voice UI and output adapters | CM4 | Planned |

A stale owner entry must be reconciled by the integrator against actual work and communication. Do not overwrite dirty files because a task is marked Planned. Do not leave all work blocked because a particular shared file is temporarily owned elsewhere.

## 5. Shared implementation and migration requirements

### 5.1 Context, persistence and concurrency

All asynchronous mutations must carry the existing workspace, draft/record revision, selected radio and connection/session generation required by their owner. A late lookup may update a cache but cannot overwrite a newer callsign, manual field, different workspace or different active operation. Use existing cancellation, transaction, operation-receipt and conflict mechanisms instead of parallel persistence.

Keep raw ADIF and unknown application fields. Derived indexes and country resolution are not permission to rewrite the logged callsign. Keep UTC QSO/observation times authoritative; never use today's date for a historical dated-rule decision. Keep missing values distinct from explicit false, unknown entity, a zero numeric measurement and valid zero latitude/longitude.

New settings use stable IDs, versions, validation and existing backup/restore. Preserve unrelated settings when two lanes modify the same document. Negotiate one schema migration sequence with the integrator; independent workers must not both reserve the same version number or overwrite each other's defaults. Prefer additive storage and explicit adapters. State downgrade/restore requirements accurately instead of promising an older binary can read a new schema.

### 5.2 Migration register

| Change | Preserve | Upgrade/compatibility requirement | Recovery evidence |
|---|---|---|---|
| C01 shared resolution | Literal calls, manual/explicit imported facts, legacy endpoint consumers and pinned contests | Add rich result/adapter; migrate consumers deliberately; remove duplicate algorithm only when its real callers are switched | Old call-path tests plus new agreement corpus |
| C02 reference pack | Last usable snapshot, source versions and historical records | One validated normalized pack for bundle/manual/download; atomic publication | Rejected/corrupt pack leaves prior snapshot active; previous snapshot can be restored |
| C02 selected correction | Contact ID, unchanged fields, trusted overrides, QLog query semantics | Per-field proposal and revision-checked canonical apply; reviewed fields only | Receipt or reversible before-values sufficient to restore the applied correction, with conflict checks |
| C04 device preferences | Existing port and requested WPM, queue/Stop behavior | Versioned supported settings keyed through existing device/radio identities; distinguish requested/effective/pot-reported speed | Old preference and disconnected/unsupported device fixture |
| C05 messages/composition | Existing twenty memories, colors, shortcuts, contest banks, serial semantics | Extend shared typed message representation where necessary; preserve old literal/token expansion | Legacy message preview/send equivalence and TLF correction/speed fixtures |
| C06 voice library/routes | Existing recorded/imported assets, ordered manifests, contest behavior and bounds | Shared library and explicit route settings; new normal UI uses same owner | Old contest library opens; missing/unavailable device cannot silently substitute a transmit route |
| Joint preferences | QLog saved filters, antenna/portable context, guides and bindings | One merge-safe migration and restore through existing owner | Representative old backup upgrade and new combined backup restore |

No migration initiates PTT, sends CW/voice, moves a rotor, changes an unfinished QSO or auto-applies a correction. Recording an audio file and local monitor preview are distinct from transmitting it. Device setup must make the active audio route understandable without exposing internal generations/hashes in the ordinary operating flow.

### 5.3 Performance and UI quality

Resolve against immutable in-memory/indexed reference snapshots in station paths. Do not perform a network lookup, reread the country pack or scan the complete log on each typed character or spot. Review large correction sets in bounded/paged work, cancellable independently of station operation. Reuse the QLog representative large-log fixture and measure on the same host before/after; do not create another expensive synthetic benchmark programme.

Keep send/Stop and radio event processing separate from long reference scans and audio preparation. Queue bounds, device timeouts and audio callback limits must be explicit and observable. Establish any changed timing budget from the existing owner and protocol evidence; tests must demonstrate that Stop bypasses queued work and does not wait for a large pasted message or asset load.

Reuse existing settings, QSO, CW, contest and audio surfaces. Controls must be focusable, readable in compact/detached windows and meaningful without color alone. Show unknown/unavailable/stale state clearly. Distinguish requested commands, transport acceptance, device-reported state and physical output; a UI queue becoming empty is not proof that RF was transmitted.

## 6. Detailed epic specifications and work packages

The C01–C06 task rows carry initial planning states. At CM0, reconcile them against the active checkout and existing evidence; credit verified work and retain work already in progress. Do not reset either programme’s tracker merely because this document initially labels a row Planned. Task names and implementation paths may be refined to fit newer source, but the selected behavior and acceptance remain required. Each epic's task IDs use `Cxx-Tnn`; acceptance uses `Cxx-Ann`. QLog identifiers remain unchanged.

### C01 — Consistent callsign, country and operating-location resolution

**Priority:** first implementation tranche. **Status:** Planned; source review completed, implementation and acceptance not run. **Purpose:** the same operating call, date, reference snapshot and interpretation must produce consistent country facts in the actual Logbook, cluster and DX views, while preserving the difference between an operator's identity and the station's operating location.

#### C01.1 Baseline and the specific gap

The reviewed core `CTYResolver` already handles full-call exact exceptions, ordinary `/P`, foreign operating prefixes on either side, dated XML rules, the KG4 exception and leading `MM` as Scotland. This epic extends that capability and fixes its integration; it does not start a new country parser beside the existing one.

The reviewed `ClusterCountryDirectory` tries the full call and then longer slash components first, whereas the core resolver checks full-call exact exceptions before shorter operating components. Consequently, a call shaped like `OM0RX/EA8` can receive Slovakia in the cluster and Canary Islands in the core resolver. The actual cluster host supplies bundled CSV; the logbook can select downloaded Club Log XML; the cluster's retained-contact projection also has a static bundled resolver. A fix confined to a helper or parser test would leave these consumers divergent.

There is also an important coordinate distinction. `CallsignEnrichment` protects against some foreign-entity/home-profile mismatches, but matching the same DXCC entity does not prove that an ordinary `/P` station is at its home address. Country-level inference and actual operating position must be represented separately. `OM0RX/P` can be in Slovakia without being at Oliver's registered QTH, and remote operation of the Slovak station from Darwin must not move the transmitter to Australia.

**Source register:** X01–X09 and R02–R03. **Source touchpoints to reconcile at execution:**

| Owner / file | Bounded responsibility in C01 |
|---|---|
| `Sources/XLogCore/CTYResolver.swift`, `Tests/XLogCoreTests/CTYResolverTests.swift` | Extend the current resolution semantics and compatibility adapter; retain exact-call/date behavior and existing tested distinctions |
| `Sources/XClusterIntegrationCore/ClusterCountryDirectory.swift`, `ClusterSessionService.swift` | Replace independent country decisions with a thin shared-facts adapter; keep retained observations, classification and session ownership |
| `Sources/XLogPrototypeSupport/LiveClusterMethods.swift` | Wire the selected snapshot into live spot and historical-contact classification; remove static/bundled divergence where semantics should be shared |
| `Sources/XLogPrototypeSupport/LiveLogbookMethods.swift` | Reuse the current reference selection/cache, draft/logbook owner and bounded projections; add only agreed fields |
| `Sources/XLogPrototypeSupport/CallsignEnrichment.swift` | Keep profile enrichment distinct from operating-location evidence; preserve useful offline inference |
| `Sources/XLogCore/OperatingSupport.swift`, `Models.swift` | Extend existing evidence/provenance types only as needed; retain manual and imported values |
| Existing contest-session/Not1MM integration owners | Record or reuse pinned reference identity and preserve contest-specific interpretation; do not replace the scoring engine |
| QLog-owned query, award, alert, suggestion, portable and map adapters | Consume agreed neutral facts through small coordinated changes; retain their existing product ownership |

Paths describe the reviewed architecture, not instructions to overwrite another lane's current work. Resolve the actual current owner/type names after the active QLog work is inspected. Avoid creating a package dependency cycle between core and cluster targets; a narrow injected resolver interface or shared value projection is sufficient when direct reuse is not possible.

#### C01.2 Contract with the active QLog programme

The canonical QLog plan remains `docs/planning/OM0RX-xLog_QLog_Implementation_Plan_2026-11-03.md`. Its EP identifiers and approved scope do not change.

| QLog owner | C01 supplies | C01 must preserve |
|---|---|---|
| EP-01 filters | Stable resolved or retained entity/zone facts with known/unknown provenance | EP-01 alone owns typed query semantics, saved-query storage, list/count/export predicates and filter UI |
| EP-02 awards | Entity at QSO date, operation qualifiers, reference revision and field provenance | EP-02 owns sponsor eligibility, confirmation/credit policy, own-station scope, WPX award prefix rules, evidence queries and progress UI; a country lookup does not award credit |
| EP-03 alerts | Consistent DX and spotter geography, separately identified, plus unknown status | EP-03 owns rule matching, history/deduplication and the existing explicit review/tune path; missing evidence must not start matching |
| EP-07 nearby calls | Literal normalized on-air call and an optional operator-identity relation | EP-07 owns freshness, radio/draft checks, ranking and explicit acceptance; do not replace an on-air portable call with its base call |
| EP-09 portable context | The meaning/provenance of country and location fields when it requests resolution | EP-09 owns presets, own-location snapshots, active-context identity and POTA export; do not rebuild its snapshot model or backfill old MY_* fields |
| EP-12 Heard me map | Optional country label as contextual information | EP-12 still requires source coordinates or a validated locator for a receiver marker; a country centroid is not receiver-position evidence, and monitored calls keep their suffixes |

Agree the minimal value/API extension with those owners first. Pure resolver work and fixtures can proceed independently. Serialize modifications to `LiveLogbookMethods`, compact projections, shared IPC/settings schemas and consumer UI at an explicit handoff. Do not pause the whole QLog programme or require every QLog epic to finish before C01 starts. If a QLog owner has already added the needed field/type, extend it and mark the duplicate task satisfied with evidence.

#### C01.3 Required resolution and provenance behavior

Use a small immutable result carried through the existing owners. Names are illustrative; these semantics are required:

- **Input identity:** the literal on-air call, normalized lookup value and relevant UTC observation/QSO time. The stored call is not rewritten to an inferred base call. Normalization must preserve meaningful slash components; invalid/incomplete input must not silently turn into a different apparently valid station.
- **Operator relation:** optional inferred base/operator call, with its own evidence. This is useful for profile lookup, but is not permission to merge contacts, select contest duplicates, strip RBN monitored-call suffixes or replace `CALL` in exports.
- **Operating facts:** effective operating prefix, recognized qualifier such as portable/land-mobile/maritime-mobile/aeronautical-mobile, and any dataset-supported area/subdivision. A generic `/P` is not a locator. Country-specific meanings are evaluated before a generic suffix fallback.
- **Entity result:** resolved, known-no-entity, ambiguous, unknown or invalid; optional ADIF entity and entity-validity information. Known absence of a DXCC entity is a separate value from unknown. Do not serialize missing information as `DXCC=0`: ADIF uses zero for a station known not to be within a DXCC entity.
- **Geography:** entity, continent and CQ/ITU zones may be inferred facts. Actual coordinates/grid have a separate precision/source class: supplied operating coordinates, supplied operating locator centre, home/profile location, entity approximation or unavailable. Do not label a home/profile location or entity centroid as the portable operating point.
- **Provenance:** reference snapshot identity, rule/algorithm policy version, matched rule/source and any date window; field provenance where different sources contribute different facts. Retain reported source version separately from local content digest, download time and check time. A hash may identify a revision without pretending the provider published that version.

Keep this result independent of a universal `awardEligible` flag. The resolver exposes facts and exclusion evidence; QLog EP-02 and the existing contest owner interpret those under their own rules. For example, ARRL DXCC distinguishes land operation from maritime/airborne operation and includes a permanently docked exhibition-ship exception. A literal suffix or generic country match alone does not establish sponsor-issued credit.

**Deterministic matching policy:**

1. Preserve separately supplied, verified per-record values; show the new inference beside them. An imported/stored value with unknown origin must not be relabelled “manually verified”, “automatic” or “safe to replace”.
2. Consider date-valid exact exceptions for the complete call, including slash forms, before generic reduction. A dated expedition exception must not lose to an ordinary home prefix.
3. Parse operating prefix, operator call and modifiers by a documented bounded policy. Preserve leading `MM` as a Scottish prefix; recognize trailing `/MM` or `/AM` as operating qualifiers. Apply explicitly supported country/area rules before ordinary `/P`, `/M`, `/QRP` or `/LH` fallback handling.
4. Select the applicable date-valid rule using documented source authority and specificity, not file order or the latest download timestamp. Equally authoritative contradictory results are reported as ambiguous. A shorter string is not automatically a valid geographic prefix.
5. Retain deleted/historical entities where applicable at the record's date. A historical lookup uses that QSO date; a missing/invalid date is not silently replaced with today. Keep historical validity separate from whether a present-day award includes deleted entities.
6. Resolve optional location enrichment separately. A callbook profile can enrich operator name/contact information without overriding the inferred operating entity or supplying false portable coordinates. Same-country portable operation still needs position evidence.

Do not silently change every old `CTYResolver.resolve()` caller at once. Existing tests deliberately return the home entity for `LY3X/MM` and `OM0ABC/MM`. Introduce the richer result and adapt callers explicitly, retaining a clearly documented compatibility endpoint where needed. The acceptance target is that new consumers receive correct operation facts and do not misuse the legacy home-entity result as land-operation evidence; existing stored rows remain untouched until the C02 reviewed correction flow.

#### C01.4 Snapshots, live updates and contest behavior

Reuse the current native reference owner. One immutable snapshot identifies the active normalized data and interpretation policy. Consumers use it through the actual host wiring; no renderer-side country parser, per-spot download or second reference updater is introduced.

Resolve a retained QSO at its own time and a spot at its retained observation time. Cache identity includes normalized full call, relevant date semantics, snapshot/policy identity and any explicit evidence that affects the answer. Store/cache only what the existing workload requires; no background reprocessing of every QSO for each incoming spot.

A general reference update publishes a new snapshot once. Invalidate/reclassify the affected derived views through existing owners, retaining spot identity and source timestamps; do not replay old alerts or make old spots fresh. QLog EP-02 retains its programme/rule/query-specific cache identity and incorporates the reference revision supplied here. Changes to an unfinished draft still follow the existing explicit enrichment/mutation contract.

An active contest retains its session's agreed reference/policy snapshot. Preserve the existing contest engine's own rules for DXCC, WPX multipliers and duplicates; common identity facts do not redefine those algorithms. A reference update cannot silently rescore an active session, change its Cabrillo output or change its multiplier meaning. If the existing contest implementation already pins data, reuse that mechanism. If a bridge uses the common country service, capture and retain the version at session creation and restore it with the session. Record unavailable legacy provenance honestly. Retain snapshots required by supported session replay/backup; never claim reproducibility from a version string whose data have been discarded. A later explicit contest recalculation remains with the contest owner.

#### C01.5 Independent fixture record

Maintain one compact fixture manifest alongside the focused tests: ID, raw call, UTC time, provided operating evidence, pinned reference revision, expected neutral facts, expected ambiguity/unknown state, source URL or dataset rule, reviewed date and a brief rationale. Expected results must be hand-checked independently of the function under test. CQRLOG output is a differential comparison input, not the sole oracle; its current regression tests deliberately preserve `DL1ABC/F` as Germany, which must not become the required xLog outcome.

The minimum corpus includes ordinary `/P`; both prefix/suffix arrangements of `EA8/OM0RX`; leading `MM` versus trailing `/MM`; `/AM`; generic `/QRP`; `/LH` with and without a date-valid exact exception; a known KG4 distinction; incomplete/malformed slash forms; a dated exact expedition at both boundaries; a historical/deleted entity; conflicting source records; and one supported country-specific numeric/letter area case. Verify the relevant authority before turning examples such as `KL7AA/1` or `LU1AAA/Z` into real-world normative expectations. Synthetic records may test matching precedence without pretending they establish the current location of a real station. A source that cannot support a geographic inference must produce an explicit unknown/ambiguous result rather than a guessed passing value.

Primary references checked for planning on 3 November 2026; recheck relevant revisions during implementation:

- [ARRL DXCC rules](https://www.arrl.org/dxcc-rules), Section I rules 8–9: land-station requirements, the exhibition-ship exception and actual station-location scope. EP-02 retains the award-policy implementation.
- [ADIF 3.1.8 specification](https://www.adif.org.uk/318/ADIF_318_annotated.htm): entity-code zero versus unknown, DXCC/COUNTRY/CONT/CQZ/ITUZ and own/contact location field meanings. Use supported serializer fields; this epic does not require implementing unrelated new ADIF features.
- [Club Log's LH handling](https://clublog.freshdesk.com/support/solutions/articles/182078-handling-of-lh-by-club-log): a historical supporting reference retrieved during review, describing ordinary LH calls, lighthouse modifiers and date-specific Lord Howe exceptions. A separate verification encountered a missing page; resolve the current page or equivalent maintainer documentation before treating it as a current source for shipped fixtures.
- Reviewed CQRLOG reference code: [`uDxccService.pas`](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/src/uDxccService.pas), [`uDxccResolver.pas`](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/src/dxcc-parser/uDxccResolver.pas), [`tSplitting.pas`](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/src/dxcc-parser/tests/tSplitting.pas) and [`tArgentina.pas`](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/src/dxcc-parser/tests/tArgentina.pas). Record any adopted code/data attribution; preserve known discrepancies as explicit counterexamples rather than inheriting them.

#### C01.6 Task tracker

| Task | Deliverable and completion evidence | Dependencies / coordination | Current state | Evidence/commit |
|---|---|---|---|---|
| C01-T01 | Reconcile latest source and active QLog contracts; inventory every current country consumer and record which discrepancies are accidental versus domain-specific | Programme baseline; QLog integration-owner handoff for shared files | Software verified; signed/private scope in section 13 | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C01-T02 | Minimal immutable resolution/snapshot contract and compatibility adapter in existing owners; documented field, date and unknown semantics | C01-T01; agree additive projection with EP-02/03/07/09/12 | Software verified; signed/private scope in section 13 | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C01-T03 | Extend deterministic full-call/date/slash/area/ambiguity handling and independently sourced fixture manifest | C01-T02; existing datasets suffice for synthetic/unit fixtures; C02 supplies production richer pack | Software verified; signed/private scope in section 13 | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C01-T04 | Wire live cluster spots, retained-contact classification and logbook lookup to the same admitted snapshot/adapter; remove accidental bundled/static divergence | C01-T02–03; serialize cluster/logbook host edits | Software verified; signed/private scope in section 13 | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C01-T05 | Separate operator enrichment from operating coordinates; add concise explanation/unknown states through existing inspection surfaces | C01-T02–04; EP-09/12 own context/map presentation | Software verified; signed/private scope in section 13 | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C01-T06 | Coordinate QLog consumer adapters, bounded cache invalidation and active-contest snapshot retention without changing sponsor/scoring rules | C01-T04–05; EP-02/03/07/09/12 owner handoffs; existing contest owner | Software verified; signed/private scope in section 13 | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C01-T07 | Complete cross-consumer acceptance, compatibility/round-trip checks and operator documentation; record actual evidence and any precisely scoped pending gate | C01-T03–06; C02 acceptance separately proves production-pack lifecycle | Software verified; signed/private scope in section 13 | [Execution/evidence register](#12-execution-register--4-november-2026) |

#### C01.7 Acceptance tracker

All rows start **Not run**. Unit evidence does not satisfy an integration/UI row, and an existing baseline capability is not new delivery.

| Acceptance | Required result | Initial status | Evidence |
|---|---|---|---|
| C01-A01 | `OM0RX/EA8`, `EA8/OM0RX/P` and an exact full-call exception pass through the actual logbook and cluster entry points with the same date/snapshot and produce the same neutral entity facts. Show the former full-call-first divergence is removed. | Not run | — |
| C01-A02 | Independent fixture manifest covers the minimum corpus above, records authorities and includes at least one deliberate CQRLOG-disagreement counterexample. Unsupported/ambiguous cases are explicit; supported cases produce positive correct results rather than always returning unknown. | Not run | — |
| C01-A03 | Leading `MM` resolves as Scotland where appropriate; trailing `/MM` and `/AM` retain their operating qualifiers. Legacy API fixtures remain compatible or have an explicitly reviewed caller migration. Unknown, known-no-entity and sponsor-ineligible operation are not collapsed. | Not run | — |
| C01-A04 | A dated exception is selected inside its interval and not just outside; a deleted-entity QSO resolves at its historical date. Missing/invalid dates do not use today. Stable source precedence and ambiguous ties are independent of input file ordering. | Not run | — |
| C01-A05 | `OM0RX/P` with only a same-country home callbook profile retains a labelled home/approximate/unavailable location rather than claiming the home coordinates are its portable position; explicit operating grid takes precedence. Computer location in Darwin does not change a Slovak transmitting station. | Not run | — |
| C01-A06 | QLog EP-03 keeps DX/spotter geography separate and unknown criteria nonmatching; EP-07 and EP-12 retain the literal on-air/monitored call, expiry and explicit action rules. A receiver without source position stays unlocated. | Not run | — |
| C01-A07 | Explicit/manual and imported-origin-unknown stored values survive lookup, dataset refresh and restart. New inferred provenance is additive and round-trips through supported backup/ADIF application metadata without altering unrelated fields. | Not run | — |
| C01-A08 | One snapshot change invalidates the affected derived views coherently; no old alert is replayed and no observation timestamp is refreshed. A late result for a prior workspace or reference snapshot cannot replace the current projection. | Not run | — |
| C01-A09 | During an active contest, a general dataset update leaves score/multipliers/export on the pinned contest interpretation; session save/restore retains reproducibility. Existing contest-specific prefix/dupe fixtures remain correct. | Not run | — |
| C01-A10 | On the existing large-log/spot fixture, cold snapshot load and warm lookup/refresh remain off the radio-response path and use bounded projections. Measure the actual changed hot path once; no per-spot network lookup or full-log decode appears. | Not run | — |

### C02 — Versioned country data and reviewed country-field correction

**Priority:** immediately after the C01 contract and initial integration. **Status:** Planned; source review completed, implementation and acceptance not run. **Purpose:** use richer, attributable country/history/exception data without silently rewriting the operator's log or creating an alternative reference-data and editing architecture.

#### C02.1 Existing owners and bounded scope

`ReferenceDataUpdater` already performs source-scoped conditional retrieval, validation and staged per-file replacement, retains usable cache, and separates source version, downloaded time and checked time. `LiveLogbookMethods` chooses and caches the current CTY source. `QSODataQuality` already reports retained-value/reference differences and honestly labels unknown field origin. `logbook_correction_preview` recomputes evidence against the retained revision; the present path is deliberately limited to one DXCC change. `pjCorrectionPreview` is an existing bounded diagnostic. Extend these mechanisms rather than creating a new updater, conflict database, generic bulk editor or automatic “repair all” command.

The approved country scope is **DXCC/entity name, continent, CQ/ITU zones, supported subdivision facts and associated resolution provenance**. Actual station coordinates/locators remain separately evidenced and are never replaced by an entity centroid. Own-location/activation snapshots remain EP-09's responsibility. Paper QSL, provider workflows, club downloads, award submission and generic CSV/bulk editing are outside C01–C02.

Source register: X05, X08–X09 and R03.

#### C02.2 Richer country-pack contract

Add an explicit normalized country snapshot usable by C01, backed by the existing reference owner. Preserve current bundled and configured Club Log support. Support a pinned, internally consistent CQRLOG/OK1RR country pack or its reproducibly generated normalized derivative containing the country/current/deleted data, date-scoped call exceptions, relevant area rules, ignored modifiers and ambiguity entries actually used by the resolver. The source pack's distinct formats must be parsed deliberately; do not pretend they are xLog CSV or concatenate them and feed the old parser. Exclude unrelated LoTW/eQSL membership, SCP and club files from this country import.

Ship or import at least one real validated richer snapshot with its supported coverage documented. A parser plus toy fixture alone does not complete C02. If a source's rule syntax cannot yet be represented faithfully, reject that unsupported input with a specific error, or explicitly scope the reproducible derivative and list excluded coverage; never silently drop rules while claiming full CQRLOG parity. Required coverage includes applicable current/deleted entities, dated exact exceptions, at least the verified slash/area cases adopted in C01, and explicit ambiguity/unknown outcomes.

Minimal metadata:

- Provider/author/source and redistribution attribution; exact source revision/URL where available.
- Source-reported version/release date, when actually supplied; independent local content digest and schema/parser-policy version.
- Download/check timestamps, validation result and record counts; none substitutes for the source's effective date.
- Required component names and digests for a multi-file source, supported rule features and normalization provenance.
- Applicable per-rule date windows, entity/deleted status, specificity and explicit source precedence or unresolved conflict.

Use one parse/normalize/validate path for bundled first run, manual import and downloaded updates. CQRLOG's first-run versus manual leading-pattern expansion discrepancy must not be reproduced. Do not copy legacy length-byte comparison quirks, arbitrary default year limits or ambiguous date-string behavior merely to match the old engine. Preserve documented source semantics; quarantine a rule whose date/syntax cannot be interpreted reliably.

Declared ambiguity entries and explicitly admitted equal-authority ties are valid data and resolve as ambiguous; reject only contradictions not represented or permitted by the declared policy. Keep data-source authority explicit. A newer timestamp does not make a conflicting dataset more authoritative. Prefer the configured, documented primary source and specific validated exceptions according to the C01 policy, show contradictory evidence, and retain the last good active snapshot if the new candidate cannot resolve conflicts under that policy. Do not merge country from one source, zones from another and coordinates from a third without recording that provenance.

#### C02.3 Activation and recovery

Validate candidate bytes and the normalized result before publication: required component completeness, bounded sizes/counts, encoding, recognized syntax, finite coordinates, entity/zone ranges, valid date windows, duplicate identities and undeclared contradictions outside the snapshot’s conflict policy. Valid declared ambiguity records remain admissible and resolve as ambiguous. Use existing network credential and redirect guards; no credential-bearing URL or key appears in manifests, logs or UI. A syntactically valid response containing zero useful country records is a failed update, not a new empty universe.

For a multi-file source, stage and validate the entire version together. Publish one active-snapshot change only after all required pieces and metadata are durable. No consumer may observe half old/half new components. A failed download, import, validation, atomic replacement or restart retains the prior usable snapshot and reports the exact failed source. Validated offline data remains usable. A successful HTTP 304 updates check status without inventing a new data revision or invalidating everything. Keep a deliberate rollback to the prior known-good snapshot through the existing reference/settings surface; rolling back reference data does not undo contact edits.

Coordinate retention with C01's saved/active contest snapshots and backup owner. The same bundle/digest must resolve identically after restart and restore. New snapshot activation refreshes eligible live inference through C01; **it never changes stored QSO fields by itself**.

#### C02.4 Review and correction contract

Extend the existing data-quality inspection and reviewed correction path with a country-specific scope. An operator can review one contact or a bounded paged list of contacts whose retained country facts differ from the selected reference snapshot. EP-01 supplies any ordinary query restriction; C02 does not implement another filter language or take ownership of the saved-filter UI. An unfiltered country review may scan the complete log asynchronously with compact projections; the visible table page must not define the population or counts.

Each comparison retains QSO ID/revision, workspace identity, QSO UTC time, reference snapshot/policy identity, retained field value and provenance, proposed field value and provenance, and the exact reason. Show entity changes and **zone/continent-only changes**; CQRLOG's ADIF-changed-only rebuild condition is not sufficient. Separate a changed inference from an actual stored-value difference. A stored/imported value of unknown origin is protected from automatic replacement just like any other retained data; the operator can still choose an explicit reviewed change.

Provide the bounded choices **Keep recorded value**, **Apply selected country changes** and **Cancel** using the existing editor/review surface. Do not auto-select all discrepancies or automatically treat an inferred value as superior. Do not change call, time, band/mode, frequency, reports, power, confirmations, station context or activity references. A country-field patch must include its known dependent-field consequences in the preview: for example, do not leave a formerly country-specific subdivision falsely attached to a different DXCC entity. If the replacement evidence cannot justify a dependent value, show the conflict/unknown outcome and require an explicit decision; never silently clear it.

Before commit, recompute/revalidate the proposed patch against the same contact revisions and snapshot/policy identity. If the workspace, a selected contact, evidence or selected dataset changed, abort that reviewed transaction with zero writes and ask for refreshed review in the UI. An idempotency token/receipt follows the existing mutation-owner design so retrying after a lost acknowledgement cannot apply twice.

Support one contact first and a deliberately bounded selected set through the same country-only transaction. Confirm a practical bound during baseline reconciliation against existing IPC/transaction budgets; do not create an unbounded “fix everything” endpoint. Selection must identify the actual QSO IDs and expected revisions, not a mutable query whose membership is reevaluated at apply time. A transaction either applies its selected admitted set or writes nothing; do not silently skip conflicting rows and report overall success. The operator may refresh and choose a new set.

Retain a before/after mutation receipt with the exact selected fields and evidence. Provide the existing undo/restore path where supported; if a reversible correction needs a compensating edit, revision-check it so a later legitimate user edit is not overwritten. Carry new metadata through existing backup/restore. Contact edits use the current synchronization/conflict semantics and document their ordinary outbox consequences; C02 introduces no direct upload/provider call and does not bypass or silently alter the user's existing sync policy. Data-only import, preview, keep and cancellation create no contact mutations/outbox entries.

After a successful correction, publish the existing mutation event once for the committed set. QLog's aggregate/evidence caches and cluster worked classification invalidate through their owners; progress is not derived from the renderer's currently visible records. Preserve selected view, filters, draft and navigation where the current UI supports them.

#### C02.5 Task tracker

| Task | Deliverable and completion evidence | Dependencies / coordination | Current state | Evidence/commit |
|---|---|---|---|---|
| C02-T01 | Source/format/provenance inventory and explicit normalized-pack scope, precedence, bounds and recovery contract | C01-T01–02; current reference and backup owners | Software verified; native selected apply/recovery verified | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C02-T02 | Faithful source adapters and reproducible normalized real dataset with current/deleted/date/exception/area/ambiguity coverage and attribution | C02-T01; C01-T03 matching contract | Software verified; native selected apply/recovery verified | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C02-T03 | Whole-pack staged validation, atomic activation, prior-good rollback and accurate source/check status in existing updater/surface | C02-T02; C01-T04 snapshot wiring | Software verified; native selected apply/recovery verified | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C02-T04 | Extend existing country/data-quality evidence with field-specific comparisons, zone-only differences and complete-log bounded paging/counts | C01-T02; C02-T03; coordinate EP-01 projection/query owner | Software verified; native selected apply/recovery verified | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C02-T05 | Existing-surface review flow and bounded selected country-only patch; protect retained/manual/unknown-origin values and show dependent-field conflicts | C02-T04; existing editor/mutation owner; no general bulk editor | Software verified; native selected apply/recovery verified | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C02-T06 | Revision/snapshot-fenced idempotent apply, receipt/recovery, ordinary sync semantics and coherent derived-view invalidation | C02-T05; coordinate EP-02 cache and EP-09 snapshot owners | Software verified; native selected apply/recovery verified | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C02-T07 | Run focused lifecycle/migration/correction acceptance on representative fixtures; document actual coverage and unresolved source/rule edges | C02-T02–06; integrated C01 adapters | Software verified; native selected apply/recovery verified | [Execution/evidence register](#12-execution-register--4-november-2026) |

#### C02.6 Acceptance tracker

| Acceptance | Required result | Initial status | Evidence |
|---|---|---|---|
| C02-A01 | Import one real pinned richer dataset/derivative; manifest and coverage match parsed content. Independently checked current, historical/deleted, exact and adopted area/ambiguity cases produce expected results with source/date evidence. | Not run | — |
| C02-A02 | The same data installed on first run, imported manually and refreshed through the updater yields identical normalized digest/results. Unsupported syntax or omitted required component fails visibly; no silently reduced “full” dataset. | Not run | — |
| C02-A03 | Truncated/HTML/empty response, malformed dates, undeclared contradictions that violate the snapshot’s conflict policy, invalid ranges and interrupted multi-file staging leave the old snapshot usable. Simulated restart between staging/publication never exposes mixed components. | Not run | — |
| C02-A04 | A valid update activates one new snapshot; a 304 preserves revision/download semantics; an offline restart uses validated cache. Rollback restores the prior country answers while stored QSOs and active contest reference remain unchanged. | Not run | — |
| C02-A05 | A complete-log comparison fixture includes a record outside the first visible page, a changed entity, a same-entity zone change, a manual override, an imported-origin-unknown value and an unresolved call. Counts, pages and reasons agree; preview itself performs no mutations. | Not run | — |
| C02-A06 | Keep/cancel leaves all source fields, unrelated metadata, QLog snapshots, mutation receipts and outbox unchanged. Refreshing reference data never automatically rewrites those records. | Not run | — |
| C02-A07 | Apply an explicitly selected country-only change and one bounded selected set; only previewed fields/dependencies change, source/evidence is retained, and each contact preserves its original call/time/band/mode/confirmation/activity data. | Not run | — |
| C02-A08 | Change a selected contact, workspace or dataset after review; apply fails with zero writes and a specific stale-review outcome. A dropped acknowledgement/retry returns the same receipt without duplicate edits. | Not run | — |
| C02-A09 | Inject failure before/during commit; no partial selected transaction or false success. Restore/compensating correction respects later revisions. Existing backup round-trip retains new snapshot and correction metadata. | Not run | — |
| C02-A10 | Successful correction updates QLog EP-02 counts/supporting evidence and cluster classification coherently, preserving EP-01 filter state and EP-09 own-location snapshots. Required existing sync side effects are recorded through their current owner; no new provider request is introduced. | Not run | — |
| C02-A11 | Country review/activation uses compact asynchronous reads on the existing large-log fixture; the radio/CW path remains responsive. Report measured touched-path results and any actual coverage limit without repeated full builds for each parser/UI change. | Not run | — |

#### C01/C02 evidence update rule

For each completed task and acceptance row, record the exact source commit, fixture/data revision, relevant command or manual scenario, expected/observed outcome and evidence path. Use **Planned / In progress / Implemented / Verified / Blocked** for task progress and **Not run / Pass / Fail / Blocked** for acceptance; “blocked” must name the narrow dependency and next action. Source inspection, authored tests and a successfully created type are not runtime evidence. No row in this planning fragment is claimed shipped or passed.

### C03 — Complete native TCI PTT and CW through existing owners

#### Outcome and current baseline

An operator using a supported ExpertSDR/TCI endpoint can explicitly enable transmit controls, use PTT and send/stop CW through the existing xLog controls, and see what the server actually reported. A connected TCI receiver must not appear CW-ready merely because the protocol encoder contains a transmit command.

The current `LiveTCISession` supports connection/observation, bounded receive tuning, receive filters, spots and an IQ receive path. It explicitly rejects other live controls and projects `allow_transmit: false`. `TCIProtocol` has typed TRX/Tune/split encoders, but no completed live CW macro path. `cw_session_backend` explicitly excludes `direct_tci`. This is completion of an intentionally unsupported adapter, not a claim that existing TCI reception is broken.

There is a consequential integration boundary: `ptt_session::Target` is currently an alias of `carrier_tune::Target`; that target validates only `direct_agent` and `direct_flex_lan`. PTT admission also expects observed RX and TX VFO identities for the non-agent route. Adding TCI to a string whitelist would either keep valid TCI unusable or encourage fabricated VFO evidence. Introduce provider-aware PTT target evidence within the existing owner, retaining the established Flex/agent behavior. Do not incidentally enable carrier Tune for TCI.

#### Behavior contract

1. Retain one live TCI connection/session per existing configured radio owner. PTT, CW, receive control, spots and IQ cooperation use its connection generation and serialized transport. A new panel or CW backend must not open a second socket to bypass admission.

2. Establish a finite supported protocol/version table from the official TCI documentation and, where necessary, an identified server transcript. Record send/stop/speed commands, character restrictions, text limits, addressing, queue/status semantics, PTT/TRX observations and unsupported cases. A source enum or a socket write proves neither server support nor transmission. Unknown or insufficient capabilities remain unavailable with a specific reason.

3. Transmit permission is explicit and defaults off on migrated and new TCI configurations. Persist it through the existing configuration/journal schema and expose it through current station settings. Permission alone does not arm CW or acquire PTT. Receive-only operation continues to work with permission off. Disabling permission cancels/retires owned output through the existing release path and cannot prevent a required Stop/PTT-off attempt.

4. Capture the selected radio, connection generation, worker generation, provider-specific TRX/channel identity and relevant current observations at admission. Use a TCI target shape representing what the protocol proves. `TX_FREQUENCY` is server-global in the reviewed source contract: it must not be assigned to every receiver, converted to an invented TX VFO, or treated as evidence that the selected TRX owns it. If an addressed TRX observation proves the required PTT identity independently, use that evidence explicitly; if the configured route cannot be proven, keep it unavailable.

5. PTT-on requires the existing exclusive output acquisition, current selection, valid permission, fresh authoritative RX/route evidence and no unresolved CW/Tune/PTT obligation. PTT-off targets the original acquired owner and has priority over ordinary work. A profile change must not disable release, and an old owner must not send its release to a replacement connection. Preserve retired-owner recovery when physical off cannot be established. Label accepted command, observed TX/RX and unresolved release separately.

6. Route CW through `cw_session` and its backend. Rendering, immutable job identity, normal/contest context, output claims, arm, Stop and mutual exclusion remain canonical. Advertise CW only when send and clear/stop are both implemented for the exact route. Expose whole-message, incremental/cancellable and speed capabilities truthfully to C05/TLF; do not emulate unsupported incremental cancellation by resending a whole string.

7. An admitted CW session freezes its target and applicable context/speed policy; each admitted message or incremental text/speed/prosign segment is immutable. Where the verified backend supports appending, C05 supplies only new bounded segments with job/generation/sequence identity through the same owner. Duplicate/stale appends cannot emit twice or extend a stopped job. Whole-message-only providers retain that capability boundary; do not resend the growing string or acquire another owner per keystroke. Bound text and queue sizes to the verified protocol limits and existing IPC budgets. Server queue/echo reports, if available, remain distinguishable from socket acknowledgement, local queue progress and actual RF. An uncorrelated observation cannot finish the current job. Stop revokes pending work before sending the verified clear/stop operation, prevents late text/speed work from running and retains uncertainty if the backend cannot establish completion.

8. Reconnect restores observations and capabilities only. It drops armed state and pending text. No PTT-on, CW text, speed segment or delayed retry survives a generation change. Source/version changes invalidate capability evidence; existing receive tuning, filters and spot behavior must remain intact.

9. Add concise readiness information to the existing radio/CW surfaces and Connection Doctor: endpoint/server version, selected TRX/channel, permission, supported PTT/CW operations, current target evidence, observation freshness, requested versus observed speed where available, and the exact reason output is unavailable. Diagnostics are observations, not hidden commands.

TX audio streaming/injection, hardware voice memories, carrier Tune, general station presets and physical contest lane qualification are outside C03. A TCI TX-signal-source field does not implement an audio stream. C06 may use a separately configured operating-system audio device with a supported PTT owner; it must not claim native TCI audio support.

#### Source touchpoints and migration

Source register: X10–X19 and P01.

Primary paths: `Sources/XCatIntegrationCore/TCIProtocol.swift`, `TCIWebSocketSession.swift`; `Sources/XLogPrototypeSupport/LiveTCISession.swift`, `LiveStationMethods.swift`, `LiveStationSession.swift`; `prototype/src-tauri/src/station_session.rs`, `station_selection.rs`, `station_telemetry.rs`, `ptt_session.rs`, `carrier_tune.rs`, `cw_session.rs`, `cw_session_backend.rs`, `radio_slots.rs`, `connection_doctor.rs`; current TCI connection form and CW desk/settings.

Use an additive provider-aware PTT target representation or equivalent scoped refactor. Preserve existing serialized identity and recovery expectations for existing providers. Do not broadly redesign carrier Tune because its target type is presently shared. Update every authoritative configuration decoder/receipt validator that currently rejects TCI transmit settings, not only the renderer form. Old TCI records migrate with transmit disabled; old Flex/agent targets and settings retain their meaning. A restore cannot restore an armed job or active lease.

Protocol source register: `docs/cw/PROTOCOL_SOURCES.md` pins ExpertSDR3/TCI commit `6cbccdd7004858152b4b5b463f9b087432d81a21`, `TCI Protocol 2.1.pdf`, SHA-256 `e60833985619ca6a1c7b5c4c48bdbff59e694924589c238d06557e011e18c074`. Earlier receive/split/TX-frequency evidence uses commit `b081213ff97150fd29f669c633f060f93c81a286`. Resolve those versions for each new operation; do not silently combine their assumptions. Read the actual protocol before implementing wire commands.

#### Work packages

| Task | Concrete output | Dependency | Acceptance | Current state | Evidence/commit |
|---|---|---|---|---|---|
| C03-T01 | One bounded protocol/capability matrix with exact source/version/hash, command/address/status semantics and operator server version requirement; record any unsupported capability without inventing a fallback. Agree the PTT/CW target contract with the shared-owner integrator. | CP-T01, CP-T02 shared contract | C03-A01, C03-A04, C03-A07 | Software verified; device qualification Not run | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C03-T02 | Typed TCI CW/control requests and corresponding validated observations in the existing protocol/session owner, with bounded framing and generation fencing. Reuse the existing connection and preserve receive/IQ paths. | C03-T01 | C03-A02, C03-A07, C03-A08 | Software verified; device qualification Not run | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C03-T03 | Additive transmit-permission/configuration migration and provider-aware canonical PTT admission/release; preserve carrier Tune gating and existing-provider recovery. | C03-T01, C03-T02; integrator owns shared PTT edits | C03-A03, C03-A04, C03-A05, C03-A06 | Software verified; device qualification Not run | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C03-T04 | TCI CW adapter in the existing CW backend, capability projection, send/stop/speed integration and accurate acknowledgements; agreed C05/TLF whole-message/incremental/speed contract. | C03-T02, C03-T03; CW owner handoff | C03-A05, C03-A07, C03-A08, C03-A09 | Software verified; device qualification Not run | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C03-T05 | Existing connection/CW controls expose permission, supported operations and readable readiness/failure state. Add operation diagnostics to the existing diagnostic owner. | C03-T03, C03-T04 | C03-A03, C03-A09, C03-A10 | Software verified; device qualification Not run | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C03-T06 | Focused protocol and owner integration cases, legacy/restore coverage and existing Flex/TCI receive regression checks. Record exact commands/results. | C03-T02–C03-T05 integrated | C03-A01–C03-A10 | Software verified; device qualification Not run | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C03-T07 | Isolated packaged native workflow and one bounded supported ExpertSDR/radio qualification record when the exact setup is available; otherwise record the precise unrun physical cases without mislabelling them passed. | C03-T06; coherent native candidate | C03-A11, C03-A12 | Blocked: connected ExpertSDR/TCI qualification | [Execution/evidence register](#12-execution-register--4-november-2026) |

#### Acceptance scenarios

Initial result for every scenario: **Not run**. Record actual source/environment, result and evidence in the programme ledger; separate physical qualification from source/native integration.

- **C03-A01 — Capability truth:** Supported and unsupported version fixtures produce the documented operation set. CW remains unavailable without a verified Stop path; PTT does not become available solely from `setTRX` encoder existence. The recorded protocol table and implemented bytes agree.
- **C03-A02 — One session:** PTT/CW and receive/spot/IQ activity share the configured station connection/generation. Interleaved frames, malformed observations and a replacement connection cannot cross targets or create a second session.
- **C03-A03 — Explicit permission:** A legacy TCI configuration loads with TX disabled; enabling it persists through the real settings owner and restore. Merely saving/connecting sends no text/PTT-on. Disabling while idle takes effect; disabling while an obligation exists preserves release/uncertainty handling.
- **C03-A04 — Target evidence:** Two TRX/channel configurations and a global `TX_FREQUENCY` report do not invent receiver-specific TX frequency/VFO. Admission succeeds only for the provider evidence defined in C03-T01; an ambiguous or stale selected route is refused. Existing Flex/agent admission still works under its original evidence contract.
- **C03-A05 — Exclusive output:** Active CW, carrier Tune, PTT or unresolved release blocks a conflicting acquisition. A selection change during admission cannot redirect output. The exact acquired target owns Stop/release even if the UI focus moves.
- **C03-A06 — Release under failure:** Lost PTT-on reply, missing TX-off observation, disconnect during release and a worker replacement produce accurate unresolved state. PTT-off is not stranded behind text/configuration work. A replacement connection does not receive a stale lease's command.
- **C03-A07 — CW data and status:** A supported message is sent once with bounded text and the frozen target. Queue/echo/status fixtures update only the correlated job and never assert RF completion. Invalid text, excessive size and missing capabilities fail before output.
- **C03-A08 — Stop and reconnect:** Stop racing an admitted send/speed segment prevents any unsent tail from following it. Reconnect starts unarmed with no queued text; a delayed response from the old generation cannot alter the new job.
- **C03-A09 — Shared CW behavior:** The same canonical preview/text/context used by normal and existing contest CW reaches TCI. Capability-dependent C05/TLF controls are enabled only for supported behavior, with no second queue or whole-string replay masquerading as correction.
- **C03-A10 — Readiness and regressions:** The normal UI explains permission, unsupported server/route and stale evidence. Existing receive tune/filter/spot workflows and existing-provider CW/PTT paths retain their behavior. Diagnostics issue no transmit command.
- **C03-A11 — Native integration:** In an isolated candidate with verified process/private-root identity, actual controls reach the native owner once, retained settings survive restart, and emergency Stop/release retains priority. This establishes application wiring, not physical RF.
- **C03-A12 — Physical evidence:** On a recorded ExpertSDR version, TCI version, radio model/firmware and configured TRX, qualify a finite PTT-on/off and short CW/send/Stop/speed workflow using the operator's approved setup. Record observed radio/keying behavior and any unsupported operation; do not infer another model/version or TCI audio qualification.

### C04 — WinKeyer preferences, pot and echo feedback

#### Outcome and current baseline

Expose useful WinKeyer settings and truthful speed/progress feedback without weakening the existing actor. xLog already parses busy, XOFF, paddle break-in, waiting and key-down; it paces host characters, disarms/clears the host tail on paddle break-in, prioritizes Stop and refuses stale/duplicate intent. Preserve these strengths. Current configuration is only port and WPM, and current receive handling discards pot and character-echo reports. Supported handshake revisions are currently 23, 30 and 31; this epic does not silently add WK1 or unknown clones.

CQRLOG supplies useful operating ideas, especially a physical-pot preference. It is not the protocol authority and its legacy bulk-send/status behavior should not replace xLog's flow control. The K1EL specification for the identified hardware/firmware controls each supported option.

#### Behavior contract

1. Extend the existing versioned CW profile and serial actor. Candidate volatile settings are speed source/range, paddle mode/reverse, sidetone, weighting/ratio and supported PTT lead/tail. Implement the finite subset confirmed for the recognized firmware by the protocol table. Do not add arbitrary serial bytes, EEPROM programming, output-pin changes, manual PTT/Tune, automatic reconnect or text retry.

2. New hardware options default to `inherit device`/unset. Migration must not guess the device's factory values or apply a new keying personality. Saving preferences is distinct from applying them. Apply a validated bundle deliberately to a freshly idle recognized device; preserve existing explicit connect and saved-speed behavior. A configuration operation never sends CW or manually asserts PTT.

3. Represent requested, applied and device-reported state separately. If the protocol provides no readback for an option, show applied-command status as unconfirmed instead of inventing an observed value. Compose mode-byte settings using documented masks; preserve unrelated bits or reject an operation whose required preservation cannot be established. Partial apply failure records which commands were sent and leaves the device unarmed until the known recovery procedure succeeds.

4. Model speed source explicitly. Software WPM is a validated requested value; physical-pot WPM is device-reported feedback with its own freshness/availability. While pot mode is selected, do not misleadingly overwrite pot reports with the saved software setting. If the hardware exposes only a pot position/range or lacks feedback, label exactly that. Switching source happens while idle and uses verified commands; no fabricated readback.

5. Parse handshake replies, status bytes, pot reports and character echoes as distinct protocol events. Pot/echo traffic must not refresh the authoritative idle/status timestamp. Fragmented/coalesced reads and delayed data must remain correctly classified. Bound retained echo/progress text and ignore retired connection/job generations.

6. Correlate echoes to the current native CW job where supported. Distinguish locally queued, written-to-device and keyer-reported characters; none proves RF. Paddle-originated or uncorrelated characters must not complete a host job. Break-in retains current behavior: cancel the host tail, disarm and relinquish host ownership without clearing the operator's paddles.

7. Device-wide preferences apply only while idle. While a CW job is active, edits may be saved as pending preferences but cannot mutate that job. Per-part speed, preview, early-start typing and correction remain the C05/TLF scheduler's responsibility. Declare how pot mode affects per-part software speed: allow only a protocol-supported, explicitly presented policy or disable that subfeature for pot mode. Never run two speed controllers against one keyer.

8. Stop remains the actor's priority path and revokes queued Arm/Send/configuration operations that could otherwise run late. XOFF and busy/wait/key-down still pause host output. Disconnect, stale status or uncertain apply/send state disarms; reconnect never replays text or silently reapplies a pending transmit action. Preserve independent-keyer operation without requiring a connected CAT radio.

#### Source touchpoints and migration

Source register: X14–X16, X20, R04 and P02.

Primary paths: `prototype/src-tauri/src/winkeyer.rs`, `cw_session.rs`, `cw_session_backend.rs`; `Sources/XLogCore/CWProfile.swift`; `prototype/src/live/cwMacros.ts`, `CWSettings.tsx`, `CWDesk.tsx`, `cwController.ts`; current settings/backup owner and Connection Doctor as appropriate.

The Swift profile currently has version 1 and a strict WinKeyer port/WPM model; TypeScript validation and the native backend also inspect the profile version. Introduce one coherent version migration or documented additive compatible schema across all authoritative readers. Preserve macro IDs, labels, order, bindings, enabled/desk state, output choice, port and WPM. Retain legacy settings when hardware is absent. Do not save physical status or arm/job state as preferences. The C05/TLF owner must review shared-profile and backend changes before integration.

#### Work packages

| Task | Concrete output | Dependency | Acceptance | Current state | Evidence/commit |
|---|---|---|---|---|---|
| C04-T01 | Exact K1EL firmware/command/bit/range matrix for the finite new settings and pot/echo events; list readback limits and unsupported options. Agree per-part-speed/pot behavior with C05/TLF. | CP-T01, CP-T02 shared contract | C04-A01, C04-A04, C04-A08 | Software/restore verified; unconnected settings scope in section 13 | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C04-T02 | Coherent CW-profile validation/migration, persisted desired settings and requested/applied/reported model in existing settings owners. | C04-T01; integrator reserves shared schema | C04-A02, C04-A03, C04-A09 | Software/restore verified; unconnected settings scope in section 13 | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C04-T03 | Typed pot/echo/status parser events and bounded generation/job-correlated feedback in the existing actor; retain existing flow control. | C04-T01 | C04-A04, C04-A05, C04-A06 | Software/restore verified; unconnected settings scope in section 13 | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C04-T04 | Finite validated idle-only settings application, documented command ordering/bit preservation, partial-failure state and priority Stop behavior. | C04-T01, C04-T02, C04-T03 | C04-A03, C04-A06, C04-A07, C04-A08 | Software/restore verified; unconnected settings scope in section 13 | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C04-T05 | Settings controls and compact CW-desk speed/source/progress display using native snapshots; stage edits while active and explain unsupported/unconfirmed state. | C04-T02–C04-T04; C05 UI handoff | C04-A03, C04-A04, C04-A08, C04-A09 | Software/restore verified; unconnected settings scope in section 13 | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C04-T06 | Focused serial transcript, actor-race, migration/restore and existing-CW regression coverage; record native UI integration separately. | C04-T03–C04-T05 integrated | C04-A01–C04-A10 | Software/restore verified; unconnected settings scope in section 13 | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C04-T07 | One bounded recognized WK2/WK3 physical qualification record for applied options, pot/echo, paddles and Stop; exact firmware/transport/setup identified. | C04-T06; available device/candidate | C04-A11 | Blocked: external WK2/WK3 physical qualification | [Execution/evidence register](#12-execution-register--4-november-2026) |

#### Acceptance scenarios

Initial result for every scenario: **Not run**. Record actual source/environment, result and evidence in the programme ledger; separate physical qualification from source/native integration.

- **C04-A01 — Supported scope:** Known handshake revisions expose only their verified options. Unknown firmware and out-of-range/unsupported settings cannot emit configuration bytes. No new raw, EEPROM or pin command path is exposed.
- **C04-A02 — Migration:** A saved version-1 CW profile retains its macros, bindings, output, port and WPM. New settings inherit the device. Restart/backup/restore preserves desired settings without restoring armed state or claiming hardware state was read.
- **C04-A03 — Saving versus applying:** Editing/saving sends no serial configuration or text. Applying while freshly idle emits only the verified bundle. Busy or stale devices reject/defer application visibly; partial failure records uncertainty and prevents an automatic retry or arm.
- **C04-A04 — Speed truth:** Pot reports update only pot-reported feedback; software requested WPM remains distinct. Missing/stale pot information is shown honestly. Pot/echo traffic cannot make old status fresh enough to admit a send.
- **C04-A05 — Echo correlation:** Split/coalesced serial reads, echoes identical to expected text, unsolicited paddle echoes and delayed old-job bytes produce bounded accurate progress. The UI never labels echo as RF confirmation or completes a newer job from an older echo.
- **C04-A06 — Flow and paddles:** Existing XOFF/busy/wait/key-down pause behavior remains. Paddle break-in cancels pending host characters and disarms without clearing ongoing operator paddles. New parsing/configuration work does not bypass that path.
- **C04-A07 — Stop race:** Stop during queued settings/speed/send work revokes the unsent tail and prevents late Arm/Send/configuration from executing. Disconnect and status loss leave the device unarmed; explicit reconnect cannot replay text.
- **C04-A08 — Shared speed ownership:** A C05/TLF per-part-speed job uses the one actor/scheduler, with the documented restoration policy. Editing device preferences mid-job cannot alter it. Pot mode either follows the verified policy or clearly disables incompatible per-part speed.
- **C04-A09 — Real controls:** Desk and settings surfaces show current native requested/applied/reported state, usable disabled reasons and pending edits. Independent WinKeyer use does not require CAT; existing macro bindings and EP-15 reserved-key handling remain intact.
- **C04-A10 — Software/native evidence:** Focused tests cover consequential parser/owner/migration cases; an isolated packaged UI workflow establishes that saved settings and actual controls reach the actor once. No mock serial fixture is labelled a physical keyer test.
- **C04-A11 — Hardware evidence:** On an identified supported keyer/firmware, confirm selected volatile options, pot behavior, echo semantics, software speed, break-in and Stop using a finite operator-approved setup. Record what was observed electrically/audibly and what remains device-reported; do not generalize to untested firmware or clones.

### C05 — CW keyboard workbench and shared message refinement

#### Required result and preserved foundation

Provide an explicit CW composition surface in the existing operating UI: character mode, word mode, and first-word-live then word mode. Show the editable remainder and the output progress the current backend can actually establish. Refine message preview and typed prosigns through the same native CW owner and scheduler used by existing normal memories, contest messages and the accepted TLF work.

The baseline already has twenty normal-mode memories, validated placeholders, preview, configurable macro bindings and contest message/repeat behavior. Extend these owners. Preserve normal/contest banks, serial ownership, cut-number rules, saved macro meanings and explicit Stop/Clear behavior. This work does not introduce a simulator, a second scheduler, another contest engine, a general-purpose scripting language or a replacement key-binding editor.

Source register: X14–X16 and X20; CQRLOG behavior reference R04. Primary anchors to reconcile with current source:

- `prototype/src/live/cwMacros.ts`, `CWSettings.tsx` and the current normal macro dispatch surface.
- `prototype/src-tauri/src/cw_session.rs` and `cw_session_backend.rs`, the existing native CW execution owner and backend boundary; reconcile their current contracts before changing scheduling.
- `prototype/src-tauri/src/winkeyer.rs` for WinKeyer transport evidence, owned by C04 for adapter changes.
- `prototype/src/contesting/contestKeyBindings.ts` and the current contest message/serial/repeat owners.
- The EP-15 action-registry/context contract and the existing shared draft mutation owner.
- CQRLOG `src/fCWType.pas`, `src/core/uCWMacros.pas` and `src/core/uWinKeyerProtocol.pas` as behavior references, not the scheduling architecture.

#### Input and execution contract

1. **Deliberate output surface.** Ordinary callsign entry remains ordinary logging. Only committed user input in an explicitly enabled CW composition surface, or the separately intentional TLF early-start workflow, is eligible for live transmission. Preserve existing arm/admission rules and lease expiry; changing a mode or reopening a window does not arm output.
2. **Input origin is explicit.** The draft/input boundary distinguishes direct committed typing from paste, IME preedit, suggestion acceptance, cluster Tune & load, callbook/provider enrichment, manual entity/location correction, reference refresh, preset loading, correction normalization and other programmatic fills. These non-typing origins never implicitly start CW. Pasted/imported composition text is staged for an explicit Send; it does not become an unbounded live stream because character mode happened to be selected. An explicit correction-send command retains its original contest exchange/serial identity and requires fresh admission against the intended current route and generation. A retired route/session is not continuing authority: reject or stage the correction for explicit resolution instead of forcing an old connection or silently redirecting it. An origin label is context, not transmit authority: existing native admission, route identity and arming still apply.
3. **One bounded scheduler.** Normal macros, contest/early-start messages, composition and later QTC actions submit typed plans to the existing single execution owner for the intended route. A UI component does not acquire a second serial port, TCI connection or independent transmitter lease. Backend capacity/backpressure and versioned capabilities govern submission; no text is silently truncated or flattened to unsupported behavior. The output session freezes its admitted route, connection generation and applicable exchange/serial context. Each admitted text/speed/prosign segment is immutable; the unsent composition tail remains editable. Append bounded new segments through the existing owner with job/generation/sequence identity and the backend’s actual append/backpressure capability. Duplicate append delivery must not duplicate output. Stop retires append authority before clearing/releasing output. Do not resend the whole growing string or acquire a new output owner for every keystroke; every append remains subject to the current lease, freshness and admission rules.
4. **Progress reflects evidence.** Keep editable, locally queued, accepted-by-backend, observed-progress and completed/uncertain distinctions where available. Enqueued text is not displayed as physically transmitted. WinKeyer character echo, CAT command acknowledgement and a timing estimate have different evidential strength; none proves radiated RF. If exact progress is unavailable, present the coarser truthful state. Conservative editability is based on the irreversible/uncertain send frontier, not an animated cursor.
5. **One message representation.** Use the existing macro expansion and the TLF shared speed/prosign plan. Typed text/prosign/speed operations carry validated values; arbitrary control bytes or executable fragments cannot enter through imported text. Do not automatically translate ordinary punctuation by copying CQRLOG's legacy speed-dependent escape rules. Preserve supported legacy tokens through explicit migration/compatibility decoding.
6. **Preview and send agree.** Preview shows resolved call/report/exchange, relevant typed prosigns and any supported speed segments. It performs no output or serial consumption. On Send, compile/validate one immutable plan using the current admitted context; detect a stale preview/draft/serial reservation and refresh or reject explicitly. Accepted text retains its captured station, route, draft/contest session and serial. Later lookup/context changes cannot rewrite it in flight.
7. **Editing and correction are bounded.** Editing unsent staged text is normal editing. A backend-accepted or potentially sent character cannot be presented as retracted unless that backend provides the necessary guarantee. Offer an explicit further correction with the same exchange/serial identity where appropriate, subject to fresh route admission. Never silently reserve a second serial, log a contact, erase the held QSO or use a retired connection.
8. **Stop and route changes.** Stop cancels unsent scheduled work and invokes the current owner's backend stop/release mechanism even if focus, active radio or UI surface has changed. Preserve unresolved-release state and existing re-arm restrictions. New route/workspace/module generations invalidate stale commands. Reconnect, wake, reopening and settings restore never resume or replay an unfinished message.
9. **Persistence is configuration only.** Persist composition preference, macro/bank configuration and relevant display choices through current revisioned settings/backups. Do not restore armed state, live send intent, accepted output plans or reserved serials as runnable work. If the existing system preserves draft compose text for recovery, restore it only as clearly unsent text requiring a new explicit action; otherwise keep it ephemeral.
10. **Shortcut ownership.** Register semantic actions with EP-15 and retain contest mappings within the contest owner. Use existing execution handlers. A captured shortcut never executes. Repeated keydown, native accelerator/webview duplication and multiple windows must not duplicate one transmission intent. Stop remains accessible independently of optional custom bindings.

If the selected TLF compiler/scheduler primitive has not yet landed, its current CW/TLF owner implements the minimum shared primitive needed here and cross-links the delivery. C05 must not create a temporary second scheduler, require the complete TLF phase to finish, or claim unrelated TLF contest features complete.

#### C05 task tracker

| ID | Deliverable | Real dependency / owner handoff | Current state | Evidence |
|---|---|---|---|---|
| **C05-T01** | Reconcile current normal/contest CW, TLF work, EP-15 mappings and provider status. Record which existing code already satisfies C05. Agree one plan/progress/input-origin contract and one owner for shared scheduling. | Current local baseline; handoff with existing QLog EP-03/07/15 and C03/C04 implementers. No dependency on completed QLog programme. | Software verified; native compiler/owner/dispatch gates | [Execution/evidence register](#12-execution-register--4-november-2026) |
| **C05-T02** | Extend the existing typed message representation and compiler for preview, supported prosigns and segmented-speed operations. Reuse or jointly deliver the accepted TLF primitive; preserve legacy macros. | C05-T01; only the shared TLF compiler contract, not all TLF features/phases. | Software verified; native compiler/owner/dispatch gates | [Execution/evidence register](#12-execution-register--4-november-2026) |
| **C05-T03** | Add explicit composition state/admission: character, word and first-word-live modes, committed-input origin, staged paste, bounded append protocol with job/generation/sequence identity, and truthful progress projection. | C05-T01/T02; existing native CW scheduler and provider capability interface. Backend-specific upgrades can integrate later. | Software verified; native compiler/owner/dispatch gates | [Execution/evidence register](#12-execution-register--4-november-2026) |
| **C05-T04** | Build the compact workbench, expanded preview, editable/queued/output states, clear error explanations and explicit Send/Stop/Clear-compose controls on existing appropriate surfaces. Preserve the held QSO. | C05-T03; visible controls work without the EP-15 customization editor. | Software verified; native compiler/owner/dispatch gates | [Execution/evidence register](#12-execution-register--4-november-2026) |
| **C05-T05** | Connect deliberate TLF early-start/corrected-call workflows to the same plan/queue and contest serial reservation, requiring fresh intended-route admission for each new correction. Keep Run/S&P and normal banks contextual; preserve existing repeat behavior. | C05-T02/T03 and the current contest owner. Deliver the shared integration even if later QTC/pass work is unfinished. | Software verified; native compiler/owner/dispatch gates | [Execution/evidence register](#12-execution-register--4-november-2026) |
| **C05-T06** | Register workbench/preview/send actions through EP-15 policy; preserve normal CW and contest mapping owners, reserved Stop and one-event dispatch in desk/detached contexts. | EP-15.1/2 agreed registry/conflict contract; C05-T04 handlers. No cyclic dependency on EP-15.4/5 or EP-07.4. | Software verified; native compiler/owner/dispatch gates | [Execution/evidence register](#12-execution-register--4-november-2026) |
| **C05-T07** | Add revisioned configuration migration/backup integration; reject invalid imports and preserve explicit text/prosign semantics, normal/contest bindings and unrelated preferences. | C05-T01/T02; integrator owns shared settings migrations. | Software verified; native compiler/owner/dispatch gates | [Execution/evidence register](#12-execution-register--4-november-2026) |
| **C05-T08** | Complete the acceptance matrix below using existing owner/hardware harnesses; integrate C03/C04 status evidence, add operator help and record exact remaining physical-device boundaries. | Integrated C05 tasks; reuse relevant TLF/C03/C04/EP-15 evidence. | Software/package delivered; armed-route native UI Not run | [Execution/evidence register](#12-execution-register--4-november-2026) |

#### C05 acceptance scenarios

| ID | Required evidence |
|---|---|
| **C05-A01 — deliberate input only** | With fake output observed, ordinary callsign typing, accepted EP-07 suggestions, cluster Tune & load, callbook enrichment, portable preset loading and reference/country refresh emit no CW/PTT. IME preedit emits none. Committed supported characters in the deliberately enabled/armed workbench emit once under the selected mode. Paste/import is staged until explicit Send, regardless of current live composition mode. |
| **C05-A02 — composition boundaries** | A short hand-checked string exercises character, word and hybrid modes, repeated spaces/newlines and a partially typed final word. Document when the hybrid first-word state resets; changing mode alone sends nothing. Explicit flush sends exactly the staged remainder without duplication, loss or accidental QSO Save. |
| **C05-A03 — queue and backpressure** | A bounded multiline paste, fast typing and a fake full/busy backend demonstrate admission limits and pause/resume behavior without busy-looping or overflow. An oversized submission is rejected before output with a useful retained editing state; no silent truncation. UI responsiveness remains acceptable under the existing station fixture. Duplicate append delivery emits once; a delayed append after Stop or a route-generation change cannot extend the retired job. Live composition appends only new segments and never resends an already accepted prefix. |
| **C05-A04 — preview equals admitted plan** | Current normal and contest fixture contexts expand the same message in preview and the recorded native send plan, including full portable call, reports, cut numbers, typed prosigns and serial. Preview consumes no serial and issues no command. A changed draft/serial reservation/route between preview and Send is revalidated, never silently transmitted under stale context. |
| **C05-A05 — speed/prosign capability fidelity** | Use the shared TLF fixtures to verify actual backend operations for segmented speed and typed prosigns on each supported adapter. An unsupported capability is explained or rejected before affected output; it is not silently reduced to one speed. Any final speed restoration respects the current C04 speed-owner policy and cannot overwrite a new pot/operator setting or a different route. Literal text and imported control bytes cannot become hidden commands. |
| **C05-A06 — edit and corrected call** | Delete/change staged text before dispatch, then attempt an edit after backend acceptance/uncertain progress. Only provably retractable work can be removed; potentially sent text remains identified. An explicit corrected-call operation retains exchange/serial identity and obtains fresh intended-route admission; a retired connection is rejected or staged for explicit resolution, never silently redirected. It does not duplicate a reservation or QSO, or rewrite a completed prefix as if it had never been sent. |
| **C05-A07 — Stop and uncertain release** | Stop in queued, sending, full-buffer, disconnected and unknown-release cases reaches the retained output owner, cancels pending work and preserves the QSO draft. Repeat Start/Stop and delayed acknowledgements cannot resume canceled text. Existing explicit Clear/Wipe remains separate and works as before. |
| **C05-A08 — route/window lifecycle** | Change active radio/receiver, reconnect, switch workspace/module and open/focus a detached window while work exists. Stale input/events cannot reach the new route; the old output's Stop remains reachable. Reopen/restart/wake restores no armed state or runnable intent. Validate appropriate existing normal/contest context transitions without introducing a second transmitter owner. |
| **C05-A09 — shortcuts and input methods** | Reuse A15-01–06 for conflict/capture/reserved-key behavior. One native+renderer duplicated intent, repeated keydown or two windows causes at most one logical action. Composition/AltGr/dead keys and ordinary text editing remain usable; shortcut capture never sends CW, and Stop is not shadowed. |
| **C05-A10 — migration and imports** | Old normal macros, contest banks, current key bindings and backups load with unchanged supported meanings. New configuration survives restart/restore; concurrent stale edits fail without overwriting newer values. Invalid/unknown tokens or oversized files leave current settings intact. No migration enables early-start, arms a route or resumes output. |
| **C05-A11 — established workflows retained** | Exercise representative existing normal memory, Run/S&P message, contest serial, repeat CQ, log/save and Stop workflows through their real owners. Confirm C05 does not build a second repeat engine or alter OK/OM DX, QTC/pass/time-rule ownership. The new normal workbench can operate before unrelated TLF phases and QLog epics finish. |
| **C05-A12 — actual integration and evidence level** | Run one integrated operator path on the applicable isolated native candidate after coherent implementation, covering workbench, preview, explicit send to the fake/qualified backend, Stop and preserved draft. Link C03/C04/TLF device evidence rather than repeating equivalent hardware tests. Mark source, mocked integration, packaged UI and physical-device results separately; an unperformed on-air/hardware check is never called passed. |

### C06 — Existing voice memories in normal SSB with dependable native audio

#### Outcome and current baseline

Make the existing voice-memory library useful in ordinary SSB logging as well as contests, with named slots, recording/import, deliberate preview, selected transmit audio and reliable Stop. The operator should understand which microphone records a memory, which device previews it and which device feeds the radio.

The current implementation already records PCM WAV, validates ordered manifests/digests, preloads segments before PTT, requires PTT acquisition, supervises playback and releases in a final path. Native voice admission is presently restricted to the active production contest owner. WAV playback uses WebView audio and optional `setSinkId`; an explicitly selected route errors when that API is unavailable. It is incorrect to describe silent fallback from an explicitly selected failed route as an established current bug. With no configured ID, current playback uses the OS default. C06 replaces that ambiguity for native transmit routing.

Native device support also already exists: macOS `contest_recorder_audio.rs` uses CPAL `DeviceId` strings, enumerates formats, rejects missing devices without default substitution, and has bounded input/output handling. `Cargo.toml` already has macOS CPAL 0.18.2 and `rtrb`. Reuse appropriate lower-level code and policy; preserve the recorder's separate archive/listening admission. A WebView `soundDevice` identifier is not automatically a native CPAL device identity.

#### Behavior contract

1. Generalize the existing voice service's operation context to distinguish `normal_logging` and `contesting`, using the actual owning types. Do not create fake contest sessions for normal use. Retain contest host claims, draft/session/workspace generations, active-window restrictions and practice/test suppression. A normal send uses a native-issued action identity bound to the current normal workspace/draft context, memory revision/digest, selected radio and audio route; it does not accept renderer-supplied arbitrary audio paths or unclaimed contest actions.

2. Reuse existing VOICE1–VOICE10 assets/profile storage, manifests, validation and bounded sizes/durations. Expose normal-SSB labels/slots, record/import/replace, preview, Send and Stop through the existing operator desk/settings surfaces. Sharing a library must not duplicate audio files or silently overwrite contest mappings. A deliberate slot edit creates a new revision; an admitted job continues with its frozen validated revision or is cancelled under the existing lifecycle contract.

3. Preview never acquires PTT or sends a station command. Keep monitor preview separate from transmit output and require a resolved eligible monitor device; do not preview into a selected/known transmit route. Recording uses an explicit native input and existing bounded PCM WAV format/limits, without introducing automatic gain, echo cancellation or noise suppression. Source recording, trim/gain preview and transmitted playback must use the same stored/derived audio interpretation.

4. Provide explicit native input, monitor and transmit device selections using current native device IDs with human-readable names. A route includes device identity and channel mapping. Input, monitor and transmitter are distinct logical routes; one multichannel interface may serve more than one role only when the configured channels and connections isolate those roles. Save route intent, then resolve the exact current device/capabilities before use. Never substitute by friendly name or silently fall back to the OS default. A missing, ambiguous, permission-denied or incompatible device blocks the affected operation with a usable reason. An explicitly offered default monitor policy, if retained, must resolve and display the actual current eligible device before preview; transmit requires a reviewed concrete route.

5. Use the existing macOS native audio backend/dependency where appropriate, with a focused reusable device/stream layer. Preserve Linux/Windows compilation and current supported workflows; advertise native-route capability per platform truthfully. If implementation extends native output to another platform, qualify its identifiers/backend separately. A macOS CPAL run does not establish WebView or Windows/Linux device behavior.

6. Before PTT, validate every segment, decode/preflight the entire bounded job, validate output format/routing, and establish stream readiness. Keep conversion/mixing bounded and deterministic outside the real-time callback; explicitly map mono voice to selected output channels. Do not change global Audio MIDI/device settings to make a file play. If resampling is needed for the verified device format, implement one defined conversion policy and cover its duration/channel/level behavior; otherwise reject incompatible formats clearly. No file I/O, blocking allocation or PTT calls in the audio callback.

7. Acquire transmit authority through existing `ptt_session` and station selection, after audio readiness and normal-SSB/mode eligibility checks. Reuse supported provider admission, exact target fencing and exclusive CW/Tune/PTT ownership. Do not add a parallel voice PTT timer or infer support from low-level CAT commands. C03 can supply a qualified TCI PTT route, but this epic supplies no TCI TX-audio injection. Unsupported PTT providers remain visibly unavailable for transmitting voice until their proper owner supports them.

8. Start playback only after the required PTT evidence is satisfied. Use one native job state machine with prepared/acquiring/playing/releasing/completed/cancelled/uncertain states or equivalent existing-owner states. Expose observed facts accurately: file decoded, stream running, PTT accepted/observed, local samples consumed and radio RX observed are different. Consumed samples are not proof of transmitted audio or RF. Define a bounded startup/lead and completion/drain/tail policy from the backend timing contract and qualified route evidence. The first audio must not precede the required PTT/route readiness; normal completion accounts for queued backend/device audio before releasing PTT, because writing the final sample to a callback is not playback completion. Use the actual presentation/drain/latency contract rather than an arbitrary long sleep; a bounded drain timeout enters the documented failure/release outcome. Keep this timing inside the one voice/PTT owner, with no independent PTT controller. Explicit Stop, error or device loss cancels remaining audio and starts prompt release instead of waiting for the normal long drain/tail.

9. Stop cancels audio promptly, revokes remaining segments and releases the acquired PTT owner. Completion/error follows the same release path. Device removal, backend failure, playback watchdog expiry, sleep/session replacement, mode/selection invalidation or window/workspace retirement cancels output according to the canonical lifecycle; none reroutes or replays. Preserve unresolved PTT obligations until the owner has valid recovery evidence. Do not drop ownership because the renderer disappeared.

10. A duplicated action or held key produces one job. An intentional later send of the same memory gets a new native action identity and remains allowed. Sending a memory does not log a contact, clear callsign/exchange, advance contest serial or change the selected radio. Normal controls use current SSB normalization; a stale draft saying SSB cannot override incompatible live-radio evidence.

11. Include bounded useful editing: trim start/end and gain with duration and peak/clipping feedback, using nondestructive metadata or a derived revision and preserving the original asset. Do not add a multitrack editor or automatic loudness processor. Reject edits producing an empty/invalid/over-limit result before save/transmit. Route preview through the same derived samples that the eventual job will use.

12. Integrate normal voice actions with the QLog EP-15 registry when available, honoring its context and reserved-key rules. Contest ESM/function keys remain their existing owner. New normal actions must not steal CW function keys or transmit from a text field/dialog through a second listener. Visible controls and Stop remain available independently of shortcut-customization delivery.

C07 radio-internal memory trigger/stop, general per-radio presets (C09), physical SO2R/SO2V voice routes (C10), new QSO-recording features and TCI TX-audio streaming are excluded. The native playback work must not widen the contest recorder's listening permissions or turn a monitor-only output path into a transmitter by inheritance.

#### Source touchpoints and migration

Source register: X17–X23.

Primary paths: `prototype/src-tauri/src/contest_voice.rs`, `ptt_session.rs`, `station_selection.rs`, `radio_slots.rs`, `contest_recorder_audio.rs`; `prototype/src/contesting/contestVoiceProfile.ts`, `contestVoiceOutput.ts`, `Not1MMContestWorkspace.tsx`; current normal operator desk, settings/native route registration and the EP-15 action registry. Preserve current contest wrapper APIs where practical while extracting the shared library/admission/audio service. Do not move contest-specific authorization wholesale into the renderer.

Existing WAV assets, slot names, profile paths and valid contest mappings remain readable. Preserve the legacy `soundDevice` preference for recovery, but do not guess that its browser ID equals a native ID. Mark the native TX route as requiring selection/review until the operator chooses a current device; this is a one-time route migration, not a fresh general station-profile workflow. New route and trim/gain metadata use the existing versioned settings/profile/backup owner. Backups include required assets or preserve the existing documented external-asset behavior with clear missing-file status. Restoring settings must never restore prepared/consumed action tokens, an active stream or a PTT lease.

#### Work packages

| Task | Concrete output | Dependency | Acceptance | Current state | Evidence/commit |
|---|---|---|---|---|---|
| C06-T01 | Agree a bounded shared voice operation/context contract and current provider/platform capability matrix; identify exact contest compatibility and EP-15 integration boundaries. | CP-T01, CP-T02; PTT integrator handoff | C06-A01, C06-A07, C06-A12 | Software verified; macOS native route implementation | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C06-T02 | Shared existing-library service with canonical normal/contest admission, immutable memory/action identities, retained contest facade and additive metadata/route migration. | C06-T01; settings integrator | C06-A01, C06-A02, C06-A03, C06-A10 | Software verified; macOS native route implementation | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C06-T03 | Reusable native device enumeration/selection and bounded input/monitor/output backend using the existing dependency; explicit device failure and platform capability reporting. | C06-T01; recorder owner review | C06-A04, C06-A05, C06-A06, C06-A12 | Software verified; macOS native route implementation | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C06-T04 | Native preflight/playback job tied to existing PTT authority, priority Stop, watchdog/lifecycle cancellation, accurate completion and unresolved-release handling. | C06-T02, C06-T03; serialize PTT integration with C03-T03 | C06-A05, C06-A06, C06-A07, C06-A08, C06-A09 | Software verified; macOS native route implementation | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C06-T05 | Shared memory-management/record/import/preview controls plus bounded trim/gain validation and identical derived preview/send audio. | C06-T02, C06-T03 | C06-A02, C06-A03, C06-A04, C06-A11 | Software verified; macOS native route implementation | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C06-T06 | Normal-SSB desk Send/Stop/readiness controls; register normal actions with the current EP-15 owner when available and preserve contest dispatch. | C06-T04, C06-T05; EP-15.2 contract for optional binding | C06-A07, C06-A09, C06-A10, C06-A12 | Software verified; macOS native route implementation | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C06-T07 | Focused native admission/audio lifecycle/migration fixtures and existing contest regression acceptance; verify integrated normal/contest UI in one coherent isolated candidate. | C06-T02–C06-T06 integrated | C06-A01–C06-A12 | Software/package and unarmed UI verified; active route Not run | [Execution/evidence register](#12-execution-register--4-november-2026) |
| C06-T08 | Bounded physical route qualification on the actual output/input/PTT setup, with separate device, application and radio evidence; record unavailable setup honestly. | C06-T07; identified hardware/native candidate | C06-A13 | Blocked: external microphone/monitor/TX/PTT qualification | [Execution/evidence register](#12-execution-register--4-november-2026) |

#### Acceptance scenarios

Initial result for every scenario: **Not run**. Record actual source/environment, result and evidence in the programme ledger; separate physical qualification from source/native integration.

- **C06-A01 — Two legitimate contexts:** Normal logging prepares/sends through its native context without a fabricated contest session. Existing contest session/action claims still work; forged/expired actions, wrong windows/workspaces and practice/test paths cannot obtain real output.
- **C06-A02 — Retained library:** Existing ten-slot profiles and WAVs remain usable. Normal and contest views reference the intended shared assets/mappings; replacing a slot cannot mutate an admitted job. Restart/restore retains labels/routes/edit metadata, never an active job or lease.
- **C06-A03 — Validate before transmit:** Missing/corrupt WAV, wrong manifest/hash, path outside the existing permitted asset contract, over-limit bytes/duration and invalid edited audio fail before PTT. Every ordered segment is validated and prepared before acquisition.
- **C06-A04 — Separate routes:** Recording uses the chosen microphone; preview uses the resolved eligible monitor and issues no PTT/station command. The transmit route has a distinct reviewed device/channel identity; a shared multichannel interface does not permit preview into its transmitter channels. Legacy WebView IDs, duplicate names, absent devices and denied permissions cannot silently become an OS-default TX route.
- **C06-A05 — Audio readiness:** A supported input/output format uses deterministic channel/rate/level handling and bounded queues. Incompatible formats fail with a reason; no global device settings are changed. Playback cannot begin or key PTT while preflight/stream readiness is incomplete. A controlled backend-clock/buffer fixture proves that startup readiness preserves the first samples and normal drain preserves the last samples without treating callback enqueue as audible completion.
- **C06-A06 — Loss without substitution:** Removing the selected output, backend failure, watchdog expiry and sleep/replacement cancel remaining audio and initiate the original owner's release. No default device is opened as a fallback and no reconnect resumes the memory.
- **C06-A07 — Mode/provider and ownership:** Normal SSB is admitted using the current normalized mode/evidence. Stale CW/SSB draft data, unsupported PTT providers, active CW/Tune, another radio lease and stale selection cannot bypass admission. TCI PTT support does not imply TCI TX-audio support.
- **C06-A08 — Release certainty:** Completion, explicit Stop, preparation/acquisition races and errors produce one cancellation/release outcome. Lost TX-off evidence remains unresolved rather than falsely completed. Closing a panel cannot abandon a native PTT obligation. A fake delayed device drain with a final nonzero segment proves that normal completion does not release early; Stop during drain cancels promptly and releases once. A drain timeout follows the documented failure/release outcome instead of hanging. Normal completion follows its bounded verified drain/tail, while explicit Stop/error cancels queued audio and releases promptly rather than waiting for the entire memory or normal drain interval.
- **C06-A09 — Exactly one job:** Duplicate UI/native events or held shortcuts cause one playback; a later intentional click can resend with a new action ID. Stop prevents unsent segments from running after it. Native/renderer duplicate dispatch cannot key twice.
- **C06-A10 — Draft and context preservation:** A voice send leaves callsign/exchange, serial/log state, active radio and pending draft intact. Shortcut capture, typing/IME and dialog focus do not trigger output. Existing contest function keys and CW reserved bindings retain their owner.
- **C06-A11 — Editing fidelity:** A known WAV trimmed and gain-adjusted has the same derived samples/duration/channel policy in preview and send; clipping is visible, the original remains recoverable, and invalid/empty/over-limit edits cannot be transmitted.
- **C06-A12 — Native/platform evidence:** Isolated packaged controls exercise the actual native path and settings restart. Preserve applicable CI builds and label unavailable native routes by platform. Existing contest playback/admission and recorder archive/listening behavior are covered by focused regression evidence, not assumed from normal-SSB tests.
- **C06-A13 — Physical route evidence:** Record OS/backend, exact native device identities, radio/PTT provider, application source/version and connections. Qualify microphone recording, monitor-only preview, short memory send with preserved first/last audio, prompt Stop and one selected-device-loss/release case on the operator-approved setup. Distinguish audible/audio-path evidence, radio PTT observation and RF evidence; no blanket hardware approval follows from one route.

## 7. Combined acceptance, validation and release

### 7.1 Cross-programme acceptance matrix

These cases cover the integration edges between the selected CQRLOG work and the ongoing QLog/TLF work. Reuse the same compact fixtures and owner-level harnesses where their assertions establish the required outcomes. They are acceptance requirements, not a demand for twelve additional test suites.

| ID | Combined scenario | Required result |
|---|---|---|
| CX-A01 | Resolve an ordinary call, a prefix/suffix portable call and an exact dated exception through logging, cluster station/spotter, alert geography and map projection | Same applicable country facts and dataset/rule identity for the same call/date/context. Different historical dates or pinned policies explain any legitimate difference. No second resolver or extra cluster/RBN feed appears. |
| CX-A02 | Apply a reviewed country/zone correction while QLog filtered results, award drilldown and an export preview are open | Only selected fields in unchanged eligible records are committed. A frozen export/preview either completes from its captured snapshot or is explicitly invalidated, never mixes revisions. Totals and supporting-QSO IDs refresh coherently; a same-entity zone change is not lost. |
| CX-A03 | Work `OM0RX/P` or an equivalent same-entity portable fixture; switch an EP-09 own portable preset and receive a delayed home-call lookup | Home profile, contacted operating location and own transmitting location remain distinct. Actual manually entered locator wins; home locator does not masquerade as the portable site. Historical MY_* snapshots and literal portable calls survive. |
| CX-A04 | Use land, maritime/aeronautical, unknown/no-entity and contest-specific fixtures with QLog award progress and a pinned contest session | C01 supplies facts and uncertainty; each existing award/contest policy decides counting. ADIF known no-entity is not unknown. An ordinary data refresh does not rescore a pinned contest or convert a home entity into land eligibility. |
| CX-A05 | Accept an EP-07 suggestion, use EP-03 Review/Tune & load, refresh enrichment/reference data, edit a C02 country proposal and load a portable preset while live CW is configured | Only each action's explicitly authorized behavior occurs. Programmatic field changes never become CW typing. EP-07 emits no tune/PTT/CW/voice/save; Review is passive; existing Tune & load still uses its canonical tune/draft transaction. |
| CX-A06 | Invoke CW/voice actions from existing controls, effective EP-15 bindings, native menus and a detached surface; capture a new shortcut | One admitted intent yields at most one execution. Context/reserved-key conflicts remain visible. Capture/IME/preedit does not transmit; Stop stays reachable through the existing owner. Contest bindings do not become global normal-mode handlers. |
| CX-A07 | Attempt overlapping TCI CW, WinKeyer output, GUI PTT, carrier Tune and voice playback; change visible radio selection during an owned operation | Existing global TX exclusion remains authoritative. Only supported/admitted operation starts. Stop/release reaches the original provider/TRX/connection identity; changing selection cannot redirect the obligation or make it disappear. TCI PTT support does not accidentally enable carrier Tune. |
| CX-A08 | Change a WinKeyer pot or software speed during a queued segmented-speed message, then interrupt with paddles/Stop | Actual supported speed policy and reported echo determine truthful state. A late macro completion cannot restore stale speed over a newer operator choice. Paddle activity cancels the host tail as appropriate without clearing the operator's own paddle action; no reconnect replay. |
| CX-A09 | Open an old contest voice library in normal SSB, preview locally, transmit to an explicit supported route, unplug/replace that audio device, and return to contest operation | Shared assets and prior mappings survive. Local preview does not acquire PTT. Missing transmit device causes controlled stop/release, not default-device substitution. Contest controls still use the same admitted owner and original bounds. |
| CX-A10 | Upgrade a representative old workspace, change QLog and CQR settings from concurrent surfaces, back up and restore | Saved filters, award preferences, alerts, antenna/portable context, RBN/guides, shortcut mappings, CW settings and voice assets/routes retain their expected meaning. Stale writes do not erase newer preferences. Restore starts no transmission, tune, automatic correction or armed output. |
| CX-A11 | Publish a country pack or run a large correction preview while ordinary logging, spots, award navigation and a fake CW/voice operation are active | Bounded background work, coherent snapshot/aggregate invalidation and responsive station controls. Stop is not queued behind scanning or asset preparation. Compare the existing representative same-host performance baseline, recording changed measurements only where relevant. |
| CX-A12 | Use EP-08 software antenna selection, EP-12 RBN markers and EP-16 visual guides after the new TCI/CW/voice capabilities are installed | Those surfaces retain their approved meaning and existing explicit actions. No new physical antenna/rotor operation, inferred RF attribution, fabricated TCI TX identity, guide-based permission or automatic message send is introduced. |

### 7.2 Verification at the owning layer

| Layer | Appropriate proof | What it does not prove |
|---|---|---|
| Pure/domain behavior | Independent expected-result callsign corpus, parser/rule precedence, field provenance, message expansion and snapshot identity | GUI wiring or real device behavior |
| Owner integration | Actual native reference/logbook/CW/PTT/voice owners with fake transports, revision changes, cancellation, receipts and retained obligations | Manufacturer firmware compliance or audible/RF output |
| Application workflow | The real React/Tauri controls and current shared services in a positively isolated candidate, including normal and contest transitions | Other untested platforms, audio devices or radio versions |
| Protocol/device qualification | Exact radio/keyer model, firmware/server/protocol version, route and observed send/Stop/release behavior | All devices exposing a similar command name |
| Packaged candidate | Exact source SHA, visible version, build provenance, applicable gates and migration/restore results | Production installation unless it was actually performed |

Use the repository's current tests and CI instructions. At the reviewed baseline, `prototype/package.json` supplies `npm run test:node`, `npm run test:vitest`, `npm test` and `npm run build`; inspect their live definitions before choosing a command or filter. Validate Swift, Rust and TypeScript behavior where it is owned. Do not invent a test command, passing log or supported platform. [B03]

During implementation run focused tests for a coherent change. Broaden testing only for a concrete cross-feature risk or a required gate. Run the applicable broader gates when an integrated candidate is ready, then rerun evidence invalidated by a later change. Do not repeatedly package/install intermediate builds or execute the entire regression matrix after wording/style changes. Do not weaken assertions, disable a guard or mark skipped evidence passed to make a milestone green.

Use real expected-result oracles. A resolver must not generate its own golden answers; CQRLOG's regression suite is useful differential evidence but can preserve old quirks. A message test compares expected typed operations and transport bytes/actions, not only a renderer string produced by the same function. An export test parses the output through the established codec and compares preserved fields and counts. No-effect requirements need an output/mutation spy, not an assertion that a dialog appeared.

### 7.3 Native and physical acceptance

Follow the actual repository isolation instructions. Verify the exact live application and worker processes, executable identities and complete private-root coordinates before GUI/AX/path binding. Validate fixture enum values before launch. A failed, exited or unidentifiable isolated launch stops that UI sequence; it must not fall back to the production app. Use observed controls for menu/dialog dismissal and preserve the held draft. Do not use blind Escape as a recovery technique; deliberate product Stop/Escape acceptance remains a separate applicable test. Verify Quit using the existing process-only helper rather than a GUI query that could relaunch the app. [B05–B06]

Use fake/offline transports for ordinary automated output tests. Physical checks should cover each claimed supported route at a useful integrated boundary, reusing existing evidence when its source/firmware/behavior remains applicable. Record exactly which radio, keyer, server, protocol, OS and audio device were exercised. Reuse session authorizations; do not repeatedly ask permission for already authorized work. Where a final production installation or physical station action genuinely lacks authorization, finish the reviewable candidate and unaffected work first, then state the exact remaining action and the instruction or environment boundary that requires confirmation.

Physical acceptance pending is a truthful bounded status. It does not excuse an unimplemented PTT/CW path, a mock-only voice button or a preference that never reaches the device. Conversely, lack of one available device does not block unrelated country, data, UI, settings or migration work. Deliver the integrated implementation and an exact qualification matrix; leave unsupported/unqualified capabilities accurately gated and do not claim the complete programme operationally verified while required checks remain.

### 7.4 Candidate and rollout requirements

The integrator chooses the next visible version from the actual current repository state. Every different packaged/installed candidate needs the version and provenance required by `AGENTS.md`; this plan does not prescribe a stale fixed version. Build/package only from the canonical checkout. Coherent completed commits are pushed under the existing workflow; never include another worker's unfinished changes accidentally.

Prefer one combined release boundary for the integrated QLog and C01–C06 work where practical. A real dependency or existing release in flight can justify staged delivery; record which selected requirements remain and continue them. A milestone is not a reason to stop at partial scope. Documentation-only import/tracker changes do not create a new application version.

Prepare operator notes that explain where to find country diagnostics/correction review, TCI PTT/CW, WinKeyer settings, CW composition and normal voice memories. State migration/backup expectations and any specific route/firmware/platform qualification still pending. Do not bury capability limits behind a generic “radio support improved” release note. Source-based capability, supported execution and physical qualification are separate fields.

## 8. Project tracker, decisions and risks

### 8.1 Roles and status rules

Oliver owns product scope and operator review. The existing Codex integrator owns integration, shared migrations, exact-source delivery and the accuracy of the final report. Bounded owners implement their assigned tasks; reviewers examine contracts and actual evidence. No external person must be contacted to start this plan.

Use the following task states consistently:

- **Planned:** not started, or not yet reconciled against newer work.
- **In progress:** a named owner is actively working the task.
- **Implemented:** code and operator path exist, but required integration/acceptance is incomplete.
- **Verified:** applicable required behavior is demonstrated and linked to exact source/evidence.
- **Blocked:** one specific dependency prevents the next step; record its effect, next action and unaffected work that continues.

For an epic with device-dependent behavior, track software verification and physical qualification separately. A source-complete, integrated epic with a named hardware check outstanding remains explicitly qualified as such; do not hide it under an unqualified Done state. Reconcile existing implemented behavior and attach evidence rather than rewriting it. Relative complexity below is a planning judgment, not a duration/price estimate or a promised schedule.

### 8.2 Programme dashboard

| Epic | Primary boundary | Relative complexity | Initial software state | Device/route evidence | Evidence/commit |
|---|---|---|---|---|---|
| C01 | CM1 | XL: shared semantics and many consumers | Planned | Not device-dependent | — |
| C02 | CM2 | XL: data publication, per-field correction and recovery | Planned | Not device-dependent | — |
| C03 | CM3 | XL: protocol plus existing TX/CW admission | Planned | To qualify exact TCI route/version | — |
| C04 | CM3 | L: existing keyer actor and preference migration | Planned | To qualify supported firmware/settings/pot/echo | — |
| C05 | CM4 | L/XL: composition and shared TLF/keyboard integration | Planned | Reuse applicable C03/C04/other existing backend evidence | — |
| C06 | CM4 | XL: shared voice lifecycle and native devices | Planned | To qualify audio/PTT route and platform | — |
| Combined QLog/TLF integration | CM5 | L: shared contracts and regressions | Planned | Scope-specific outstanding checks recorded | — |

### 8.3 Acceptance/evidence ledger

The detailed acceptance tables define what must be shown. Use this ledger to record runs; one run can cover several IDs when its assertions really do so. Link existing repository evidence instead of multiplying near-identical reports. Record actual command/observed behavior, not a future command as if it had run.

| Entry | Task/acceptance IDs | Source SHA and environment | Command or operator action | Actual result, limits and next action |
|---|---|---|---|---|
| Planning snapshot | Baseline only | GitHub `2d54f4c2886319def58fc33ba2982b794b9408b6`, 3 Nov 2026 | Read branch, compare from `f15dbb11`, recursive tree, current QLog plan and workflow | Only canonical QLog plan added; no application build or hardware operation in this planning task |
| Execution baseline | CP-T01/02 | To record | Actual current checkout/diffs/owner reconciliation | Not yet run |
| Callsign/location | C01 acceptance | To record | Domain corpus and consumer integration | Not yet run |
| Data publication/correction | C02 acceptance | To record | Pack/migration/preview/apply/conflict/recovery | Not yet run |
| TCI | C03 acceptance | To record | Protocol, owner integration, exact device qualification | Not yet run |
| WinKeyer | C04 acceptance | To record | Firmware/settings/pot/echo/paddle/Stop | Not yet run |
| CW composition/TLF | C05 acceptance | To record | Preview, input origin, queue, serial/correction, registry | Not yet run |
| Normal/contest voice | C06 acceptance | To record | Shared assets, device routes, output and release | Not yet run |
| Cross-programme | CX-A01–CX-A12; affected existing QLog/TLF IDs | To record | Combined fixtures and operator paths | Not yet run |
| Candidate | CP-T05/06 | Actual version/source/provenance | Required integrated gates, migration/restore, isolated UI | Not yet run |

Keep a short checkpoint after each coherent batch: completed task IDs, commit(s), affected contracts, focused evidence, exact unfinished task and next command/action. If a session pauses, another worker must be able to continue without repeating the entire source investigation.

### 8.4 Decisions and source-resolution log

| ID | Decision | Initial direction / required resolution | Owner |
|---|---|---|---|
| CD-01 | Programme relationship | C01–C06 are additive; preserve QLog/TLF scope, IDs, owners and progress | Integrator |
| CD-02 | Country fact schema | Neutral evidence-bearing result, separate home/operating identity and known-none/unknown; existing owner chooses implementation shape | C01 with consumers |
| CD-03 | Rich pack inputs | Inspect actual source terms and coverage; normalize through one staged pipeline; select independently testable cases | C02 |
| CD-04 | Correction concurrency | Choose bounded preview/apply transaction strategy using existing revisions/receipts; never silently accept a stale proposal | C02 and logbook owner |
| CD-05 | TCI capability contract | Verify official command/version semantics; add provider-aware PTT/CW targets without inventing VFO/TRX evidence | C03 and TX owner |
| CD-06 | WinKeyer speed arbitration | Record documented software/pot/temporary-segment policy, supported firmware and stale-restoration handling | C04 with C05/TLF |
| CD-07 | CW representation and origin | One typed plan/compiler/scheduler; explicit operator input origin; no indirect early-start | C05 with TLF and EP-15 |
| CD-08 | Voice native devices | Reuse suitable existing native audio/device ownership; migrate WebView IDs explicitly, separate mic/monitor/TX | C06 |
| CD-09 | Migration versions | Reserve once through current integrator; extend combined backup/restore | Integrator |
| CD-10 | Completion claims | Software, isolated UI, packaged and physical acceptance recorded separately | Integrator/reviewer |
| CD-11 | Final release/version | Derive from current source and existing release workflow, not planning baseline | Integrator |

For each resolved decision, add the chosen representation/value, reason, affected task IDs and evidence. For an inaccessible authoritative source, identify the exact claim it prevents, use another applicable primary source where possible and continue unaffected work. Do not invent country rules, protocol commands, firmware features or licensing permissions.

### 8.5 Risk register

| Risk | Consequence | Required control / evidence |
|---|---|---|
| Concurrent edits to the active QLog checkout | Lost work, conflicting migrations or accidental mixed commit | CP-T01/02 owner reconciliation; explicit shared-file handoff; current diff review |
| A second resolver survives in live consumers | Different country/zone/needed results in different screens | C01 real call-path inventory; CX-A01; one active snapshot identity |
| Home coordinates overwrite portable location | Incorrect maps, bearings and award evidence | Field-level provenance and C01 portable fixtures; CX-A03 |
| Known no-entity and unknown are collapsed | Incorrect ADIF and award interpretation | Explicit result states and round-trip fixtures; CX-A04 |
| A country refresh silently rewrites history or a pinned contest | Altered evidence and unexpected scores | C02 reviewed mutation only; pinned snapshot and frozen-transaction tests |
| A correction sees only entity-number changes | Zone/subdivision fixes are missed | Per-field diff and same-entity acceptance; CX-A02 |
| TCI support is implemented as a whitelist toggle | Unsupported/incorrect PTT admission or fictitious identity | Provider-aware target contract and protocol evidence; C03 and CX-A07 |
| CW/TX owners are duplicated | Conflicting output and lost Stop/release | Current process-wide owner retained; one scheduler and no parallel connections |
| A programmatic callsign update is treated as typing | Unrequested CW after a suggestion or lookup | Explicit mutation origin; C05-A01 and CX-A05 |
| Pot/echo and macro-speed state race | Misleading WPM/progress or stale speed restoration | Firmware-specific decode and speed-owner policy; CX-A08 |
| Browser audio IDs are treated as native device IDs | Wrong route or unusable migrated voice settings | Explicit C06 mapping/reselection and device-loss fixtures |
| Normal voice access simply removes a contest guard | A new UI bypasses route/module admission | Shared owner with bounded normal adapter and context tests; CX-A09 |
| Output is replayed on reconnect/restart | Duplicate text/audio or stale operation | C03–C06 no-replay/operation-ID/lifecycle tests |
| Shared settings overwrite each other | Lost QLog/CW/voice preferences | Integrator migration sequence, revision conflicts and combined restore; CX-A10 |
| Full-log scans or audio work run in station hot paths | UI freezes or delayed Stop | Bounded background work and measured shared fixture; CX-A11 |
| Mock/source evidence is described as hardware success | Misleading feature readiness | Evidence levels and exact device qualification matrix |
| C07–C12 or a general profile system creep into dependencies | Delays and conflicts with agreed scope | Explicit exclusions; use existing narrow slot/profile/context IDs |

## 9. Definition of done and operator handoff

### 9.1 Required delivery

All C01–C06 required behaviors must be implemented in the actual current application and integrated through its authoritative owners. Every task has a clear state; each verified acceptance has evidence at the appropriate layer. Any required unverified physical/platform acceptance is named explicitly, with completed software delivered and the smallest remaining check identified. An unimplemented core feature is not relabeled as a qualification limitation.

The ongoing QLog features and selected TLF work retain their scope, task IDs and implemented behavior. Shared primitives have one owner and one implementation. All relevant combined acceptance scenarios pass, or a precise unresolved item remains visible rather than being called complete. The canonical QLog tracker is updated only for actual affected work/evidence; this master tracks C01–C06.

Migrations preserve old workspaces, unrelated preferences, existing memories/assets, raw contacts and manual evidence. A representative combined backup/restore is verified. No startup, migration, reference refresh, preference restore or programmatic draft fill initiates station output. Relevant performance evidence shows bounded behavior and preserves responsive logging/Stop.

Current source/protocol/data attribution and applicable operator documentation are updated. Completed changes are committed and pushed according to the live repository rules. A prepared candidate has the required unique version and exact source/build provenance, with package/installation claims limited to what actually happened. No unnecessary new approval workflow, second settings platform, second resolver, second CW queue or second voice library has been introduced.

### 9.2 Final operator walkthrough

Use the existing isolated native route and fake or appropriately authorized qualified devices:

1. Enter a slash/portable call, inspect country and location evidence, and find the same applicable facts in a retained spot/alert/map. Show a home profile without claiming it is the portable site.
2. Load a valid updated country pack, inspect a same-entity zone correction and a protected manual field, apply only selected eligible changes, and show the receipt/recovery path plus correct QLog award/filter behavior.
3. Select an eligible TCI route, perform the supported PTT/CW workflow, stop it, and show truthful capability/state; demonstrate that reconnect cannot replay the message.
4. Configure supported WinKeyer options, demonstrate the chosen pot/software speed policy and reported progress, and interrupt a queued message with paddles/Stop without losing the held QSO.
5. Use character, word and hybrid CW composition, compare preview with admitted output, and exercise the shared TLF speed/corrected-call path while preserving serial context. Accept a nearby suggestion and prove it does not transmit.
6. Reuse a voice memory in normal SSB, preview locally, send through an explicit supported route, stop/unplug the route and observe controlled cleanup; return to the existing contest memory workflow.
7. Restore the combined settings/backup, check the current QLog controls and one detached-window command path, and confirm that nothing has automatically armed or resumed output.

The final implementation report should state: delivered features and where to use them; exact source/version; tests actually run and results; migration/recovery behavior; preserved QLog/TLF integration; and any concrete remaining device/platform qualification or final authorization boundary. Avoid a long chronological transcript of routine commands.

## 10. Source and reference register

Source IDs below are local to this implementation plan. Repository links are immutable planning snapshots. Reconcile newer source before editing; these references never authorize a rollback. The detailed requirements above are proposed implementation contracts, while the baseline statements are observations of the linked source.

### 10.1 Baseline and continuing programme

- **B01:** [Current imported-plan commit](https://github.com/oliverbross/OM0RX-xLog/commit/2d54f4c2886319def58fc33ba2982b794b9408b6).
- **B02:** [Compared delta from the earlier source review](https://github.com/oliverbross/OM0RX-xLog/compare/f15dbb11eb727419689869f8f4907ed9b4809970...2d54f4c2886319def58fc33ba2982b794b9408b6).
- **B03:** [Canonical QLog master and recorded execution baseline](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/docs/planning/OM0RX-xLog_QLog_Implementation_Plan_2026-11-03.md).
- **B04:** [Repository record of installed 1.4.8](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/docs/audits/startup-performance-2026-11-02/installed-1.4.8.md).
- **B05:** [Repository instructions](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/AGENTS.md).
- **B06:** [Development/native-isolation workflow](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/docs/DEVELOPMENT_WORKFLOW.md).

### 10.2 xLog implementation anchors

| ID | Evidence / integration boundary | Source |
|---|---|---|
| X01 | Core callsign/date/prefix semantics | [CTYResolver.swift](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/Sources/XLogCore/CTYResolver.swift); [CTYResolverTests.swift](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/Tests/XLogCoreTests/CTYResolverTests.swift) |
| X02 | Independent cluster resolver to consolidate | [ClusterCountryDirectory.swift](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/Sources/XClusterIntegrationCore/ClusterCountryDirectory.swift) |
| X03 | Actual cluster country consumers | [ClusterSessionService.swift](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/Sources/XClusterIntegrationCore/ClusterSessionService.swift) |
| X04 | Cluster host snapshot selection and retained contacts | [LiveClusterMethods.swift](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/Sources/XLogPrototypeSupport/LiveClusterMethods.swift) |
| X05 | Logbook reference selection and correction routes | [LiveLogbookMethods.swift](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/Sources/XLogPrototypeSupport/LiveLogbookMethods.swift) |
| X06 | Home/profile versus operating enrichment | [CallsignEnrichment.swift](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/Sources/XLogPrototypeSupport/CallsignEnrichment.swift); [CallsignEnrichmentTests.swift](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/Tests/XLogPrototypeTests/CallsignEnrichmentTests.swift) |
| X07 | Home-call provider lookup | [QRZClient.swift](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/Sources/XLogCore/QRZClient.swift) |
| X08 | Reference update/validation owner | [ReferenceDataUpdater.swift](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/Sources/XLogCore/ReferenceDataUpdater.swift) |
| X09 | Operating/data-quality facts and model contracts | [OperatingSupport.swift](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/Sources/XLogCore/OperatingSupport.swift); [Models.swift](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/Sources/XLogCore/Models.swift) |
| X10 | TCI parser and typed requests | [TCIProtocol.swift](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/Sources/XCatIntegrationCore/TCIProtocol.swift) |
| X11 | TCI transport ownership | [TCIWebSocketSession.swift](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/Sources/XCatIntegrationCore/TCIWebSocketSession.swift) |
| X12 | Live TCI receive-only capability boundary | [LiveTCISession.swift](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/Sources/XLogPrototypeSupport/LiveTCISession.swift) |
| X13 | TX-frequency identity acceptance and protocol register | [TCI_TRANSMIT_FREQUENCY_OBSERVATION_SOURCE_ACCEPTANCE_2026-10-16.md](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/docs/TCI_TRANSMIT_FREQUENCY_OBSERVATION_SOURCE_ACCEPTANCE_2026-10-16.md); [PROTOCOL_SOURCES.md](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/docs/cw/PROTOCOL_SOURCES.md) |
| X14 | Canonical native CW owner | [cw_session.rs](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/prototype/src-tauri/src/cw_session.rs) |
| X15 | CW backend admission/target contract | [cw_session_backend.rs](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/prototype/src-tauri/src/cw_session_backend.rs) |
| X16 | WinKeyer actor and feedback parser | [winkeyer.rs](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/prototype/src-tauri/src/winkeyer.rs) |
| X17 | Canonical GUI PTT ownership/admission/recovery | [ptt_session.rs](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/prototype/src-tauri/src/ptt_session.rs) |
| X18 | Shared legacy target and carrier Tune gating | [carrier_tune.rs](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/prototype/src-tauri/src/carrier_tune.rs) |
| X19 | Radio slots and global ownership | [radio_slots.rs](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/prototype/src-tauri/src/radio_slots.rs) |
| X20 | Normal CW profile, memories and settings | [CWProfile.swift](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/Sources/XLogCore/CWProfile.swift); [cwMacros.ts](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/prototype/src/live/cwMacros.ts); [CWSettings.tsx](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/prototype/src/live/CWSettings.tsx) |
| X21 | Existing voice owner, recording and playback | [contest_voice.rs](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/prototype/src-tauri/src/contest_voice.rs); [contestVoiceProfile.ts](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/prototype/src/contesting/contestVoiceProfile.ts); [contestVoiceOutput.ts](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/prototype/src/contesting/contestVoiceOutput.ts) |
| X22 | Existing native audio/device infrastructure | [contest_recorder_audio.rs](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/prototype/src-tauri/src/contest_recorder_audio.rs); [Cargo.toml](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/prototype/src-tauri/Cargo.toml) |
| X23 | Existing voice/contest qualification boundary | [MACRO_STATUS_2026-10-25.md](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/docs/contesting/MACRO_STATUS_2026-10-25.md); [Not1MMContestWorkspace.tsx](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/prototype/src/contesting/Not1MMContestWorkspace.tsx) |
| X24 | Existing alert evaluator and spot activation | [dx_alerts.rs](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/prototype/src-tauri/src/dx_alerts.rs); [spot_activation.rs](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/prototype/src-tauri/src/spot_activation.rs) |
| X25 | Existing physical contest-lane scope boundary | [contest_lane_output.rs](https://github.com/oliverbross/OM0RX-xLog/blob/2d54f4c2886319def58fc33ba2982b794b9408b6/prototype/src-tauri/src/contest_lane_output.rs) |

### 10.3 CQRLOG behavior and data references

- **R01 — Project/provenance:** [README.md](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/README.md); [COPYING](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/COPYING).
- **R02 — Shared service, resolver and counterexample fixtures:** [uDxccService.pas](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/src/uDxccService.pas); [uDxccResolver.pas](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/src/dxcc-parser/uDxccResolver.pas); [uDxccSuffixRules.pas](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/src/dxcc-parser/uDxccSuffixRules.pas); [tSplitting.pas](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/src/dxcc-parser/tests/tSplitting.pas); [tArgentina.pas](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/src/dxcc-parser/tests/tArgentina.pas).
- **R03 — Richer pack, normalization notes and correction implementation:** [README](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/ctyfiles/README); [README.md](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/src/dxcc-parser/README.md); [fImportProgress.pas](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/src/fImportProgress.pas); [dData.pas](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/src/dData.pas).
- **R04 — CW composition, macros and WinKeyer behavior:** [fCWType.pas](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/src/fCWType.pas); [uCWMacros.pas](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/src/core/uCWMacros.pas); [uCWWinKeyer.pas](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/src/core/uCWWinKeyer.pas); [uWinKeyerProtocol.pas](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/src/core/uWinKeyerProtocol.pas); [fPreferences.pas](https://github.com/ok2cqr/cqrlog/blob/1d2018c386c3cdbe8d478ea26c88e32f67a5004c/src/fPreferences.pas).

### 10.4 Primary protocol and rule sources

- **P01 — TCI:** [official pinned TCI repository](https://github.com/ExpertSDR3/TCI/tree/6cbccdd7004858152b4b5b463f9b087432d81a21) and the xLog protocol register in X13. C03-T01 must inspect the actual applicable command documentation and record version/hash/limits before implementing new wire operations. The planning review does not claim new CW wire semantics have already been qualified.
- **P02 — WinKeyer:** [K1EL WinKeyer 3.1 datasheet, v1.3](https://k1elsystems.com/files/WK3_Datasheet_v1.3.pdf). C04-T01 must correlate each option, status/pot/echo encoding and readback limit with the actual recognized firmware; WK3 documentation is not proof of every WK2/clone feature.
- **P03 — ADIF:** [released ADIF 3.1.8 annotated specification](https://www.adif.org.uk/318/ADIF_318_annotated.htm), including DXCC zero versus unknown and own/contact field meanings. Checked 3 November 2026; use the actual supported interchange contract and do not broaden this task into a general ADIF-version upgrade.
- **P04 — DXCC policy:** [ARRL DXCC rules](https://www.arrl.org/dxcc-rules), particularly Section I rules 8–9. Checked 3 November 2026. C01 supplies operation/location evidence; EP-02 remains responsible for applicable award policy.
- **P05 — Historical LH example:** [Club Log LH handling](https://clublog.freshdesk.com/support/solutions/articles/182078-handling-of-lh-by-club-log). One research retrieval succeeded while a separate retrieval returned 404; obtain a current maintainer source or a pinned attributable dataset before adopting its specific examples as normative fixtures. Generic unknown/ambiguity handling does not depend on this page being available.

### 10.5 Prior comparison handoff

- [OM0RX-xLog CQRLOG comparison, 3 November 2026](https://chatgpt.com/library?file_id=libfile_40e22038def8819192703d1496709008&account_id=personal). Its C01–C06 proposal status is superseded by Oliver's approval and this implementation plan. C07–C12 remain deferred.
- [Earlier QLog handoff copy](https://chatgpt.com/library?file_id=libfile_21b59150c9e48191b186f902bcbc73db&account_id=personal). The current repository file B03 is the execution tracker; do not replace its newer progress with this earlier copy.

## 11. Copy-ready Codex execution prompt

Attach this master file to the existing Codex implementation session, or place it at its canonical repository path, then paste the prompt below. The companion `.txt` file contains the identical text.

```text
Continue the current OM0RX-xLog implementation. Oliver has approved all six
CQRLOG comparison items C01-C06. Implement the complete selected scope using
the attached master plan:

docs/planning/OM0RX-xLog_CQRLOG_C01-C06_Implementation_Plan_2026-11-03.md

This is an addition to the ongoing QLog work. Keep its canonical plan active:

docs/planning/OM0RX-xLog_QLog_Implementation_Plan_2026-11-03.md

Read both current plans completely, AGENTS.md, docs/DEVELOPMENT_WORKFLOW.md,
and the actual existing TLF task/evidence record. If the CQRLOG master is
attached but not yet in the repository, import that exact file at the path
above. Do not overwrite a newer copy or reset an existing task tracker.

FIRST RECONCILE THE WORK ALREADY UNDERWAY

Finish the current coherent QLog edit/test/commit batch before integrating
overlapping changes. Inspect the real current branch, source SHA, working
diffs, active owners and worktrees. Preserve unrelated and unfinished work,
including the recorded CW-skimmer worktree. Follow the repository's safe
fast-forward synchronization rules; do not reset, discard or auto-stash other
work to manufacture a clean checkout. Do not absorb another worker's changes
into your commit without an explicit handoff.

The planning GitHub snapshot is 2d54f4c2886319def58fc33ba2982b794b9408b6.
It differs from f15dbb11eb727419689869f8f4907ed9b4809970 only by importing
the QLog plan. This is a reference, not a checkout/reset target. Newer local
or pushed implementation may exist. Credit behavior already delivered with
evidence; do not implement it twice. Reconfirm the recorded QLog owners:
EP-01/02 and shared release, EP-03/07/15, EP-08/09, and EP-12/16.

Use one integrator for shared schemas, migrations, native routing and release.
Retain current owners where practical. Delegate only bounded independent
files/tasks. Serialize edits to shared settings, logbook/draft/cluster owners,
TX/CW/PTT owners, QSO editor, maps and keyboard dispatch. Record task, paths,
base/checkpoint, interface changes, evidence and handoff. While a shared owner
finishes a batch, continue nonoverlapping work; do not pause the programme or
start an uncontrolled second writer in the same checkout.

PRESERVE THE OTHER APPROVED PROGRAMMES

Keep QLog EP-01, EP-02, EP-03, EP-07, EP-08, EP-09, EP-12, EP-15 and EP-16,
their exact task/acceptance IDs, scope and progress. EP-01 remains the query
owner; EP-02 owns award rules/evidence; EP-03/07 own alert/suggestion actions;
EP-08/09 own antenna/portable context; EP-12 owns the retained RBN map feed;
EP-15 owns shortcut registration/conflicts; EP-16 remains visual guidance.

Preserve the selected TLF work: per-part CW speed/preview, early-start typing,
OK/OM DX CW and partial-call correction; later WAE QTC, station passes and
operating-time/band-change guidance. The simulator remains excluded. Reuse
or jointly deliver the minimum shared CW primitive needed by C05; do not wait
for every TLF phase or build a temporary second scheduler. A shared commit
can satisfy both plans, with cross-linked evidence and no duplicate work.

IMPLEMENT ALL SIX OUTCOMES

C01: Extend the existing resolver/reference owners into one consistent
callsign, country and operating-location service. Fix the real cluster/core
slash precedence and bundled/downloaded snapshot divergence through actual
host wiring. Preserve the literal on-air call, dated exact exceptions,
leading MM versus trailing /MM, historical entities, uncertainty and field
provenance. Separate home/operator identity from actual operating position:
same-country /P does not establish home coordinates as the portable site.
Distinguish known no-DXCC-entity from unknown. Preserve legacy callers through
deliberate adapters, manual/imported facts and pinned contest interpretation.
Supply neutral facts to QLog; do not replace WPX or contest/award policy.

C02: Extend the existing updater and data-quality/correction tools with a real
validated richer country snapshot, explicit source/version/coverage and one
bundle/manual/download parse pipeline. Stage whole packs, retain the last
usable snapshot and provide rollback. Show per-field old/proposed values,
dated reasons and manual/unknown-origin protection, including zone-only
changes within the same entity. Apply only explicitly selected bounded
country-field patches through canonical revisions, transactions and receipts;
reject stale reviews without partial writes and provide recovery. Refresh
derived views coherently. No automatic historical rewrite or generic bulk
editor. Preserve existing sync semantics without adding provider operations.

C03: Complete native TCI PTT/CW in the current connection and native TX/CW
owners. Verify official protocol commands/version/addressing before coding
wire behavior. Add provider-aware PTT target evidence: the current shared
carrier-Tune/Flex target assumptions cannot be solved by a whitelist toggle.
Never fabricate per-TRX TX frequency/VFO from a global TX_FREQUENCY report.
Implement explicit permission, supported send/Stop/speed, accurate capability
and feedback, exclusive ownership, priority release and uncertainty recovery.
Preserve receive/IQ behavior and carrier-Tune gating. Reconnect never replays
PTT-on, CW or a speed segment. Native TCI TX audio is outside this tranche.

C04: Extend the existing WinKeyer actor with firmware-supported volatile
preferences, software-versus-pot speed policy and bounded pot/echo feedback.
Preserve XOFF/busy/freshness checks, paddle interruption, urgent Stop and
independent keyer use. Separate desired/applied/reported state; migrate old
port/WPM settings without inventing new device defaults. Coordinate temporary
message speed with C05/TLF so a late restoration cannot overwrite a newer
operator/pot choice. No raw-byte console, EEPROM programmer or replay.

C05: Add deliberate character, word and first-word-live CW composition to
the current operating surfaces, with one typed compiler/preview and native
queue shared with normal memories, contest and TLF. Preserve serial/exchange
identity, typed prosigns, supported speed segments and honest editable,
queued, accepted and device-reported progress. Preview and admitted output
must agree. Live typing appends only new immutable admitted segments, with
job/generation/sequence identity, through the same owner; duplicate or late
appends cannot repeat output or survive Stop. Do not resend the growing string
or acquire a new output owner per keystroke.
Corrected-call sends require fresh route admission while retaining
the exchange/serial context; captured old context is not continuing authority.
Ordinary QSO typing, suggestions, Tune & load, enrichment, corrections and
preset/reference updates must not implicitly transmit. IME preedit never
sends; paste/import is staged for explicit Send even in character mode.
Only deliberate input in an explicitly enabled/armed CW workflow may stream.
Use EP-15's one dispatch/conflict policy, preserving existing contest bindings
and Stop. Visible controls work before the shortcut editor is complete.

C06: Reuse the existing voice library, validated assets/manifests and native
ownership for normal SSB as well as contests. Provide named memories,
record/import, local preview, explicit Send/Stop and bounded trim/gain with
clipping feedback. Reuse the suitable existing native audio/device backend;
do not assume a legacy WebView soundDevice ID is a native device ID. Keep
microphone, monitor and transmitter routes explicit, including output channel
mapping. Missing devices never silently become the OS default. Preflight all
audio before PTT, then use existing exclusive admission and one native job
lifecycle. Preserve first/last audio through bounded route readiness and
normal output-drain/tail handling; callback enqueue is not playback completion.
Explicit Stop must cancel promptly instead of waiting for that normal drain.
Stop, device loss and errors cancel remaining audio and release
the original owner; uncertain release remains visible. Preserve contest
dispatch, drafts and serials. No fake contest session for normal operation,
radio-internal memory triggers or new general QSO recorder.

DELIVER THROUGH THE EXISTING ARCHITECTURE

Work in the current React/Tauri application under prototype and the existing
Swift/native owners, not only the earlier SwiftUI app. Use the master plan's
CM0-CM5 sequence, task tables, collision matrix and CX-A01-CX-A12 integration
cases. Country/data work and independent station adapters can progress in
parallel after contracts are agreed. Do not require all QLog features, all
TLF phases or deferred TCI audio before independent selected work proceeds.

Do not add C07-C12, broad station profiles, physical SO2R/SO2V qualification,
new rotor/switch control, paper-QSL/club/provider workflows or a simulator as
hidden dependencies. Preserve source attribution for reused CQRLOG code/data
and inspect the terms for the actual material; implement behavior independently
when direct reuse is unclear and keep unrelated work moving.

Validate proportionately: focused meaningful tests for coherent changes,
shared fixtures for consequential integration risks, then the actual required
broader gates and one appropriate integrated candidate. Do not run repeated
full builds/installations after every small edit. Fix real failures without
weakening guards or assertions. Follow native isolated-launch/process checks
exactly. Verify migration and combined backup/restore, including QLog settings.

Use the actual firmware/protocol and native device evidence. A disabled button,
test-only adapter or research note does not complete an epic. Separate source,
owner integration, isolated UI, package and physical-hardware evidence. If a
device/platform check cannot run, finish independent software, record the exact
unverified cases and next action, and never label them passed. Keep capability
claims truthful while delivering real supported execution paths.

Follow current logical commit/push/version/provenance rules and package only
from the canonical checkout. Select the next version from current state;
documentation alone needs no bump. Reuse existing session authorizations.
If a final installation or physical action genuinely requires confirmation,
finish the reviewable candidate and unaffected work first, then explain the
specific boundary. Do not ask again for already authorized routine work.

Update this master with actual task states, commits, decisions, commands/results
and precise blockers. Update affected QLog/TLF rows through their current
owners and cross-link shared evidence. Milestones are not stopping points.
Continue until all selected work is delivered or only explicitly documented
external acceptance boundaries remain. Leave an exact resumable checkpoint
if the session must pause. Finish with features/controls, source/version,
validation results, migration/recovery behavior and concrete remaining limits.

Begin implementation now by reconciling the active work and assigning the
first nonoverlapping tasks. Do not stop after producing another plan.
```

## 12. Execution register — 4 November 2026

### Baseline, ownership and programme preservation

CP-T01 and CP-T02 are **Verified** for reconciliation and assignment. Canonical
`main` was clean at `db4a9ce2739fc8b96371cd432d3b8787e950a45e`; fast-forward-only
pull was current. There was no unfinished QLog edit batch to absorb. App chat
inventory showed the earlier QLog implementation not loaded and the last TLF
follow-up idle; this execution chat was the active canonical writer. QLog's nine
selected epics remain implemented with their recorded limits, and the actual
TLF master retains its 1.5.9 follow-ups and open MO2T/physical boundaries. Their
IDs and historical acceptance have not been reset or relabelled.

The CW-skimmer worktree remains at
`/Users/oliver/.codex/worktrees/cw-skimmer/OM0RX-xLog`, branch `codex/cw-skimmer`,
SHA `3a28134caa6c6c981c5f2a564fa22a69d1bc7778`. It was not edited or removed.
The existing production application/store was not used for implementation tests.

| Current owner | Reserved scope and handoff |
| --- | --- |
| Root integrator | C05 native scheduler/compiler/workbench, EP-15 registrations, shared native routing, master, logical commit/push and final release |
| `country` | C01/C02 resolver/reference/correction, shared logbook/cluster host adapters and country UI; explicit LiveWorker/settings-surface handoff |
| `devices` | C03/C04 TCI/PTT/keyer actors, CW-profile migration/settings, native permission retirement; backend handed to root for C05 and then returned |
| `voice` | C06 native audio/library/normal voice/contest facade; Settings voiceProfile and separate components; main routing retained by root |

Shared changes are staged by explicit file/hunk handoff. Unfinished voice/TCI/
country changes were excluded from earlier completed commits. No automatic stash,
reset, worktree cleanup or production fallback was used.

### Initial implementation/evidence checkpoint (historical)

| Scope / task IDs | Current state | Source/evidence and next gate |
| --- | --- | --- |
| Exact master import | Verified | `0dc3c1b3`; downloaded and canonical bytes both SHA-256 `2b87408e6d2b73034f2bba249eb2b11b2e06a3e70d7dd49b36e22307e2f7f900` before execution annotations |
| C01-T02/T03; C02-T01/T02 | Implemented, focused domain verification | Initial `d2f2758d`; `041e235d` tightens duplicate-source exclusion to 21,335 rules / 302 explicit exclusions. [Country evidence](../audits/cqrlog-implementation-2026-11-04/country.md) retains exact source and digest. |
| C01-T01/T04–T07; C02-T03–T07; CP-T03 | Implemented; final compatibility gate in progress | `041e235d`; shared live snapshot, per-field transactions/receipts/undo and controls. Real combined restore passes; full portable regression exposed PJ/partial-XML/declared-location compatibility cases being resolved before release. |
| C04-T01–T05 | Implemented, focused protocol/profile/actor verification | `f56f23f1`; bounded feedback/settling follow-up `a3ee5fa1`; [device evidence](../audits/cqrlog-implementation-2026-11-04/devices.md) |
| C04-T06; C05-T08 | In progress programme integration | Combined native UI, backup and exact-source candidate gates remain |
| C04-T07 | Blocked external qualification | No identified approved connected keyer setup; exact finite firmware/paddle/Stop check remains |
| C05-T01–T07 | Implemented, focused software verification | `5bbfd87e`; native owner 41, compiler 2, backend 5, typed Host 14 and scoped UI tests; [CW evidence](../audits/cqrlog-implementation-2026-11-04/cw.md) and [operator guide](../cw/CW_WORKBENCH.md). Overlapping totals are not summed. |
| C03-T01–T06; CP-T04 | Implemented; focused software verified | `9087b323`; exact protocol, provider-aware PTT, immediate permission retirement and original-route Stop. Portable compile follow-up `00fe85d0`; live TCI owner 20/20 in fresh full run. No hardware pass. |
| C03-T07 | Blocked external qualification / packaged gate pending | Exact ExpertSDR3/TCI/radio setup not operated; finish independent candidate first |
| C06-T01–T06 | Implemented; focused software verified | `87f5b875`; explicit routes, frozen normal/contest actions, TX-VFO mode evidence and Stop/preparation epoch fences. [Voice evidence](../audits/cqrlog-implementation-2026-11-04/voice.md) records 30 native tests and exact unrun device cases. |
| C06-T07; CP-T05/06 | In progress | Combined software/backup/CI, bounded visual/native UI and package/provenance checks remain |
| C06-T08 | Blocked external qualification | Concrete microphone/monitor/TX wiring and radio/PTT route need operator setup; no device fallback or RF claim |

CM0 is verified; CM1–CM4 are being integrated and CM5 is in progress. Milestones
are not stop points. Later execution entries will replace this checkpoint with
exact final source, gate results and remaining acceptance boundaries. Planning
acceptance rows remain Not run unless the linked evidence establishes the
specific required layer; authored code or a mocked check is not a packaged or
physical pass.

### Integrated checkpoint — 5 November 2026 (Darwin)

Additional completed source commits, all immediately pushed: `10b4fdd0` guards
every explicit CW send during IME preedit; `8fb0a048` permits the next staged
message on the same freshly verified radio owner and supplies native formatted
contest preview context; `d1a5025c` strengthens the real Brazilian-prefix corpus;
`9c3749f3` preserves Settings startup/style budgets and records the bounded actual-
component browser review. QLog/TLF registers carry additive shared-work links.

The [integration evidence](../audits/cqrlog-implementation-2026-11-04/integration.md)
records full Python 618, native Rust 1,103, Contesting Test admission 7, pinned
Hamlib dummy 31, full frontend 5,183/378 files plus 6 Node, and production build
passes. Normal Swift passes with its reported methods/skips documented. A fresh
full portable run passed its XCTest portion but exposed 16 country compatibility
issues in the Swift Testing portion; those cases are being corrected before any
versioned package. The earlier stale nested-resource scratch is preserved.

Combined actual backup/restore retains QLog settings/preferences, the CW/voice
profiles, selected country bytes and correction recovery receipts. It restores
no runnable output state. The externally selected voice WAV library retains its
existing separate-folder backup contract; the UI/help explicitly says to retain
that folder with backups.

No new candidate has been packaged or installed at this checkpoint. The next
unused candidate is 1.5.10, to be built only after the compatibility gate from a
clean canonical source with recorded provenance. Signed-worker first execution,
marked native GUI, 100k changed-path measurements and final applicable CI remain.
No physical acceptance is relabelled by source or static-browser results.

## 13. Final software delivery — 5 November 2026 (Darwin)

All six selected software outcomes are implemented in the current React/Tauri
and native owners. The 50 work-package states above now record actual software
delivery and the remaining external qualifications. CM0–CM4 software integration
is complete. CM5's named software/candidate gates passed: signed candidate,
private native workflow, changed-path 100k and remote platform source/build
qualification. Physical and non-macOS packaged-runtime acceptance remain separate.
The preceding checkpoints are historical, including their then-pending items.

### Exact source, candidate and preserved programmes

The signed **1.5.13** candidate is built from clean canonical main
`75cb1fbe78791b47735e7d81e7e42e3404dc7010`. Functional source is
`f7dd16b9ed0b1dbee9940b0ef4a96eddfcd9018f`, with durable recovery
`d6c1dc52cf1a7c83d36bc23f41437801d975137d`, country compatibility
`92a36e39d23415fb20a70fac8a01dfcddd4599fa` and the scoped public-pack privacy
inspector repair `d2770efdca90ade0f4b13c84440d02b7d1e80e87`.

ZIP SHA-256: `b21af154b96632159236dda7d4249ff0cc95f377ad9e549f364ac7b2c3867929`.
The [release record](../releases/v1.5.13-cqrlog-candidate.md) supplies host/worker
hashes, build commands, provenance, validation sources and exact qualification
layers. Failed/stopped 1.5.10 and intermediate 1.5.11/1.5.12 are retained with
their evidence; no candidate version or signed bytes were reused or patched.

The installed application remains **1.5.9** and the rollback ZIP is retained.
No production logbook, settings, recordings or device was used. The CW-skimmer
branch/commit remains `3a28134caa6c6c981c5f2a564fa22a69d1bc7778`; its pre-existing
26 October `prototype/node_modules` symlink was identified and retained.
Original QLog/TLF task IDs/states remain intact. The grouped TLF execution row
P1-01–P1-07 has an additive capability clarification with its VERIFIED_SOFTWARE
state preserved. The programmes' existing sponsor, controlled-cold, R03/MO2T and
physical limits are not closed by this work.

### Acceptance evidence at the owning layer

The [integration ledger](../audits/cqrlog-implementation-2026-11-04/integration.md)
and [CX-A01–CX-A12 layer matrix](../audits/cqrlog-implementation-2026-11-04/acceptance-layers.md)
record source/browser/native/package/physical scopes. Original planning-scenario
initial results are not blanket operational passes. Current evidence includes:

* Real attributed country pack, v2 shared snapshot and canonical country names;
  date/portable/no-entity/uncertainty and legacy compatibility fixtures; complete
  asynchronous review, bounded selected-field transactions, stale/atomic/idempotent
  receipts and actual combined BackupManager restore.
* Native TCI protocol/permission/original-target PTT/CW owners; volatile supported
  WinKeyer options and feedback; shared typed CW compiler/queue/Stop, deliberate
  input, IME/paste and EP-15/contest/TLF identity checks; shared voice asset/PCM,
  route, admission, fake presentation-clock drain and prompt cancellation checks.
* Full and focused suites at their recorded sources, unchanged frontend budgets,
  and actual-component two-round browser review. The integrated Traditional
  layout review additionally covers four widths, pointer wheel, focus, intact
  draft/footer, CW/voice Stop handlers and bottom library controls.
* The final extracted signed arm64 candidate passed strict deep signatures,
  payload inspection and first-signed-worker 9/9 under the unchanged five-second
  deadline (1,928.893 ms total). It was not installed or notarized.
* Signed generated-100k check: process-cold open 7,633.594 ms; first page
  13.367 ms; warm page 3.305 ms; cold country snapshot/lookup 700.197 ms;
  warm lookup median 1.250 ms across 40 calls. Complete 100k review took
  58,613.438 ms; health returned in 0.252 ms before that background scan ended.
  OS caches were uncontrolled. The same-fixture 1.5.4 first-process baseline was
  open 6,697.199 ms, first page 9.937 ms and warm page 3.084 ms; no controlled-cold
  or simultaneous physical-radio timing is inferred.

### Actual native corrections and migration/recovery

The private 12-contact fixture uses valid `normal_logging`, explicit private-root
arguments, unique WebKit marker `a6f2265a-58d3-4662-a757-ee1ab47f07e8` and external
I/O disabled. Each exact live host/worker PID, executable, full arguments and
parent relationship was process-verified before GUI binding. The final host/worker
were 17807/17851. The wide process-only stop verifier also correctly refused to
declare the live bundle stopped. Ordinary Quit was verified before any later
worker inspection; no binding was queried after Quit.

Native 1.5.11 applied only OM3SYN's CQ zone (empty to 15), retaining country/ITU.
It exposed lost recovery controls after navigation. The durable-receipt reader
fixed that defect; 1.5.13 rediscovered the original correction after two candidate
restarts, recovered it through the canonical revision-checked edit and showed
**Already recovered** on a new read. Post-Quit signed-worker reload verified all
12 contacts, restored country fields, unchanged other 11 QSOs, exact settings and
saved QLog filter. Within the QSO payload, only the intended undo-audit field and
edit timestamp differ from baseline. No source call/time/confirmation or
own-station context was overwritten.

Native 1.5.12 also exposed clipped expanded controls in Traditional layout.
The scoped fix preserves fixed dimensions, width containment, QSO form and output
ownership. Final native wheel input reached the voice library's last edit/import
controls without moving the surrounding desk, then returned to visible Callsign
and Log QSO. Saved Word mode and literal CW preview were retained unarmed.
See [recovery](../audits/cqrlog-implementation-2026-11-04/recovery-navigation.md)
and [layout](../audits/cqrlog-implementation-2026-11-04/traditional-desk.md).

Combined backups retain country bytes/metadata and durable before-values/receipts,
QLog preferences/settings and CW/voice profiles without restoring runnable output
state. External WAVs retain the documented separate-folder backup contract.

The primary native receipt is a separate strict 1.5.13 replay in fresh root
`/private/tmp/xlog-wave1-qlog-candidate-fxb4aixv`, marker
`8e3053bb-2056-45ab-8973-b33f1e06b73d`. Its two explicit launches used
host/worker 26640/28185 and 30886/30916. Each of 24 binding/AX/screenshot
observations had fresh process-only host/worker/executable/full-argument/parent/
WebKit verification. CQ-only apply, ordinary Quit/restart, receipt rediscovery,
Recover/Already recovered, voice bottom/top scrolling and saved unarmed CW
preview all passed. A post-Quit signed-worker read again verified 12 contacts,
settings and filter preservation. No observation followed either Quit. The
earlier cross-version receipt remains separate evidence, without relabelling
its PIDs or observation scope.

### Final CI and concrete remaining boundaries

CI at the release source exposed two test-only compatibility issues: the legacy
preview's broad negative regex also matched the new passive receipt reader, and
the older macOS Swift Testing macro rejected three throwing RHS expressions.
The original no-edit/reference assertions are retained by the scoped/hoisted
repairs. [Test compatibility evidence](../audits/cqrlog-implementation-2026-11-04/test-compatibility.md)
and the final release/machine receipt record the repeated gates and separately
identified validation source. The original signed source and hashes remain
unchanged; no package is reminted from the test-validation commit.

The first test-only validation `768c0bb7` passed normal Mac CI and all seven
Contest jobs. Mac/Windows full frontend checks subsequently exposed two existing
detached-feedback fixture completion races. The next test-only commit
`723d852ba3d65f595c27aa8a524abb2cd31b2d54` awaits actual diagnostic/next-draft
readback inside async `act`, preserving all feedback/draft assertions without
sleep, timeout, wake or product changes. All 198 affected tests and TypeScript
pass. Its 6,434 other tracked application/help/build/workflow entries match the
release source; original candidate bytes/source remain unchanged. Latest remote
validation and retained unchanged-input native Contest results are separately
pinned in the release/machine receipt.

Final remote outcomes: the manual macOS/Windows/Linux test/build jobs, normal
CI and automatic Mac prototype job all completed successfully at `723d852b`.
All seven Contest jobs passed at `768c0bb7`, whose native/Swift/generator test
inputs remain unchanged. Both prototype runs skipped optional Windows
fresh-runner and Linux runtime-only packaged acceptance; these are Not run.
The [final machine receipt](../audits/cqrlog-implementation-2026-11-04/candidate-gates.json)
pins job/step outcomes, exact source/artifact identities, strict native proofs,
100k timings and retained evidence checksums.

Physical C03-A11/A12, C04-A11 and C06-A13 remain **Not run**. Connected TCI
operations, armed native CW and real microphone/monitor/TX/PTT workflows could
not be operated through the deliberately offline fixture. Identify the exact
ExpertSDR/server/TRX/channel, supported keyer firmware/transport and reviewed audio
device/channel wiring before that finite qualification. Do not widen the offline
guard. Record first/last audible audio, pot/paddles/Stop and original-target TX/RX
release separately from source/device-reported progress. Normal native voice is
macOS-only; legacy non-macOS contest playback remains capability-selected. TCI TX
audio and unsupported advanced adapter output remain outside this tranche.

## 14. Focused release-candidate close-out — 5 November 2026 (Darwin)

Refreshed clean main is `d39c2ec0`, latest application baseline `9db3d3c0`.
This pass preserves all completed QLog/TLF work, the CW-skimmer worktree, signed
1.5.13 evidence and installed 1.5.9/rollback. It prepares an isolated successor;
it does not authorize production replacement or physical output.

| Follow-up | Current state and evidence |
| --- | --- |
| C06 terminal recording cancellation | Reproduced actual disposable WAV replacement after Stop → same-ID Finish. Native cancellation is now terminal; publication shares Stop/Finish admission. Fifteen native voice and all 1,116 Rust tests pass. Packaged/physical scopes remain separate. |
| Windows DXpedition two-second read | Run 41901606176 failed Windows; Mac/Linux passed and optional runtime jobs skipped. Reusing fully validated compiled rules halves the local cold focused read (983.4 → 496.3 ms), with the feed held and two-second limit unchanged. Thirteen integration and seven core/oracle methods pass; 21,335 complete Facts remain identical. Instrumented repeat 41917365254 still fails Windows: read 2,161.652 ms, including 2,145.151 ms after evaluation. Setup/feed/task admission are prompt; cold reply construction remains too costly. Further correction and candidate 1.5.15 are required. |

The [existing review record](../audits/cqrlog-code-review-2026-11-05.md#release-candidate-close-out-follow-ups--5-november-2026)
retains reproduction logs, corrections and current gate state. Only the missing
native macOS job from contest run 41901614866 was requeued; all seven jobs now
pass at that run's separately pinned source `982b289a`.

Signed **1.5.14** was built from clean canonical source
`5d92260f2db8f18ec90421c39d98a00d222d9283`. The [new release record](../releases/v1.5.14-cqrlog-candidate.md)
and [machine receipt](../audits/cqrlog-implementation-2026-11-04/candidate-1.5.14-gates.json)
pin artifact/hash/signatures, input comparisons, full normal/portable Swift and
Rust gates, first-signed-worker 9/9 and retained raw evidence. Separate native
acceptance selected/applied only a CQ zone, rediscovered its receipt after an
ordinary Quit/restart, recovered it and reread Already recovered. Signed-worker
reloads proved preservation of the other contacts, protected context, settings,
preferences and existing WAV. Saved unarmed CW preview and reachable voice
controls were observed. Offline voice/CW restrictions remained intact; native
publication regressions with disposable WAVs do not qualify a physical microphone.

The additional cold-construction correction is `7d969f36`: literal rules avoid
regex compilation and one decode reuses strictly validated identical dates.
The corrected boundary test, full normal/portable Swift gates and all 21,335
original full-Facts oracle entries pass; the local focused read is 331.452 ms.
Focused Windows `41928552588` and full native-core `41928560129` are running at
that source. A new 1.5.15 candidate must wait for the applicable required gates;
the failed 1.5.14 checkpoint remains separately pinned and retained.

The operator records explicitly retain ExpertSDR3/TCI 2.1 PTT, exactly one
advertised TRX for whole literal TCI CW messages (maximum 128 characters), and
WinKeyer for live composition/typed speed/prosign segments. Keyer preferences
expose the documented finite subset. Normal native voice is macOS-only; external
WAV libraries require their own folder backup. Real SunSDR advertised TRX count,
physical station/device qualification, Windows/Linux packaged-runtime acceptance,
notarization and controlled OS-cache-cold measurement remain pending.
