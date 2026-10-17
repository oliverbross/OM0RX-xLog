# Pilot sponsor-rule audit: CQ WW CW and CQ WPX CW

**Audit date:** 2026-10-17  
**Sponsor editions:** 2026 CQ World-Wide DX Contest (CW, 28–29 November 2026) and 2026 CQ World-Wide WPX Contest (CW, 30–31 May 2026)  
**Result:** The pilot implements useful source-parity scoring, duplicate, exchange, and Cabrillo mechanics, but it is not yet sponsor-current or submission-ready. The rule identities still say `source-26.10.11` and explicitly disclaim sponsor approval. This audit does not change that claim.

## Evidence and scope

Official sources were retrieved on 2026-10-17:

- CQ WW 2026 English rules PDF, dated 5 September 2026: <https://www.cqww.com/rules/2026_rules_cqww.pdf>
- CQ WW current rules page: <https://www.cqww.com/rules/>
- CQ WW Cabrillo instructions: <https://www.cqww.com/cabrillo.htm>
- CQ WPX 2026 English rules PDF: <https://cqwpx.com/rules/2026_cqwpx_rules.pdf>
- CQ WPX current rules page: <https://www.cqwpx.com/rules/>
- CQ WPX Cabrillo instructions: <https://cqwpx.com/cabrillo.htm>

The PDF is the edition authority where the live HTML differs. In particular, the WPX HTML page displays an incorrect 2025 SSB year; the 2026 PDF gives 28–29 March 2026 and 30–31 May 2026 for CW. One CQ WW conflict remains unresolved: rule X.3 in the dated 2026 PDF says every station outside the United States must use `DX`, while the sponsor's Cabrillo guidance separately lists Canadian province/territory abbreviations. The initial profile must pin the 2026 PDF and reject ambiguous Canadian export rather than silently choosing one interpretation until the sponsor resolves it.

The source comparison is the read-only `oliverbross/contest-sw` checkout at `7c8b499225a73f7f8f792246881bd7aefc05452f`, specifically `not1mm/plugins/cq_ww_cw.py`, `not1mm/plugins/cq_wpx_cw.py`, `not1mm/lib/ham_utility.py`, database multiplier queries, and duplicate dispatch. The xLog comparison covers `PilotRules.swift`, `RuleEngine.swift`, `Cabrillo.swift`, `ContestExportInput.swift`, `ContestLane.swift`, and `ContestExportService.swift` at `d24cb0b4ec4b241adc1148e427fe7f2c5f76c63a`.

“Implemented” below means the pilot computes or validates the rule. “Represented only” means a value can be stored or printed but its operating constraint is not enforced. Some operating rules, such as power, assistance, station geometry, and human initiation, inherently require operator attestation or station integration; the software must not describe them as automatically verified.

## Material discrepancies

| Priority | Area | Sponsor requirement | Current pilot / pinned source | Required disposition |
|---|---|---|---|---|
| P1 | Edition and contest period | CQ WW CW runs 00:00:00 UTC 28 November through 23:59:59 UTC 29 November 2026. CQ WPX CW runs 00:00 UTC 30 May through 23:59 UTC 31 May 2026. | Session and QSO timestamps need only be finite and ordered. Neither implementation binds an edition schedule. Existing `source-26.10.11` preview/practice identities intentionally predate a 2026 sponsor window. | Add a new immutable 2026 sponsor profile with its schedule and reject or explicitly mark out-of-period QSOs only when that profile is selected. Preserve the old source-preview identities for practice and provenance; do not retroactively apply the 2026 window to them. |
| P1 | WPX operating time | Single operators may operate 36 of 48 hours; off periods must be at least 60 minutes. Classic adds a 24-hour overlay result, with the same minimum off period, alongside the ordinary entry result. | All accepted QSOs are scored once. No operating-period calculation or separate overlay score exists, although the exporter can emit `SINGLE-OP` and `CLASSIC`. | Implement deterministic 36-hour category selection plus a separate first-24-hours Classic overlay score, with fixtures at 36 hours, 24 hours, 59/60-minute gaps, and boundary seconds; otherwise reject Classic export. |
| P1 | CQ WW Classic time | The ordinary single-operator entry has no operating-time limit. Classic produces an additional overlay result from the first 24 operating hours, with off periods of at least 60 minutes; it does not replace the entry's ordinary full-contest score. | `CLASSIC` is printable but has no scoring effect and no separate overlay score. | Compute both the ordinary category score and the Classic first-24-hours overlay score, or reject Classic export. Do not trim or replace the ordinary single-operator score. |
| P1 | Single-band submission | Both sponsors require every contest-period QSO in the log, including other bands; only the declared band contributes to the score. | `ContestExportInput` and `CabrilloExporter` reject any off-band QSO when `CATEGORY-BAND` is not `ALL`. | Separate submitted QSOs from score-eligible QSOs. Export all valid contest-period QSOs while scoring only the selected band. |
| P1 | CQ WW country multipliers | Per-band countries use DXCC plus WAE multipliers plus IG9/IH9; maritime mobile counts for zone only. | xLog always derives a country multiplier from one ADIF entity. It has no WAE/IG9/IH9 multiplier identity and no maritime-mobile exclusion. The pinned plugin also delegates to generic country lookup/counting and does not establish sponsor-current coverage. | Add a versioned CQ WW country-multiplier reference key and maritime-mobile status. Test WAE-only entities, IG9/IH9, ordinary DXCC, and `/MM` zone-only credit. |
| P1 | WPX serial sequence | RST plus a progressive serial starting at 001. Multi-Two, Multi-Unlimited, and Multi-Distributed use per-band sequences; Multi-One uses one sequence. | The durable pilot reservation path allocates positive serials, but the rule accepts any positive sent/received number. Imports and exports are not checked for the initial number, issue order, retained void reservations, or category-specific sequence scope. The sponsor wording does not establish that the surviving active-QSO set must be gap-free after corrections or deletions. | Validate the immutable sent-serial reservation ledger and category scope, including the initial 001 reservation. Never renumber transmitted history to close gaps; preserve replay and void evidence and initially reject unsupported multi-operator sequence modes. |
| P1 | WPX prefix validity | Portable prefixes must be authorized for the place of operation; portable and license-class suffix rules determine the prefix; unique prefixes must be issued or permitted. | Swift intentionally reproduces `calculate_wpx_prefix`, which uses shortest slash component and a fixed suffix-ignore list. Neither implementation verifies authorization, location, or all “other license class” suffixes. | Replace source parity with a sponsor fixture set and versioned authority/location data. Retain source-parity fixtures separately so deliberate corrections are visible. |
| P1 | Category truth | Category controls cover operator count, assistance, power, band, transmitters, overlays, signal count, band-change limits, and distributed-station conditions. | The session stores a free-text operator category. Export canonicalizes only operator aliases; the remaining category fields are bounded tokens. No compatible-combination or operating-limit validation exists. | Introduce typed, contest-specific category profiles. Initially advertise only a narrow category subset that can be validated; reject all other combinations rather than printing plausible headers. |
| P1 | Multi-operator Cabrillo | CQ WW requires a transmitter column for MULTI-ONE and MULTI-TWO. CQ WPX requires it for MULTI-TWO; its other multi-operator classes must not inherit that column requirement without edition-specific evidence. Distributed entries require `CATEGORY-STATION: DISTRIBUTED`. | QSO lines have no transmitter column and `CabrilloHeader` has no category-station field. | Reject the affected multi-operator exports until the session/QSO model carries edition-specific transmitter identity and distributed station category, then add separate WW and WPX golden fixtures. |
| P2 | Region 1 frequency floor | Both 2026 rules prohibit Region 1 transmissions below 1810 kHz. | `pilotBand` accepts 1.800–1.999999 MHz and the station snapshot has no ITU region. | Add typed station ITU region and an edition frequency constraint; cover 1,809,999/1,810,000 Hz boundaries. |
| P2 | Overlay evidence | Rookie and Youth require sponsor-specific SOAPBOX evidence; Classic and WPX TB-WIRES impose operating/station constraints. | The exporter has no SOAPBOX field and does not validate overlay eligibility. | Add typed overlay metadata and emit required SOAPBOX details, or reject the overlay. Treat antenna/radio eligibility as attested, not machine-proven. |
| P2 | Location and header enums | Sponsor Cabrillo pages enumerate category values. CQ WW 2026 rule X.3 says all non-US stations use `DX`, but the CQ WW Cabrillo page also gives Canadian province/territory values; WPX separately lists accepted locations. | `LOCATION`, assisted, power, transmitter, and overlay values are only checked for length/characters. Arbitrary tokens can be emitted, and the dated CQ WW rule/Cabrillo conflict cannot be resolved from the published material. | Add edition-specific enums. Pin the CQ WW 2026 PDF as rule authority, flag the Canadian conflict explicitly, and fail closed for the ambiguous case pending sponsor clarification. |
| P2 | 2026 human-operation rule | A human must initiate frequency changes, calling, and logging; autonomous robots are prohibited. | No rule metadata or operator acknowledgement represents the restriction. | Record an edition acknowledgement and ensure future automation paths cannot claim autonomous contest operation. This is an operating-policy gate, not a score formula. |

## CQ WW CW rule comparison

| Topic | 2026 sponsor rule | xLog pilot status |
|---|---|---|
| Bands and mode | CW on 1.8, 3.5, 7, 14, 21, and 28 MHz. | Implemented at band-family level for CW. Region 1's 1810 kHz floor is absent. Band plans remain an operator responsibility. |
| Exchange | CW RST plus transmitter-location CQ zone. | Implemented and stricter than the pinned plugin: RST format, zones 1–40, and sent-zone/station-zone equality are checked. The station-location semantics behind the zone still depend on pinned reference data. |
| Duplicates | A station scores once on each band; duplicates are removed without added penalty. | Implemented: duplicate key is normalized call plus band, duplicate points and new multipliers are zero, and duplicate QSO lines remain in Cabrillo. |
| QSO points | Different continent 3; same continent/different country 1; different North American countries 2; same country 0. | Implemented for resolved ADIF entities/continents and matches the pinned plugin arithmetic. It does not itself prove sponsor continental-boundary data is current. |
| Multipliers | Each CQ zone and qualifying country once per band. Countries include DXCC, WAE, and IG9/IH9; `/MM` gets zone only. | Zone-per-band is implemented. Country-per-band is only an ADIF-entity key, so sponsor country semantics are incomplete. |
| Score | QSO points multiplied by total zone plus country multipliers. | Implemented with checked integer arithmetic. Accuracy is limited by the country-multiplier gap and category/time filtering. |
| Categories and limits | Single-op/assisted power and band classes; Classic/Rookie/Youth; four multi-op structures with signal and band-change limits. Classic adds a first-24-hours overlay result alongside the ordinary entry score. | Represented only as free-form export text. No category compatibility, power, assistance, overlay score, time, signal, transmitter, station geometry, or band-change enforcement. |

## CQ WPX CW rule comparison

| Topic | 2026 sponsor rule | xLog pilot status |
|---|---|---|
| Bands and mode | CW on the same six HF bands. | Implemented at band-family level; Region 1's 1810 kHz floor is absent. |
| Exchange | CW RST plus progressive serial beginning 001, with category-specific serial sequence scope. | RST and positive numeric exchanges are implemented. Immutable issue-order validation, void-reservation evidence, and category scope are absent; the surviving active contacts alone are not evidence that transmitted serials should be renumbered into a gap-free sequence. |
| Duplicates | A station scores once per band; duplicates are removed without added penalty. | Implemented as call plus band. |
| QSO points | Different continent 3/6 on high/low bands; same continent/different country 1/2; North America exception 2/4; same country 1. | Implemented and matches both the pinned plugin and 2026 arithmetic. |
| Multipliers | Each valid prefix once for the whole contest, independent of band. | Contest-wide uniqueness is implemented. Prefix derivation is the pinned source heuristic and is not sponsor-authority validated. |
| Score | QSO points multiplied by unique valid prefixes. | Implemented with checked arithmetic, subject to prefix, time, serial, and category gaps. |
| Operating time | Single op 36/48 hours with 60-minute minimum off periods; Classic adds a first-24-hours overlay result rather than replacing the ordinary category result. | Both the 36-hour category selection and separate Classic overlay score are absent. |
| Categories and limits | Assisted is generally allowed; single-op power/band classes and overlays; multi categories define signals, band changes, serial scope, and distributed station conditions. | Represented only as header strings. WPX `TB-WIRES` and distributed station are not modeled. |

## Cabrillo submission audit

The formatter correctly emits Cabrillo 3.0 with CRLF, official contest names, UTC date/time, frequency in kHz, CW mode, sent/received RST and exchanges, deterministic ordering, a recomputed integer claimed score, and no silent field truncation. It also refuses rule/reference mismatches and semantically invalid QSOs. These are format and integrity strengths, not sponsor acceptance proof.

Open submission gaps are:

- Category tokens are not checked against the sponsor enumerations or against one another.
- `LOCATION` is not checked against edition-specific values, and the CQ WW 2026 PDF/Cabrillo conflict for Canadian entries is not surfaced.
- Single-band logs cannot include the required other-band QSOs.
- CQ WW MULTI-ONE/MULTI-TWO and CQ WPX MULTI-TWO QSO transmitter numbers are unavailable; `CATEGORY-STATION: DISTRIBUTED` is also unavailable.
- Required overlay evidence cannot be placed in SOAPBOX.
- The claimed score does not apply WPX 36-hour limits, separate Classic first-24-hours overlay scoring, single-band projection, multi-op band-change limits, or sponsor-country/prefix eligibility rules.
- Actual-frequency output exists, but the rule does not validate the event window, Region 1 floor, licence limits, or category operating behavior.

The pinned plugins emit broadly similar Cabrillo fields directly from free-form contest settings. Their output is useful compatibility evidence but does not close these sponsor gates; agreement between the Python and Swift output is not independent validation.

## Minimal next implementation and fixture set

1. Create new immutable 2026 sponsor rule identities while retaining `7c8b499` as translation provenance. Include contest start/end, retrieval date, exact sponsor URLs, and a versioned reference-data coordinate. Keep the old source-preview/practice identities usable without a retroactive 2026-window rejection.
2. Define a typed initial category subset. The smallest safe milestone is single-operator CW, all-band, with explicit power/assistance and no overlay. Fail closed for single-band, Classic, Rookie, Youth, TB-WIRES, and multi-operator until their score and header semantics exist.
3. Add independent sponsor fixtures for every point branch, per-band duplicate, per-band WW zone/country multiplier, WPX contest-wide prefix, and score multiplication. Include WAE-only, IG9/IH9, `/MM`, portable-prefix, no-digit-call, and ignored-license-suffix cases.
4. Add schedule/operating-time fixtures at the exact contest boundaries, 36-hour WPX limit, separate ordinary and first-24-hours Classic overlay scores, and 59/60-minute off periods. Add Region 1 160 m boundary fixtures.
5. Add whole-ledger WPX serial fixtures: initial 001 reservation, monotonic issue order, corrections/deletions/void reservations that preserve sent numbers, imports, and eventual multi-category sequence scopes. Never renumber transmitted history merely to make active QSOs gap-free.
6. Split Cabrillo “submitted contacts” from “score-eligible contacts” for single-band entries. Add sponsor-profile validation for every emitted category/location value, an explicit CQ WW Canadian-location conflict fixture, and separate WW/WPX golden files for the categories that require transmitter identifiers, distributed stations, and overlays before enabling them.
7. Keep operating attestations separate from computed facts. Power, antenna configuration, assistance, station geometry, remote-receiver use, and human initiation need explicit operator/category declarations and, where available, station telemetry; absence of evidence must never be reported as verified compliance.

Until these fixtures and validations pass against a pinned 2026 sponsor profile, UI and export surfaces should continue to label both pilots as source-derived previews and should not claim current-rule compliance or sponsor-ready Cabrillo output.
