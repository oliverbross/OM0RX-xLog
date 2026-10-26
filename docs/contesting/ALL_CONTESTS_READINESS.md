# All-contest readiness and operator setup

Qualification date: 26 October 2026. Generated companion: [ALL_CONTESTS_READINESS.json](ALL_CONTESTS_READINESS.json).

The live registry contains **94 definitions**: 89 named contests, three utility definitions and two generic QSO-party templates. Every ID is retained. The table reports source integration in disposable SQLite sessions through `not1mm-python`; it does not certify current sponsor rules or an installed application.

Registry, live catalogue API and source-manifest registered-ID sets match exactly (94 each). There are 94 vendored Python plugin modules excluding `__init__`. Unregistered vendored modules outside this catalogue: none. No registered plugin lacks its vendored module.

Lifecycle source HEAD: `128ee7afeac33168a3779dcc143006a1fd257dcf`. Report rendered at `0b0d256f5c22302b02949f9c4345391cfb6e9ff4`. Pinned Not1MM revision: `7c8b499225a73f7f8f792246881bd7aefc05452f`. Python runtime: `3.12.4 (main, Jun  8 2024, 04:51:36) [Clang 15.0.0 (clang-1500.1.0.2.5)]`. Exact tested source hashes, plugin bytes, export hashes, field descriptors and per-feature reasons are in the JSON companion.

Verified source commit for every recorded lifecycle source path: `0b0d256f5c22302b02949f9c4345391cfb6e9ff4`. Each committed Git object matches the recorded tested SHA-256; this mapping is limited to the listed source paths.

The lifecycle source hashes match the files present when this report was generated.

Family-suite outcome is recorded below; final integrated build/package acceptance remains a separate release record.

## Status and evidence boundaries

`PASS` means the named check ran successfully in its stated fixture scope. `FAIL` is an observed failed check. `UNVERIFIED` means the claimed capability/edition was not established by this evidence. `NOT APPLICABLE` states why that feature is outside the definition. A core PASS may coexist with optional UNVERIFIED features; these are separate decisions.

The lifecycle checks configure a session, verify generated fields, commit and inspect raw/stored fields, assert explicit first-contact score constants, reject invalid input atomically, classify/repeat a contact, commit a distinct call with a repeated exchange, page analytics, read every advertised export, correct/delete contacts and restart the host. Repeated-multiplier, domestic/DX, mixed-mode, category, rover and timed behavior additionally use the named existing family fixtures. The matrix does not imply an exhaustive Cartesian product of all configurations.

The React tests use the current `Not1MMContestWorkspace` and `DetachedContestSurface`, real Python JSONL and disposable storage for each ID; native windows, output, recorder, SCP and network services are simulated/unavailable. The native test loops every registered fixture through the actual Swift `PythonContestLane`. Neither is a live installed-app rehearsal. The lifecycle runner dispatches the same real host implementation directly for detailed SQLite/export assertions; the JSONL and native checks separately establish the transport path.

Saved React results: 97 passed / 0 failed. Native all-ID XCTest: PASS. Family runner in this lifecycle report: 331 tests, success=True; zero means the committed fixture inputs were reused and that family suite was not rerun by this invocation. Counts from overlapping suites must not be added.

Full Python source suite: 394 tests; saved result PASS. Its log hash is captured separately from the lifecycle and append runs. This is source/test evidence; final packaging and installed-app acceptance remain separate.

Append equivalence reports 40 fast-path IDs with comparisons out of 40 currently admitted; uncovered admitted IDs: none. The saved harness ran 126 family tests; overall suite outcome: PASS. Each optimized append is compared with a rolled-back full rebuild, including score components and contact point/multiplier assignments. Tied/backdated/correction/deletion cases remain covered by the family fixtures. John Moyle stays on full rebuild because prior multiplier assignments can change. See [shared consistency evidence](CROSS_CONTEST_CONSISTENCY_2026-10-26.md).

Export PASS validates actual downloaded bytes, not just a marker. The checker verifies ADIF IDs, plugin, raw/exchange fields, date/time, frequency, station and mode; Cabrillo contact rows, identifiers, available categories and exchange oracles; and EDI records as implemented. Each actual export has a SHA-256 and a bounded sample in JSON. Sponsor submission acceptance and every optional header are not implied.

## Operator setup

Create a new session for the exact definition below. Set your own callsign, station grid, zone/region and sent exchange before logging. The examples are synthetic fixture values, not recommended operating identities. Select an advertised mode and permitted band/category; a mixed category remains distinct from the current operating mode. Wide pinned band lists describe integration support and do not confer a legal allocation or prove sponsor eligibility.

Load a current CTY reference for the entrant and received calls before relying on country/continent-dependent points. The qualification uses a small synthetic CTY reference, not the operator's live database. Supply a real station grid for grid/distance contests, and use each received grid's descriptor rather than overwriting the sent grid. Conditional serials depend on the entrant's country and sent-exchange configuration. Retain allocated serials and historical exchanges; do not renumber gaps after a wipe or correction.

Follow the displayed field labels and order. Compound exchanges may contain spaces. Manual Enter/ESM and Run/S&P remain explicit operating policies, with CQ WW SSB's established manual workflow retained. A DUPE label describes its configured scope; checking disabled, unchecked and unknown scoring remain different states. The pinned score is authoritative; do not reconstruct totals as points × a universal multiplier count.

Before an actual submission, check the current organizer rules and final export with the operator's category, station and exchanged fields. HA DX, PACC and IOTA have partial 2026 sponsor arithmetic checks and documented new-session overlays; this is not full-edition certification. REF's official summary was consulted while its current full DOCX could not be retrieved. ES Open received an official-rule overlay for 80/40 m, CW/SSB points and eligible ES-region multipliers. CQWS scoring was checked against the available official 2023 rules; its 2026 edition remains unknown. Sources, edition limits and overlay provenance are in the [sponsor-rule audit](PILOT_SPONSOR_RULE_AUDIT.md). Other unverified editions remain explicitly UNVERIFIED. No existing production log is silently rescored by this qualification.

JIDX CW/Phone new sessions use `scoringRevision=26.10.26`. The [official English rules](https://www.jidx.org/jidxrule-e.html), heading `2026-10`, support six bands including 160 m in both modes and the checked JA/DX contact and multiplier branches: DX entrants count Japanese prefecture/JD1 island numbers per band; Japanese entrants count DXCC countries and CQ zones per band; maritime-mobile contacts give Japanese entrants points and zone credit without country credit. The host supplies family-specific score labels and totals. Existing unmarked sessions retain their original global received-number behavior. This is partial rule/branch verification; full sponsor-edition status remains UNVERIFIED. Exact overlay boundaries and regression coverage are in [PATCHES.md](../../python/vendor/not1mm/PATCHES.md).

CQWS has an explicit remaining branch limitation: Brazilian state/UF identity is counted only when established. Automatic received-UF acquisition is unavailable. Such a score is visibly partial (`scoringComplete=false`), Cabrillo carries a SOAPBOX limitation, and manual/automatic RTC score payloads refuse with `scoring_incomplete`. The CQWS core row is UNVERIFIED for this branch even when its tested lifecycle and explicit-UF arithmetic pass; operator UF review is required before relying on a submission total. Its explicit-UF one-point branch also preserves legacy behavior without established point-rule authority in the available official 2023 document. Providing UF alone therefore does not establish current sponsor correctness.

## Complete catalogue matrix

Core includes the feature checks in the JSON companion and the saved transport runs. Optional status defaults and per-plugin reasons follow below.

| ID / definition | Kind / family | Core | Fixture mode; serial | Exports |
|---|---|---|---|---|
| [`cq_ww_cw`](#cq_ww_cw) — CQ WW CW | contest / cq-ww-zone-country | PASS | CW; no allocated serial | cabrillo, adif |
| [`cq_ww_ssb`](#cq_ww_ssb) — CQ WW SSB | contest / cq-ww-zone-country | PASS | SSB; no allocated serial | cabrillo, adif |
| [`cq_ww_rtty`](#cq_ww_rtty) — CQ WW RTTY | contest / cq-ww-zone-country | PASS | RTTY; no allocated serial | cabrillo, adif |
| [`cq_wpx_cw`](#cq_wpx_cw) — CQ WPX CW | contest / wpx-prefix-serial | PASS | CW; allocated serial | cabrillo, adif |
| [`cq_wpx_ssb`](#cq_wpx_ssb) — CQ WPX SSB | contest / wpx-prefix-serial | PASS | SSB; allocated serial | cabrillo, adif |
| [`cq_wpx_rtty`](#cq_wpx_rtty) — CQ WPX RTTY | contest / wpx-prefix-serial | PASS | RTTY; allocated serial | cabrillo, adif |
| [`arrl_ss_cw`](#arrl_ss_cw) — ARRL Sweepstakes CW | contest / sweepstakes-compound | PASS | CW; allocated serial | cabrillo, adif |
| [`arrl_ss_phone`](#arrl_ss_phone) — ARRL Sweepstakes Phone | contest / sweepstakes-compound | PASS | SSB; allocated serial | cabrillo, adif |
| [`arrl_dx_cw`](#arrl_dx_cw) — ARRL DX CW | contest / arrl-dx-domestic-or-dx | PASS | CW; no allocated serial | cabrillo, adif |
| [`arrl_dx_ssb`](#arrl_dx_ssb) — ARRL DX SSB | contest / arrl-dx-domestic-or-dx | PASS | SSB; no allocated serial | cabrillo, adif |
| [`naqp_cw`](#naqp_cw) — NAQP CW | contest / name-spc | PASS | CW; no allocated serial | cabrillo, adif |
| [`naqp_ssb`](#naqp_ssb) — NAQP SSB | contest / name-spc | PASS | SSB; no allocated serial | cabrillo, adif |
| [`naqp_rtty`](#naqp_rtty) — NAQP RTTY | contest / name-spc | PASS | RTTY; no allocated serial | cabrillo, adif |
| [`phone_weekly_test`](#phone_weekly_test) — PHONE WEEKLY TEST | contest / name-spc | PASS | SSB; no allocated serial | cabrillo, adif |
| [`weekly_rtty`](#weekly_rtty) — WEEKLY RTTY TEST | contest / name-number-unique-call | PASS | RTTY; no allocated serial | cabrillo, adif |
| [`icwc_mst`](#icwc_mst) — ICWC Medium Speed Test | contest / name-number-unique-call | PASS | CW; allocated serial | cabrillo, adif |
| [`cwt`](#cwt) — CWT | contest / name-number-unique-call | PASS | CW; no allocated serial | cabrillo, adif |
| [`cwo`](#cwo) — CWOPS - Open | contest / name-number-unique-call | PASS | CW; allocated serial | cabrillo, adif |
| [`k1usn_sst`](#k1usn_sst) — K1USN SLOW SPEED TEST | contest / name-spc | PASS | CW; no allocated serial | cabrillo, adif |
| [`trans_tasman`](#trans_tasman) — Trans Tasman CW | contest / timed-or-location-repeat | PASS | CW; allocated serial | cabrillo, adif |
| [`oceania_dx_cw`](#oceania_dx_cw) — Oceania DX CW | contest / serial-dx-or-regional | PASS | CW; allocated serial | cabrillo, adif |
| [`oceania_dx_ssb`](#oceania_dx_ssb) — Oceania DX SSB | contest / serial-dx-or-regional | PASS | SSB; allocated serial | cabrillo, adif |
| [`sac_cw`](#sac_cw) — SAC CW | contest / serial-dx-or-regional | PASS | CW; allocated serial | cabrillo, adif |
| [`sac_ssb`](#sac_ssb) — SAC SSB | contest / serial-dx-or-regional | PASS | SSB; allocated serial | cabrillo, adif |
| [`iaru_fieldday_r1_cw`](#iaru_fieldday_r1_cw) — IARU FIELDDAY R1 DARC CW | contest / field-day-class-or-serial | PASS | CW; allocated serial | cabrillo, adif |
| [`iaru_fieldday_r1_ssb`](#iaru_fieldday_r1_ssb) — IARU FIELDDAY R1 DARC SSB | contest / field-day-class-or-serial | PASS | SSB; allocated serial | cabrillo, adif |
| [`10_10_fall_cw`](#10_10_fall_cw) — 10 10 FALL CW | contest / ten-ten-membership | PASS | CW; no allocated serial | cabrillo, adif |
| [`10_10_spring_cw`](#10_10_spring_cw) — 10 10 SPRING CW | contest / ten-ten-membership | PASS | CW; no allocated serial | cabrillo, adif |
| [`10_10_winter_phone`](#10_10_winter_phone) — 10 10 WINTER PHONE | contest / ten-ten-membership | PASS | SSB; no allocated serial | cabrillo, adif |
| [`10_10_summer_phone`](#10_10_summer_phone) — 10 10 SUMMER PHONE | contest / ten-ten-membership | PASS | SSB; no allocated serial | cabrillo, adif |
| [`jidx_cw`](#jidx_cw) — JIDX CW | contest / prefecture-or-zone | PASS | CW; no allocated serial | cabrillo, adif |
| [`jidx_ph`](#jidx_ph) — JIDX PH | contest / prefecture-or-zone | PASS | SSB; no allocated serial | cabrillo, adif |
| [`aadx_cw`](#aadx_cw) — AADX CW | contest / age-and-asian-prefix | PASS | CW; no allocated serial | cabrillo, adif |
| [`aadx_ssb`](#aadx_ssb) — AADX SSB | contest / age-and-asian-prefix | PASS | SSB; no allocated serial | cabrillo, adif |
| [`cq_160_cw`](#cq_160_cw) — CQ 160 CW | contest / 160m-state-country | PASS | CW; no allocated serial | cabrillo, adif |
| [`cq_160_ssb`](#cq_160_ssb) — CQ 160 SSB | contest / 160m-state-country | PASS | SSB; no allocated serial | cabrillo, adif |
| [`euhfc`](#euhfc) — EUHFC | contest / licence-year | PASS | CW; no allocated serial | cabrillo, adif |
| [`iaru_hf`](#iaru_hf) — IARU HF | contest / itu-zone-or-hq | PASS | CW; no allocated serial | cabrillo, adif |
| [`arrl_10m`](#arrl_10m) — ARRL 10M | contest / regional-serial-or-location | PASS | CW; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`arrl_160m`](#arrl_160m) — ARRL 160-Meter | contest / regional-serial-or-location | PASS | CW; no allocated serial | cabrillo, adif |
| [`arrl_field_day`](#arrl_field_day) — ARRL Field Day | contest / field-day-class-or-serial | PASS | AM; no allocated serial | cabrillo, adif |
| [`arrl_rtty_ru`](#arrl_rtty_ru) — ARRL RTTY Roundup | contest / regional-serial-or-location | PASS | RTTY; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`arrl_vhf_jan`](#arrl_vhf_jan) — ARRL VHF JAN | contest / received-grid-by-band | PASS | CW; no allocated serial | cabrillo, adif |
| [`arrl_vhf_jun`](#arrl_vhf_jun) — ARRL VHF JUN | contest / received-grid-by-band | PASS | AM; no allocated serial | cabrillo, adif |
| [`arrl_vhf_sep`](#arrl_vhf_sep) — ARRL VHF SEP | contest / received-grid-by-band | PASS | CW; no allocated serial | cabrillo, adif |
| [`ea_majestad_cw`](#ea_majestad_cw) — His Maj. King of Spain Contest, CW | contest / regional-serial-or-location | PASS | CW; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`ea_majestad_ssb`](#ea_majestad_ssb) — His Maj. King of Spain Contest, SSB | contest / regional-serial-or-location | PASS | SSB; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`ref_cw`](#ref_cw) — French REF DX contest - CW | contest / french-department-or-serial | PASS | CW; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`ref_ssb`](#ref_ssb) — French REF DX contest - SSB | contest / french-department-or-serial | PASS | SSB; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`rsgb_80m_cc`](#rsgb_80m_cc) — RSGB 80M CC | contest / serial-dx-or-regional | PASS | CW; allocated serial | cabrillo, adif |
| [`rsgb_commonwealth_beru`](#rsgb_commonwealth_beru) — RSGB Commonwealth BERU | contest / serial-dx-or-regional | PASS | CW; allocated serial | cabrillo, adif |
| [`es_field_day`](#es_field_day) — ES FIELD DAY | contest / regional-timed-repeat | PASS | CW; allocated serial | cabrillo, adif |
| [`es_ll_kv`](#es_ll_kv) — ES LL KV | contest / regional-timed-repeat | PASS | CW; allocated serial | cabrillo, adif |
| [`es_manual_key`](#es_manual_key) — ES MANUAL KEY | contest / regional-timed-repeat | PASS | CW; allocated serial | cabrillo, adif |
| [`es_open`](#es_open) — ES OPEN | contest / regional-timed-repeat | PASS | CW; allocated serial | cabrillo, adif |
| [`hadx`](#hadx) — HA DX | contest / regional-serial-or-location | PASS | CW; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`helvetia`](#helvetia) — HELVETIA | contest / regional-serial-or-location | PASS | CW; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`pacc`](#pacc) — PACC | contest / regional-serial-or-location | PASS | CW; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`spdx`](#spdx) — SPDX | contest / regional-serial-or-location | PASS | CW; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`ari_dx`](#ari_dx) — ARI International DX | contest / regional-serial-or-location | PASS | CW; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`darc_xmas`](#darc_xmas) — DARC XMAS | contest / regional-serial-or-location | PASS | CW; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`eudx`](#eudx) — EUDXC | contest / regional-serial-or-location | PASS | CW; no allocated serial | cabrillo, adif |
| [`lz-dx`](#lz-dx) — LZ DX | contest / regional-serial-or-location | PASS | CW; no allocated serial | cabrillo, adif |
| [`wag`](#wag) — WAG | contest / regional-serial-or-location | PASS | CW; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`ari_40_80`](#ari_40_80) — ARI 40 80 | contest / regional-serial-or-location | PASS | CW; no allocated serial | cabrillo, adif |
| [`ea_rtty`](#ea_rtty) — EA RTTY | contest / regional-serial-or-location | PASS | RTTY; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`ok1wc`](#ok1wc) — OK1WC Memorial Contest (MWC) | contest / serial-dx-or-regional | PASS | CW; allocated serial | cabrillo, adif |
| [`ssa_mt_cw`](#ssa_mt_cw) — SSA MT CW | contest / grid-distance-or-square-bonus | PASS | CW; allocated serial | cabrillo, adif |
| [`ssa_mt_ssb`](#ssa_mt_ssb) — SSA MT SSB | contest / grid-distance-or-square-bonus | PASS | SSB; allocated serial | cabrillo, adif |
| [`dxpedition`](#dxpedition) — DX-Pedition | utility / utility-logging | PASS | CW; no allocated serial | adif |
| [`general_logging`](#general_logging) — General Logging | utility / utility-logging | PASS | CW; no allocated serial | adif |
| [`randomgram`](#randomgram) — RandomGram | utility / utility-logging | PASS | CW; no allocated serial | adif |
| [`qso_party_rst`](#qso_party_rst) — QSO PARTY RST | generic-template / county-qso-party | PASS | CW; no allocated serial | cabrillo, adif |
| [`qso_party_sn`](#qso_party_sn) — QSO PARTY SN | generic-template / county-qso-party | PASS | CW; allocated serial | cabrillo, adif |
| [`ca_qso_party`](#ca_qso_party) — California QSO Party | contest / county-qso-party | PASS | CW; allocated serial | cabrillo, adif |
| [`canada_day`](#canada_day) — CANADA DAY | contest / regional-serial-or-location | PASS | CW; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`cqws`](#cqws) — CQ WORLD SCOUT | contest / scout-classification-and-uf | UNVERIFIED | CW; no allocated serial | cabrillo, adif |
| [`darc_schwaben`](#darc_schwaben) — DARC SCHWABEN | contest / regional-serial-or-location | PASS | CW; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`winter_field_day`](#winter_field_day) — Winter Field Day | contest / field-day-class-or-serial | PASS | CW; no allocated serial | cabrillo, adif |
| [`agcw_qrp`](#agcw_qrp) — AGCW QRP | contest / regional-serial-or-location | PASS | CW; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`raem`](#raem) — RAEM | contest / coordinate-exchange | PASS | CW; allocated serial | cabrillo, adif |
| [`rda_contest`](#rda_contest) — RDA Contest | contest / regional-serial-or-location | PASS | CW; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`rdxc`](#rdxc) — RDXC | contest / regional-serial-or-location | PASS | CW; allocated serial | cabrillo, adif |
| [`rsgb_iota`](#rsgb_iota) — RSGB-IOTA | contest / regional-serial-or-location | PASS | CW; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`stew_perry_topband`](#stew_perry_topband) — Stew Perry Topband | contest / grid-distance-or-square-bonus | PASS | CW; no allocated serial | cabrillo, adif |
| [`ukeidx`](#ukeidx) — UKEI-DX | contest / regional-serial-or-location | PASS | CW; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`wia_remembrance`](#wia_remembrance) — WIA REMEMBRANCE | contest / timed-or-location-repeat | PASS | CW; conditional; entrant/configuration determines allocation | cabrillo, adif |
| [`cq_ww_vhf`](#cq_ww_vhf) — CQ WW VHF | contest / received-grid-by-band | PASS | CW; no allocated serial | cabrillo, adif |
| [`darc_vhf`](#darc_vhf) — DARC VHF | contest / grid-distance-or-square-bonus | PASS | CW; allocated serial | cabrillo, adif, edi |
| [`john_moyle_field_day`](#john_moyle_field_day) — John Moyle Field Day | contest / timed-or-location-repeat | PASS | CW; allocated serial | cabrillo, adif |
| [`labre_rs_digi`](#labre_rs_digi) — LABRE-RS Digi | contest / received-grid-by-band | PASS | RTTY; no allocated serial | cabrillo, adif |
| [`nac_vhf`](#nac_vhf) — NAC VHF | contest / grid-distance-or-square-bonus | PASS | CW; allocated serial | cabrillo, adif, edi |
| [`ta_vhf_uhf_contest`](#ta_vhf_uhf_contest) — TA VHF UHF | contest / grid-distance-or-square-bonus | PASS | CW; allocated serial | adif, edi |
| [`vhf_sprint`](#vhf_sprint) — VHF SPRINT | contest / received-grid-by-band | PASS | CW; no allocated serial | cabrillo, adif |

## Feature interpretation and remaining acceptance

All definitions have individual core and optional statuses with reasons in JSON. Utilities require their advertised ADIF lifecycle, not contest scoring or Cabrillo. QSO Party RST/SN are templates and are not certified sponsor definitions. Their fixture scoring is integration evidence only.

Basic analytics counts/snapshot/paging are checked for every ID. Advanced credited multiplier/history adapters, finite Needed universes and retrospective duplicate annotations vary by family; unavailable dimensions remain unknown rather than zero. The shared consistency document identifies the tested CQ WW, WPX, Sweepstakes, NAQP/SST, unique-call, ARRL DX, IARU and RTTY adapters. A host descriptor advertising a matrix does not certify every detailed view for every configuration.

Recorded voice, CW output, digital engines/transports, recorder playback, multi-operator networking and hardware acceptance remain per-plugin UNVERIFIED where applicable. Existing simulated family tests can support macros/ESM and shared fixture audio supports recorder behavior; the catalogue run does not open RF/PTT/audio outputs or create local recording links for imported contacts. No output transport, station authority or safety owner was bypassed.

## Per-definition setup and fixture appendix

Each definition below includes the exact successful source fixture. JSON retains all captured family test IDs, multiplier/bonus dimensions and scopes, and exact source callback line references for points, multipliers and total calculation. Host compatibility and sponsor-rule overlays are recorded in `python/vendor/not1mm/PATCHES.md`; the immutable pinned plugin bytes are separately hashed.

### cq_ww_cw

**CQ WW CW** — contest; family `cq-ww-zone-country`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Sent Exchange. Serial: no allocated serial.

Fixture station: `CQZone=15, Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=15`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; CQ Zone (`other_2`) = `5`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: DXCC country and CQ zone, separately per band. First-contact fixture: points=3, multipliers=2, total=6; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_call_history_host.CallHistoryHostTests.test_plugin_history_is_cleared_for_the_next_qso`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — Host descriptor supports countries, zones; detailed per-plugin view assertions are separate from catalogue core checks. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### cq_ww_ssb

**CQ WW SSB** — contest; family `cq-ww-zone-country`. Core **PASS**.

Modes: SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: CQ Zone No.. Serial: no allocated serial.

Fixture station: `CQZone=15, Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=SSB, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=15`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `57`; RCV (`receive`) = `58`; CQ Zone (`other_2`) = `5`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: DXCC country and CQ zone, separately per band. First-contact fixture: points=3, multipliers=2, total=6; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_cq_ww_ssb_host.CQWWSSBHostTests.test_correction_delete_restart_and_cabrillo_ph_output`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — Host descriptor supports countries, zones; detailed per-plugin view assertions are separate from catalogue core checks. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### cq_ww_rtty

**CQ WW RTTY** — contest; family `cq-ww-zone-country`. Core **PASS**.

Modes: RTTY, RTTY-R, LSB-D, USB-D, AM-D, FM-D, DIGI-U, DIGI-L, RTTYR, PKTLSB, PKTUSB. Bands: 80m, 40m, 20m, 15m, 10m. Sent exchange hint: CQ Zone + (state/VE area). Serial: no allocated serial.

Fixture station: `ARRLSection=DX, Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=RTTY, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=15`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; CQ Zone (`other_1`) = `5`; State/Prov (`other_2`) = `CT`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: DXCC country, CQ zone and state/VE-area exchange, separately per band. First-contact fixture: points=3, multipliers=3, total=9; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_cq_ww_rtty_host.CQWWRTTYHostTests.test_correction_delete_restart_and_cabrillo_rtty_submode_output`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — Host descriptor supports countries, zones; detailed per-plugin view assertions are separate from catalogue core checks. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### cq_wpx_cw

**CQ WPX CW** — contest; family `wpx-prefix-serial`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Sent Exchange. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `ModeCategory=CW, OverlayCategory=N/A, SentExchange=CONFIGURED`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; RcvNR (`other_2`) = `404`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: WPX prefix once across the contest. First-contact fixture: points=3, multipliers=1, total=3; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_multi_operator_host.MultiOperatorHostTests.test_empty_replica_page_does_not_skip_later_contact_and_contest_number_is_local`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### cq_wpx_ssb

**CQ WPX SSB** — contest; family `wpx-prefix-serial`. Core **PASS**.

Modes: SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Sent Exchange. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=SSB, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `57`; RCV (`receive`) = `58`; SentNR (`other_1`) = `001` [allocated/read-only]; RcvNR (`other_2`) = `100`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: WPX prefix once across the contest. First-contact fixture: points=3, multipliers=1, total=3; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_cq_wpx_ssb_host.CQWPXSSBHostTests.test_correction_delete_restart_and_ph_export`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### cq_wpx_rtty

**CQ WPX RTTY** — contest; family `wpx-prefix-serial`. Core **PASS**.

Modes: RTTY, RTTY-R, LSB-D, USB-D, AM-D, FM-D, DIGI-U, DIGI-L, RTTYR, PKTLSB, PKTUSB. Bands: 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Sent Exchange. Serial: allocated serial.

Fixture station: `ARRLSection=DX, Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=RTTY, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=IGNORED BY SERIAL OWNER`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; RcvNR (`other_2`) = `100`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: WPX prefix once across the contest. First-contact fixture: points=3, multipliers=1, total=3; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_next_rtty_plugins_host.CQWPXRTTYHostTests.test_esm_commits_with_fldigi_output`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### arrl_ss_cw

**ARRL Sweepstakes CW** — contest; family `sweepstakes-compound`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Prec Call Check Section. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `ModeCategory=CW, OverlayCategory=N/A, SentExchange=A OM0RX 67 CT`. Entry examples: Call (`callsign`) = `DL1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; sn: p: cl: ck: sec: (`other_2`) = `123 A K1ABC 67 CT`.

Duplicate scope: Worked in this contest. (plugin type 1). Multiplier/bonus scope: ARRL/RAC section once across the contest. First-contact fixture: points=2, multipliers=1, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_sweepstakes_host.SweepstakesHostTests.test_catalog_source_layout_and_original_parser_results`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### arrl_ss_phone

**ARRL Sweepstakes Phone** — contest; family `sweepstakes-compound`. Core **PASS**.

Modes: SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Prec Call Check Section. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=SSB, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=A OM0RX 67 CT`. Entry examples: Call (`callsign`) = `DL1ABC`; SNT (`sent`) = `59`; RCV (`receive`) = `59`; SentNR (`other_1`) = `001` [allocated/read-only]; sn: p: cl: ck: sec: (`other_2`) = `123A K1ABC 67CT`.

Duplicate scope: Worked in this contest. (plugin type 1). Multiplier/bonus scope: ARRL/RAC section once across the contest. First-contact fixture: points=2, multipliers=1, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_arrl_ss_phone_host.ARRLSweepstakesPhoneHostTests.test_original_bytes_catalog_fields_parser_and_setup_validation`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### arrl_dx_cw

**ARRL DX CW** — contest; family `arrl-dx-domestic-or-dx`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Power/State/Province. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=100`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Power/State/Province (`other_2`) = `CT`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Entrant-dependent DXCC countries or US states/VE provinces per band, using eligible three-point contacts. First-contact fixture: points=3, multipliers=1, total=3; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_next_cw_plugins_host.ARRLDXCWHostTests.test_original_run_esm_emits_exchange_and_commits`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### arrl_dx_ssb

**ARRL DX SSB** — contest; family `arrl-dx-domestic-or-dx`. Core **PASS**.

Modes: SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Power/State/Province. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=SSB, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=100`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `59`; RCV (`receive`) = `59`; Power/State/Province (`other_2`) = `CT`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Entrant-dependent DXCC countries or US states/VE provinces per band, using eligible three-point contacts. First-contact fixture: points=3, multipliers=1, total=3; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_remaining_phone_plugins_host.ARRLDXSSBHostTests.test_original_source_layout_scoring_corrections_restart_and_export`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### naqp_cw

**NAQP CW** — contest; family `name-spc`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Name + SPC. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=OLIVER DX`. Entry examples: Call (`callsign`) = `K1ABC`; Name (`other_1`) = `JOHN`; State (`other_2`) = `CT`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: State/province/country section code per band, excluding DX sentinel. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_next_cw_plugins_host.NAQPCWHostTests.test_original_run_esm_emits_exchange_and_commits`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### naqp_ssb

**NAQP SSB** — contest; family `name-spc`. Core **PASS**.

Modes: SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Name + SPC. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=SSB, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=OLIVER DX`. Entry examples: Call (`callsign`) = `K1ABC`; Name (`other_1`) = `JOHN`; State (`other_2`) = `CT`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: State/province/country section code per band, excluding DX sentinel. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_remaining_phone_plugins_host.NAQPSSBHostTests.test_original_source_layout_scoring_esm_corrections_and_export`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### naqp_rtty

**NAQP RTTY** — contest; family `name-spc`. Core **PASS**.

Modes: RTTY, RTTY-R, LSB-D, USB-D, AM-D, FM-D, DIGI-U, DIGI-L, RTTYR, PKTLSB, PKTUSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Name + SPC. Serial: no allocated serial.

Fixture station: `ARRLSection=DX, Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=RTTY, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=OLIVER DX`. Entry examples: Call (`callsign`) = `K1ABC`; Name (`other_1`) = `JOHN`; State (`other_2`) = `CT`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: State/province/country section code per band, excluding DX sentinel. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_next_rtty_plugins_host.NAQPRTTYHostTests.test_section_scoring_correction_delete_restart_and_cabrillo`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### phone_weekly_test

**PHONE WEEKLY TEST** — contest; family `name-spc`. Core **PASS**.

Modes: SSB. Bands: 160m, 80m, 40m, 20m, 15m. Sent exchange hint: Name + SPC. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=SSB, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=OLIVER DX`. Entry examples: Call (`callsign`) = `K1ABC`; Name (`other_1`) = `JOHN`; State (`other_2`) = `CT`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: State/province/country section code per band, excluding DX sentinel. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_remaining_phone_plugins_host.PhoneWeeklyTestHostTests.test_original_source_layout_scoring_esm_corrections_and_export`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### weekly_rtty

**WEEKLY RTTY TEST** — contest; family `name-number-unique-call`. Core **PASS**.

Modes: RTTY, RTTY-R, LSB-D, USB-D, AM-D, FM-D, DIGI-U, DIGI-L, RTTYR, PKTLSB, PKTUSB. Bands: 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Name + SPC. Serial: no allocated serial.

Fixture station: `ARRLSection=DX, Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=RTTY, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=OLIVER DX`. Entry examples: Call (`callsign`) = `K1ABC`; Name (`other_1`) = `JOHN`; SPC (`other_2`) = `CT`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Unique worked call once across bands. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_next_rtty_plugins_host.WeeklyRTTYHostTests.test_unique_call_scoring_is_not_naqp_and_relocates`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### icwc_mst

**ICWC Medium Speed Test** — contest; family `name-number-unique-call`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Name. Serial: allocated serial.

Fixture station: `Call=OM0RX`. Setup/category: `ModeCategory=CW, OverlayCategory=N/A, SentExchange=OLIVER`. Entry examples: Call (`callsign`) = `K1ABC`; Sent S/N (`other_1`) = `001` [allocated/read-only]; Name + S/N (`other_2`) = `BOB 12`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Unique worked call once across bands. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_mst_host.MSTHostTests.test_macro_esm_partial_failure_receipt_replay_and_serial`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### cwt

**CWT** — contest; family `name-number-unique-call`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Sent Exchange. Serial: no allocated serial.

Fixture station: `Call=OM0RX`. Setup/category: `ModeCategory=CW, OverlayCategory=N/A, SentExchange=OLIVER 1234`. Entry examples: Call (`callsign`) = `K1ABC`; Name (`other_1`) = `ALICE`; Number or State (`other_2`) = `100`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Unique worked call once across bands. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_cwt_sst_host.CWTHostTests.test_correction_preserves_historical_sent_exchange_after_setup_change`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### cwo

**CWOPS - Open** — contest; family `name-number-unique-call`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Name. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88TQ, Name=OLIVER BROSS`. Setup/category: `ModeCategory=CW, OverlayCategory=N/A, SentExchange=OLIVER`. Entry examples: Call (`callsign`) = `K1ABC`; SentNR (`other_1`) = `001` [allocated/read-only]; Recd Number and Name (`other_2`) = `12 ALICE`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Unique worked call once across bands. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_cwo_host.CWOHostTests.test_esm_commit_receipt_replay_and_serial_progression`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### k1usn_sst

**K1USN SLOW SPEED TEST** — contest; family `name-spc`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Sent Exchange. Serial: no allocated serial.

Fixture station: `Call=OM0RX`. Setup/category: `ModeCategory=CW, OverlayCategory=N/A, SentExchange=OLIVER SD`. Entry examples: Call (`callsign`) = `K1ABC`; Name (`other_1`) = `ALICE`; SPC (`other_2`) = `CT`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: State/province/country section code per band, excluding DX sentinel. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_cwt_sst_host.K1USNSSTHostTests.test_correction_preserves_historical_sent_exchange_after_setup_change`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### trans_tasman

**Trans Tasman CW** — contest; family `timed-or-location-repeat`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m. Sent exchange hint: Sent Exchange. Serial: allocated serial.

Fixture station: `Call=VK4ABC`. Setup/category: `ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, SentExchange=`. Entry examples: Call (`callsign`) = `ZL1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; RcvNR (`other_2`) = `012`.

Duplicate scope: Worked on this band and mode in this 2-hour UTC block (08–10, 10–12, 12–14). (plugin type 5). Multiplier/bonus scope: Eligible VK/ZL WPX prefix per band and two-hour UTC block. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_trans_tasman_host.TransTasmanHostTests.test_blocks_duplicates_score_correction_delete_export_and_reopen`. Append: PASS — 9 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### oceania_dx_cw

**Oceania DX CW** — contest; family `serial-dx-or-regional`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Sent Exchange. Serial: allocated serial.

Fixture station: `Call=OM0RX`. Setup/category: `ModeCategory=CW, OverlayCategory=N/A, SentExchange=`. Entry examples: Call (`callsign`) = `VK4ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; RcvNR (`other_2`) = `012`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Eligible Oceania WPX prefix per band; stored first-prefix flags. First-contact fixture: points=20, multipliers=1, total=20; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_oceania_host.OceaniaHostTests.test_all_band_points_prefix_scopes_duplicates_and_geography`. Append: PASS — 14 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### oceania_dx_ssb

**Oceania DX SSB** — contest; family `serial-dx-or-regional`. Core **PASS**.

Modes: SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Sent Exchange. Serial: allocated serial.

Fixture station: `Call=OM0RX`. Setup/category: `ModeCategory=SSB, OverlayCategory=N/A, SentExchange=`. Entry examples: Call (`callsign`) = `VK4ABC`; SNT (`sent`) = `59`; RCV (`receive`) = `59`; SentNR (`other_1`) = `001` [allocated/read-only]; RcvNR (`other_2`) = `012`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Eligible Oceania WPX prefix per band; stored first-prefix flags. First-contact fixture: points=20, multipliers=1, total=20; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_oceania_host.OceaniaSSBHostTests.test_all_band_points_prefix_scopes_duplicates_and_geography`. Append: PASS — 16 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### sac_cw

**SAC CW** — contest; family `serial-dx-or-regional`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Sent Exchange. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=`. Entry examples: Call (`callsign`) = `SM1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; RcvNR (`other_2`) = `101`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Entrant-dependent country per band or Scandinavian country/call-area per band. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_sac_host.SACCWHostTests.test_original_esm_commits_and_advances_serial`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### sac_ssb

**SAC SSB** — contest; family `serial-dx-or-regional`. Core **PASS**.

Modes: SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Sent Exchange. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=SSB, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=`. Entry examples: Call (`callsign`) = `SM1ABC`; SNT (`sent`) = `59`; RCV (`receive`) = `59`; SentNR (`other_1`) = `001` [allocated/read-only]; RcvNR (`other_2`) = `101`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Entrant-dependent country per band or Scandinavian country/call-area per band. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_sac_host.SACSSBHostTests.test_original_esm_commits_and_advances_serial`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### iaru_fieldday_r1_cw

**IARU FIELDDAY R1 DARC CW** — contest; family `field-day-class-or-serial`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Sent Exchange. Serial: allocated serial.

Fixture station: `Call=OM0RX/P, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=`. Entry examples: Call (`callsign`) = `DL1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; RcvNR (`other_2`) = `101`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Country per band; stored first-country flags. First-contact fixture: points=2, multipliers=1, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_iaru_fieldday_host.FieldDayCWHostTests.test_original_esm_commits_and_advances_serial`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### iaru_fieldday_r1_ssb

**IARU FIELDDAY R1 DARC SSB** — contest; family `field-day-class-or-serial`. Core **PASS**.

Modes: SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Sent Exchange. Serial: allocated serial.

Fixture station: `Call=OM0RX/P, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=SSB, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=`. Entry examples: Call (`callsign`) = `DL1ABC`; SNT (`sent`) = `59`; RCV (`receive`) = `59`; SentNR (`other_1`) = `001` [allocated/read-only]; RcvNR (`other_2`) = `101`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Country per band; stored first-country flags. First-contact fixture: points=2, multipliers=1, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_iaru_fieldday_host.FieldDaySSBHostTests.test_original_esm_commits_and_advances_serial`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### 10_10_fall_cw

**10 10 FALL CW** — contest; family `ten-ten-membership`. Core **PASS**.

Modes: CW. Bands: 10m. Sent exchange hint: Sent Exchange. Serial: no allocated serial.

Fixture station: `Call=OM0RX`. Setup/category: `ModeCategory=CW, OverlayCategory=N/A, SentExchange=OLIVER 12345 NT`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Name 1010# SPC (`other_2`) = `ALICE 12345 CT`.

Duplicate scope: Worked in this contest. (plugin type 1). Multiplier/bonus scope: No contest multiplier; total uses stored contact points. First-contact fixture: points=2, multipliers=0, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_ten_ten_host.TenTenHostTests.test_correction_delete_row_specific_rescore_and_restart`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### 10_10_spring_cw

**10 10 SPRING CW** — contest; family `ten-ten-membership`. Core **PASS**.

Modes: CW. Bands: 10m. Sent exchange hint: Sent Exchange. Serial: no allocated serial.

Fixture station: `Call=OM0RX`. Setup/category: `ModeCategory=CW, OverlayCategory=N/A, SentExchange=OLIVER 12345 NT`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Name 1010# SPC (`other_2`) = `ALICE 12345 CT`.

Duplicate scope: Worked in this contest. (plugin type 1). Multiplier/bonus scope: No contest multiplier; total uses stored contact points. First-contact fixture: points=2, multipliers=0, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_ten_ten_host.TenTenHostTests.test_correction_delete_row_specific_rescore_and_restart`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### 10_10_winter_phone

**10 10 WINTER PHONE** — contest; family `ten-ten-membership`. Core **PASS**.

Modes: SSB. Bands: 10m. Sent exchange hint: Sent Exchange. Serial: no allocated serial.

Fixture station: `Call=OM0RX`. Setup/category: `ModeCategory=SSB, OverlayCategory=N/A, SentExchange=OLIVER 12345 NT`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `59`; RCV (`receive`) = `59`; Name 1010# SPC (`other_2`) = `ALICE 12345 CT`.

Duplicate scope: Worked in this contest. (plugin type 1). Multiplier/bonus scope: No contest multiplier; total uses stored contact points. First-contact fixture: points=2, multipliers=0, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_ten_ten_host.TenTenHostTests.test_correction_delete_row_specific_rescore_and_restart`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### 10_10_summer_phone

**10 10 SUMMER PHONE** — contest; family `ten-ten-membership`. Core **PASS**.

Modes: SSB. Bands: 10m. Sent exchange hint: Sent Exchange. Serial: no allocated serial.

Fixture station: `Call=OM0RX`. Setup/category: `ModeCategory=SSB, OverlayCategory=N/A, SentExchange=OLIVER 12345 NT`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `59`; RCV (`receive`) = `59`; Name 1010# SPC (`other_2`) = `ALICE 12345 CT`.

Duplicate scope: Worked in this contest. (plugin type 1). Multiplier/bonus scope: No contest multiplier; total uses stored contact points. First-contact fixture: points=2, multipliers=0, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_ten_ten_host.TenTenHostTests.test_correction_delete_row_specific_rescore_and_restart`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### jidx_cw

**JIDX CW** — contest; family `prefecture-or-zone`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Prefecture or CQ Zone. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=15`. Entry examples: Call (`callsign`) = `JA1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `15`; RcvNR (`other_2`) = `13`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: New scoringRevision=26.10.26: DX entrant counts eligible Japanese prefecture/JD1 island number per band; Japanese entrant counts DXCC entity and received CQ zone per band. Maritime-mobile contacts give only Japanese entrants points/zone credit, with no entity credit. Historical unmarked sessions retain the pinned global received-number count. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_jidx_plugins_host.JIDXCWHostTests.test_numeric_exchange_validation_and_original_esm_commit`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Official English rules revision 2026-10 sections 5–7 support six bands including 160 m in both modes, JA/DX eligibility, per-band prefecture or country/zone credit, JD1 and maritime-mobile handling. These checks support the new scoringRevision=26.10.26 overlay; remaining sponsor clauses and full-edition certification remain unverified. Historical unmarked sessions retain their pinned behavior; see PATCHES.md.

Operator setup for new marked sessions: Japanese land stations send their prefecture/island number (1–50); DX and maritime-mobile stations send their CQ zone (1–40). Enter the received value for the counterpart's role. These bounds apply to setup, commits and corrections; historical unmarked-session compatibility remains separate.

### jidx_ph

**JIDX PH** — contest; family `prefecture-or-zone`. Core **PASS**.

Modes: SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Prefecture or CQ Zone. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=SSB, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=15`. Entry examples: Call (`callsign`) = `JA1ABC`; SNT (`sent`) = `59`; RCV (`receive`) = `59`; SentNR (`other_1`) = `15`; RcvNR (`other_2`) = `13`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: New scoringRevision=26.10.26: DX entrant counts eligible Japanese prefecture/JD1 island number per band; Japanese entrant counts DXCC entity and received CQ zone per band. Maritime-mobile contacts give only Japanese entrants points/zone credit, with no entity credit. Historical unmarked sessions retain the pinned global received-number count. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_jidx_plugins_host.JIDXPhoneHostTests.test_numeric_exchange_validation_and_original_esm_commit`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Official English rules revision 2026-10 sections 5–7 support six bands including 160 m in both modes, JA/DX eligibility, per-band prefecture or country/zone credit, JD1 and maritime-mobile handling. These checks support the new scoringRevision=26.10.26 overlay; remaining sponsor clauses and full-edition certification remain unverified. Historical unmarked sessions retain their pinned behavior; see PATCHES.md.

Operator setup for new marked sessions: Japanese land stations send their prefecture/island number (1–50); DX and maritime-mobile stations send their CQ zone (1–40). Enter the received value for the counterpart's role. These bounds apply to setup, commits and corrections; historical unmarked-session compatibility remains separate.

### aadx_cw

**AADX CW** — contest; family `age-and-asian-prefix`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Age (or 01). Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=42`. Entry examples: Call (`callsign`) = `JA1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `42`; RcvNR (`other_2`) = `21`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Asian entrant: other DXCC country per band; non-Asian entrant: eligible worked Asian WPX prefix per band. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_aadx_plugins_host.AADXCWHostTests.test_original_source_projection_validation_and_esm`. Append: PASS — 3 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### aadx_ssb

**AADX SSB** — contest; family `age-and-asian-prefix`. Core **PASS**.

Modes: SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Age (or 01). Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=SSB, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=42`. Entry examples: Call (`callsign`) = `JA1ABC`; SNT (`sent`) = `59`; RCV (`receive`) = `59`; SentNR (`other_1`) = `42`; RcvNR (`other_2`) = `21`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Asian entrant: other DXCC country per band; non-Asian entrant: eligible worked Asian WPX prefix per band. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_aadx_plugins_host.AADXSSBHostTests.test_original_source_projection_validation_and_esm`. Append: PASS — 3 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### cq_160_cw

**CQ 160 CW** — contest; family `160m-state-country`. Core **PASS**.

Modes: CW. Bands: 160m. Sent exchange hint: ST/Prov or DX CQ Zone. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=160M, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=15`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; ST/Prov/CQ Zone (`other_2`) = `CT`.

Duplicate scope: Worked in this contest. (plugin type 1). Multiplier/bonus scope: US state, Canadian province and eligible DXCC entity; single 160 m contest scope. First-contact fixture: points=10, multipliers=1, total=10; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_cq_160_plugins_host.CQ160CWHostTests.test_original_scoring_rebuild_restart_and_export`. Append: PASS — 6 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### cq_160_ssb

**CQ 160 SSB** — contest; family `160m-state-country`. Core **PASS**.

Modes: SSB. Bands: 160m. Sent exchange hint: ST/Prov or DX CQ Zone. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=160M, ModeCategory=SSB, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=15`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `59`; RCV (`receive`) = `59`; ST/Prov/CQ Zone (`other_2`) = `CT`.

Duplicate scope: Worked in this contest. (plugin type 1). Multiplier/bonus scope: US state, Canadian province and eligible DXCC entity; single 160 m contest scope. First-contact fixture: points=10, multipliers=1, total=10; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_cq_160_plugins_host.CQ160SSBHostTests.test_original_scoring_rebuild_restart_and_export`. Append: PASS — 6 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### euhfc

**EUHFC** — contest; family `licence-year`. Core **PASS**.

Modes: CW, SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Lic. Year (2 digits). Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88, IARUZone=28`. Setup/category: `BandCategory=ALL, ModeCategory=MIXED, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=82`. Entry examples: Call (`callsign`) = `DL1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Lic Year (`other_2`) = `17`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Received licence-year value per band, independent of mode. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_euhfc_iaru_hf_host.EUHFCHostTests.test_original_scoring_band_mode_dupes_restart_and_export`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### iaru_hf

**IARU HF** — contest; family `itu-zone-or-hq`. Core **PASS**.

Modes: CW, SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: ITU Zone. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88, IARUZone=28`. Setup/category: `BandCategory=ALL, ModeCategory=MIXED, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=28`. Entry examples: Call (`callsign`) = `DL1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; ITU Zone (`other_2`) = `28`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: ITU zone or HQ exchange identity per band and mode. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_euhfc_iaru_hf_host.IARUHFHostTests.test_original_points_zone_and_hq_multipliers_restart_and_export`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### arrl_10m

**ARRL 10M** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW, SSB. Bands: 10m. Sent exchange hint: State/Province, serial or ITU region. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=MIXED, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#`. Entry examples: Call (`callsign`) = `DL1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; State|Prov|SN|ITU (`other_2`) = `001`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Received state/province/region or DXCC identity per mode; entrant eligibility and power settings remain plugin-owned. First-contact fixture: points=4, multipliers=1, total=4; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_arrl_single_band_plugins_host.ARRL10MHostTests.test_catalog_projection_conditional_serial_validation_and_esm`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### arrl_160m

**ARRL 160-Meter** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW. Bands: 160m. Sent exchange hint: ARRL/RAC section or DX CQ zone. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=15`. Entry examples: Call (`callsign`) = `DL1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; ARRL/RAC Section (`other_2`) = `14`.

Duplicate scope: Worked in this contest. (plugin type 1). Multiplier/bonus scope: Distinct ARRL/RAC section and DXCC identities across the 160 m contest. First-contact fixture: points=5, multipliers=1, total=5; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_arrl_single_band_plugins_host.ARRL160MHostTests.test_original_scoring_correction_delete_restart_and_cabrillo`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### arrl_field_day

**ARRL Field Day** — contest; family `field-day-class-or-serial`. Core **PASS**.

Modes: CW, SSB, RTTY, AM, FM. Bands: 160m, 80m, 40m, 20m, 15m, 10m, 6m, 2m, 1.25m, 70cm, 33cm, 23cm. Sent exchange hint: Class + ARRL/RAC section. Serial: no allocated serial.

Fixture station: `ARRLSection=ORG, Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=MIXED, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=1D ORG`. Entry examples: Call (`callsign`) = `K1ABC`; Class (`other_1`) = `2A`; Section (`other_2`) = `CT`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Unique band/mode operating combinations and configured power factors; separate sponsor bonus claims are not certified. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_arrl_field_rtty_vhf_host.ARRLFieldDayHostTests.test_am_fm_reports_scoring_and_exports_are_phone_compatible`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### arrl_rtty_ru

**ARRL RTTY Roundup** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: RTTY, RTTY-R, LSB-D, USB-D, AM-D, FM-D, DIGI-U, DIGI-L, RTTYR, PKTLSB, PKTUSB. Bands: 80m, 40m, 20m, 15m, 10m. Sent exchange hint: State/province or #. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `ARRLSection=ORG, Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=RTTY, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; State|Prov|SN (`other_2`) = `CT`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Received state/province or DXCC identity per stored mode; received serial remains separate. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_arrl_field_rtty_vhf_host.ARRLRTTYRoundupHostTests.test_serial_multiplier_correction_restart_and_exports`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### arrl_vhf_jan

**ARRL VHF JAN** — contest; family `received-grid-by-band`. Core **PASS**.

Modes: CW, SSB, RTTY, AM, FM. Bands: 6m, 2m, 1.25m, 70cm, 33cm, 23cm, 13cm, 9cm, 6cm, 3cm, 1.25cm, 6mm, 4mm, 2.5mm, 2mm, 1mm, submm. Sent exchange hint: 4-character grid square. Serial: no allocated serial.

Fixture station: `ARRLSection=ORG, Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=JN88`. Entry examples: Call (`callsign`) = `K1ABC`; Sent Grid (`other_1`) = `JN88`; Grid (`other_2`) = `FN31`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Received grid identity per band; contest-specific point/power factors remain plugin-owned. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_arrl_field_rtty_vhf_host.ARRLVHFHostTests.test_vhf_season_scoring_and_exact_plugin_differences`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### arrl_vhf_jun

**ARRL VHF JUN** — contest; family `received-grid-by-band`. Core **PASS**.

Modes: CW, SSB, RTTY, AM, FM. Bands: 6m, 2m, 1.25m, 70cm, 33cm, 23cm, 13cm, 9cm, 6cm, 3cm, 1.25cm, 6mm, 4mm, 2.5mm, 2mm, 1mm, submm. Sent exchange hint: 4-character grid square. Serial: no allocated serial.

Fixture station: `ARRLSection=ORG, Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=MIXED, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=JN88`. Entry examples: Call (`callsign`) = `K1ABC`; Sent Grid (`other_1`) = `JN88`; Grid (`other_2`) = `FN31`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Received grid identity per band; contest-specific point/power factors remain plugin-owned. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_arrl_field_rtty_vhf_host.ARRLVHFHostTests.test_vhf_am_fm_reports_scoring_and_cabrillo_are_phone_compatible`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### arrl_vhf_sep

**ARRL VHF SEP** — contest; family `received-grid-by-band`. Core **PASS**.

Modes: CW, SSB, RTTY, AM, FM. Bands: 6m, 2m, 1.25m, 70cm, 33cm, 23cm, 13cm, 9cm, 6cm, 3cm, 1.25cm, 6mm, 4mm, 2.5mm, 2mm, 1mm, submm. Sent exchange hint: 4-character grid square. Serial: no allocated serial.

Fixture station: `ARRLSection=ORG, Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=JN88`. Entry examples: Call (`callsign`) = `K1ABC`; Sent Grid (`other_1`) = `JN88`; Grid (`other_2`) = `FN31`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Received grid identity per band; contest-specific point/power factors remain plugin-owned. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_arrl_field_rtty_vhf_host.ARRLVHFHostTests.test_vhf_season_scoring_and_exact_plugin_differences`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### ea_majestad_cw

**His Maj. King of Spain Contest, CW** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Province or #. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#`. Entry examples: Call (`callsign`) = `EA1AAA`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; Prov or SN (`other_2`) = `M`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: DXCC country and Spanish province per band, plus pinned special-call band credit. First-contact fixture: points=3, multipliers=2, total=6; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_ea_majestad_plugins_host.KingOfSpainCWHostTests.test_scoring_correction_delete_restart_and_export`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### ea_majestad_ssb

**His Maj. King of Spain Contest, SSB** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Province or #. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=SSB, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#`. Entry examples: Call (`callsign`) = `EA1AAA`; SNT (`sent`) = `59`; RCV (`receive`) = `59`; SentNR (`other_1`) = `001` [allocated/read-only]; Prov or SN (`other_2`) = `M`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: DXCC country and Spanish province per band, plus pinned special-call band credit. First-contact fixture: points=3, multipliers=2, total=6; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_ea_majestad_plugins_host.KingOfSpainSSBHostTests.test_scoring_correction_delete_restart_and_export`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### ref_cw

**French REF DX contest - CW** — contest; family `french-department-or-serial`. Core **PASS**.

Modes: CW. Bands: 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Department/prefix or #. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#`. Entry examples: Call (`callsign`) = `F1AAA`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Sent (`other_1`) = `001` [allocated/read-only]; Dep/Pfx/SN (`other_2`) = `75`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: French department/prefix and DXCC entity per band; host overlay admits numeric departments and preserves first-occurrence scope. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_ref_plugins_host.REFCWHostTests.test_scoring_correction_delete_restart_and_export`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### ref_ssb

**French REF DX contest - SSB** — contest; family `french-department-or-serial`. Core **PASS**.

Modes: SSB. Bands: 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Department/prefix or #. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=SSB, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#`. Entry examples: Call (`callsign`) = `F1AAA`; SNT (`sent`) = `59`; RCV (`receive`) = `59`; Sent (`other_1`) = `001` [allocated/read-only]; Dep/Pfx/SN (`other_2`) = `75`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: French department/prefix and DXCC entity per band; host overlay admits numeric departments and preserves first-occurrence scope. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_ref_plugins_host.REFSSBHostTests.test_scoring_correction_delete_restart_and_export`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### rsgb_80m_cc

**RSGB 80M CC** — contest; family `serial-dx-or-regional`. Core **PASS**.

Modes: CW. Bands: 80m. Sent exchange hint: Serial number. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=FN03`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; RcvNR (`other_2`) = `001`.

Duplicate scope: Worked in this contest. (plugin type 1). Multiplier/bonus scope: No multiplicative contest identity; points/distance/timed behavior is calculated by the contest callback. First-contact fixture: points=1, multipliers=0, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_rsgb_plugins_host.RSGB80MCCHostTests.test_duplicate_correction_delete_restart_and_export`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### rsgb_commonwealth_beru

**RSGB Commonwealth BERU** — contest; family `serial-dx-or-regional`. Core **PASS**.

Modes: CW. Bands: 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Serial number (optional HQ). Serial: allocated serial.

Fixture station: `Call=VE3ABC, GridSquare=FN03`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#`. Entry examples: Call (`callsign`) = `G3AAA`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; RcvNR (`other_2`) = `101`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: No displayed multiplier; country/band bonus flags contribute through the BERU score callback. First-contact fixture: points=30, multipliers=0, total=30; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_rsgb_plugins_host.RSGBCommonwealthBERUHostTests.test_esm_commits_serial_and_hq_in_run_and_sandp_with_safe_reset_and_history`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### es_field_day

**ES FIELD DAY** — contest; family `regional-timed-repeat`. Core **PASS**.

Modes: CW, SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Serial + Estonian region. Serial: allocated serial.

Fixture station: `Call=ES1ABC, GridSquare=KO29, LicenseClass=05, State=HM`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#, StartDate=2026-10-21 08:00:00`. Entry examples: Call (`callsign`) = `ES5AAA`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Sent (`other_1`) = `001 HM` [allocated/read-only]; SN (`other_2`) = `001 HM`.

Duplicate scope: Worked on this band and mode in this configured 30-minute period; outside the schedule, band/mode applies. (plugin type 5). Multiplier/bonus scope: Received Estonian region suffix per band/mode; configured time blocks govern repeats separately. First-contact fixture: points=1, multipliers=1, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_estonian_plugins_host.EstonianPluginHostTests.test_field_day_multiplier_and_open_correction_restart_export`. Append: PASS — 4 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### es_ll_kv

**ES LL KV** — contest; family `regional-timed-repeat`. Core **PASS**.

Modes: CW, SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Serial number. Serial: allocated serial.

Fixture station: `Call=ES1ABC, GridSquare=KO29, LicenseClass=05, State=HM`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#, StartDate=2026-10-21 08:00:00`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Sent (`other_1`) = `001` [allocated/read-only]; SN (`other_2`) = `001`.

Duplicate scope: Worked on this band and mode in this configured 15-minute period; outside the schedule, band/mode applies. (plugin type 5). Multiplier/bonus scope: Estonian call-area identity per band/mode; configured time blocks govern repeats separately. First-contact fixture: points=2, multipliers=0, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_estonian_plugins_host.EstonianPluginHostTests.test_period_duplicates_scoring_and_exchange_validation`. Append: PASS — 3 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### es_manual_key

**ES MANUAL KEY** — contest; family `regional-timed-repeat`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Seniority + serial. Serial: allocated serial.

Fixture station: `Call=ES1ABC, GridSquare=KO29, LicenseClass=05, State=HM`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#, StartDate=2026-10-21 08:00:00`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Sent (`other_1`) = `05001` [allocated/read-only]; SN (`other_2`) = `05001`.

Duplicate scope: Worked on this band and mode in this configured 15-minute period; outside the schedule, band/mode applies. (plugin type 5). Multiplier/bonus scope: Estonian call-area identity per band/mode; configured time blocks govern repeats separately. First-contact fixture: points=25, multipliers=0, total=40; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_estonian_plugins_host.EstonianPluginHostTests.test_period_duplicates_scoring_and_exchange_validation`. Append: PASS — 3 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### es_open

**ES OPEN** — contest; family `regional-timed-repeat`. Core **PASS**.

Modes: CW, SSB. Bands: 80m, 40m. Sent exchange hint: Serial number. Serial: allocated serial.

Fixture station: `Call=ES1ABC, GridSquare=KO29, LicenseClass=05, State=HM`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#, StartDate=2026-10-21 08:00:00`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Sent (`other_1`) = `001` [allocated/read-only]; SN (`other_2`) = `001`.

Duplicate scope: Worked on this band and mode in this configured one-hour period; outside the schedule, band/mode applies. (plugin type 5). Multiplier/bonus scope: Eligible ES region per band/mode, including own region; current overlay limits to 80/40 m and excludes RU/BY scoring. First-contact fixture: points=2, multipliers=0, total=0; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_estonian_plugins_host.EstonianPluginHostTests.test_field_day_multiplier_and_open_correction_restart_export`. Append: PASS — 4 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### hadx

**HA DX** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW, SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: # or County. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=K1ABC, GridSquare=FN31`. Setup/category: `ModeCategory=CW, OverlayCategory=N/A, SentExchange=#`. Entry examples: Call (`callsign`) = `DL1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; HA County or SN (`other_2`) = `001`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Eligible DXCC/WAE country and Hungarian county per band; new-session sponsor overlay owns points and totals. First-contact fixture: points=5, multipliers=1, total=5; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_european_dx_plugins_host.EuropeanDxPluginTests.test_chronological_multiplier_callbacks_for_remaining_conditional_serial_families`. Append: PASS — 4 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### helvetia

**HELVETIA** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW, SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Canton or #. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=K1ABC, GridSquare=FN31`. Setup/category: `ModeCategory=CW, OverlayCategory=N/A, SentExchange=#`. Entry examples: Call (`callsign`) = `HB9ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Sent (`other_1`) = `001` [allocated/read-only]; Canton/SN (`other_2`) = `ZH`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Swiss canton and DXCC entity per band; stored first-occurrence flags. First-contact fixture: points=10, multipliers=2, total=20; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_european_dx_plugins_host.EuropeanDxPluginTests.test_chronological_multiplier_callbacks_for_remaining_conditional_serial_families`. Append: PASS — 4 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### pacc

**PACC** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW, SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: # or Province. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=K1ABC, GridSquare=FN31`. Setup/category: `ModeCategory=CW, OverlayCategory=N/A, SentExchange=#`. Entry examples: Call (`callsign`) = `PA1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; Prov or SN (`other_2`) = `ZH`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Entrant-dependent Dutch province or eligible country/call-area per band/mode; new-session overlay owns sponsor arithmetic. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_european_dx_plugins_host.EuropeanDxPluginTests.test_chronological_multiplier_callbacks_for_remaining_conditional_serial_families`. Append: PASS — 4 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### spdx

**SPDX** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW, SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Province/Territory. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=K1ABC, GridSquare=FN31`. Setup/category: `ModeCategory=CW, OverlayCategory=N/A, SentExchange=#`. Entry examples: Call (`callsign`) = `SP1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; Prov or SN (`other_2`) = `A`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Received Polish province identity per band/mode. First-contact fixture: points=3, multipliers=1, total=3; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_european_dx_plugins_host.EuropeanDxPluginTests.test_scoring_persistence_duplicate_mode_and_export`. Append: PASS — 2 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### ari_dx

**ARI International DX** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW, SSB, RTTY. Bands: 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Province or #. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=K1ABC, GridSquare=FN31`. Setup/category: `ModeCategory=MIXED, OverlayCategory=N/A, SentExchange=#`. Entry examples: Call (`callsign`) = `I1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; other_1 (`other_1`) = `001` [allocated/read-only]; Prov or SN (`other_2`) = `RM`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Italian province and DXCC country per band. First-contact fixture: points=10, multipliers=1, total=10; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_central_european_plugins_host.CentralEuropeanPluginTests.test_correction_rejects_plugin_invalid_historical_sent_exchange`. Append: PASS — 3 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### darc_xmas

**DARC XMAS** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW, SSB. Bands: 80m, 40m. Sent exchange hint: DOK/NM or #. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=K1ABC, GridSquare=FN31`. Setup/category: `ModeCategory=MIXED, OverlayCategory=N/A, SentExchange=#`. Entry examples: Call (`callsign`) = `DL1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; DOK/# Sent (`other_1`) = `001` [allocated/read-only]; DOK/# RCVD (`other_2`) = `A01`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: WPX prefix once across bands plus eligible German DOK per band; NM excluded from DOK credit. First-contact fixture: points=1, multipliers=2, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_central_european_plugins_host.CentralEuropeanPluginTests.test_scoring_same_second_replay_exports_and_rtty_contract`. Append: PASS — 2 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### eudx

**EUDXC** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW, SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: ITU zone or EU Union region. Serial: no allocated serial.

Fixture station: `Call=K1ABC, GridSquare=FN31`. Setup/category: `ModeCategory=MIXED, OverlayCategory=N/A, SentExchange=28`. Entry examples: Call (`callsign`) = `DL1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `28`; ITU/EU Union Region (`other_2`) = `28`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: EU region or DXCC country per mode, as pinned distinct-key queries. First-contact fixture: points=5, multipliers=1, total=5; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_central_european_plugins_host.CentralEuropeanPluginTests.test_correction_preserves_historical_sent_exchange_and_run_metadata`. Append: PASS — 5 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### lz-dx

**LZ DX** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW, SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: District or ITU zone. Serial: no allocated serial.

Fixture station: `Call=K1ABC, GridSquare=FN31`. Setup/category: `ModeCategory=MIXED, OverlayCategory=N/A, SentExchange=28`. Entry examples: Call (`callsign`) = `LZ1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; District/ITU (`other_2`) = `SO`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Pinned stored flags count alphabetic Bulgarian district and DXCC country per band; received ITU-zone field is not a universal CQ-zone multiplier. First-contact fixture: points=10, multipliers=2, total=20; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_central_european_plugins_host.CentralEuropeanPluginTests.test_correction_rejects_plugin_invalid_historical_sent_exchange`. Append: PASS — 2 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### wag

**WAG** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW, SSB. Bands: 80m, 40m, 20m, 15m, 10m. Sent exchange hint: DOK/NM or #. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=K1ABC, GridSquare=FN31`. Setup/category: `ModeCategory=MIXED, OverlayCategory=N/A, SentExchange=#`. Entry examples: Call (`callsign`) = `DL1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; DOK/# Sent (`other_1`) = `001` [allocated/read-only]; DOK/# RCVD (`other_2`) = `A01`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Entrant-dependent DOK group or DXCC country per band. First-contact fixture: points=3, multipliers=1, total=3; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_central_european_plugins_host.CentralEuropeanPluginTests.test_scoring_same_second_replay_exports_and_rtty_contract`. Append: PASS — 1 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### ari_40_80

**ARI 40 80** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW, SSB. Bands: 80m, 40m. Sent exchange hint: Automobile Code. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=RM`. Entry examples: Call (`callsign`) = `I1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Automobile Code (`other_2`) = `TO`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Received automobile/province exchange identity per band/mode. First-contact fixture: points=3, multipliers=1, total=3; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_european_hf_plugins_host.EuropeanHFPluginTests.test_commit_score_correction_restart_export_and_historical_sent_exchange`. Append: PASS — 1 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### ea_rtty

**EA RTTY** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: RTTY, RTTY-R, LSB-D, USB-D, AM-D, FM-D, DIGI-U, DIGI-L, RTTYR, PKTLSB, PKTUSB. Bands: 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Province or #. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=RTTY, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#`. Entry examples: Call (`callsign`) = `EA1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; Prov or SN (`other_2`) = `M`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: DXCC/province identities per band, selected K/VE/VK/JA call areas and EA4URE special-band credit. First-contact fixture: points=3, multipliers=2, total=6; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_european_hf_plugins_host.EuropeanHFPluginTests.test_commit_score_correction_restart_export_and_historical_sent_exchange`. Append: PASS — 14 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### ok1wc

**OK1WC Memorial Contest (MWC)** — contest; family `serial-dx-or-regional`. Core **PASS**.

Modes: CW. Bands: 80m, 40m. Sent exchange hint: Serial number. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#`. Entry examples: Call (`callsign`) = `DL1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; RcvNR (`other_2`) = `001`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Worked callsign last letter per band. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_european_hf_plugins_host.EuropeanHFPluginTests.test_commit_score_correction_restart_export_and_historical_sent_exchange`. Append: PASS — 2 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### ssa_mt_cw

**SSA MT CW** — contest; family `grid-distance-or-square-bonus`. Core **PASS**.

Modes: CW. Bands: 80m, 40m. Sent exchange hint: Serial + locator. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=JP75XX`. Entry examples: Call (`callsign`) = `SM1ABC`; Sent (`sent`) = `599`; Received (`receive`) = `599`; Nr (`other_1`) = `001`; Locator (`other_2`) = `JP75AA`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: First four characters of received locator per band. First-contact fixture: points=2, multipliers=1, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_european_hf_plugins_host.EuropeanHFPluginTests.test_commit_score_correction_restart_export_and_historical_sent_exchange`. Append: PASS — 5 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### ssa_mt_ssb

**SSA MT SSB** — contest; family `grid-distance-or-square-bonus`. Core **PASS**.

Modes: SSB. Bands: 80m, 40m. Sent exchange hint: Serial + locator. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=SSB, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=JP75XX`. Entry examples: Call (`callsign`) = `SM1ABC`; Sent (`sent`) = `59`; Received (`receive`) = `59`; Nr (`other_1`) = `001`; Locator (`other_2`) = `JP75AA`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: First four characters of received locator per band. First-contact fixture: points=2, multipliers=1, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_european_hf_plugins_host.EuropeanHFPluginTests.test_commit_score_correction_restart_export_and_historical_sent_exchange`. Append: PASS — 5 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### dxpedition

**DX-Pedition** — utility; family `utility-logging`. Core **PASS**.

Modes: CW, SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Sent Exchange. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=NIT`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`.

Duplicate scope: Duplicate checking disabled. (plugin type 4). Multiplier/bonus scope: Utility definition; no sponsor contest multiplier requirement. First-contact fixture: points=0, multipliers=0, total=0; exact callbacks are linked in JSON. Exports: adif.

Fixture: `test_type4_utility_plugins_host.Type4UtilityPluginTests.test_dxpedition_prev_call_persists_between_native_esm_requests`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: NOT APPLICABLE — Utility has no required contest multiplier view. Sponsor edition: NOT APPLICABLE — Utility definition; no sponsor submission certification required.

### general_logging

**General Logging** — utility; family `utility-logging`. Core **PASS**.

Modes: CW, SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Sent Exchange. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=NIT`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Name (`other_1`) = `Alice`; Comment (`other_2`) = `portable`.

Duplicate scope: Duplicate checking disabled. (plugin type 4). Multiplier/bonus scope: Utility definition; no sponsor contest multiplier requirement. First-contact fixture: points=0, multipliers=0, total=0; exact callbacks are linked in JSON. Exports: adif.

Fixture: `test_type4_utility_plugins_host.Type4UtilityPluginTests.test_exports_and_esm_function_keys`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: NOT APPLICABLE — Utility has no required contest multiplier view. Sponsor edition: NOT APPLICABLE — Utility definition; no sponsor submission certification required.

### randomgram

**RandomGram** — utility; family `utility-logging`. Core **PASS**.

Modes: CW. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Sent Exchange. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=NIT`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentRG (`other_1`) = `ABC`; RcvRG (`other_2`) = `XYZ`.

Duplicate scope: Duplicate checking disabled. (plugin type 4). Multiplier/bonus scope: Utility definition; no sponsor contest multiplier requirement. First-contact fixture: points=2, multipliers=0, total=0; exact callbacks are linked in JSON. Exports: adif.

Fixture: `test_type4_utility_plugins_host.Type4UtilityPluginTests.test_exports_and_esm_function_keys`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: NOT APPLICABLE — Utility has no required contest multiplier view. Sponsor edition: NOT APPLICABLE — Utility definition; no sponsor submission certification required.

### qso_party_rst

**QSO PARTY RST** — generic-template; family `county-qso-party`. Core **PASS**.

Modes: CW, SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m, 6m, 2m, 70cm. Sent exchange hint: County. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=NIT`. Entry examples: Call (`callsign`) = `K1ABC`; Sent RST (`sent`) = `599`; Rcv RST (`receive`) = `579`; County/State/DX (`other_1`) = `NEW`.

Duplicate scope: Duplicate checking disabled. (plugin type 4). Multiplier/bonus scope: Generic-template received county identity once across the contest; actual party rules need separate selection/review. First-contact fixture: points=2, multipliers=1, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_type4_utility_plugins_host.Type4UtilityPluginTests.test_correction_preserves_historical_rover_location_and_cabrillo`. Append: PASS — 8 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: NOT APPLICABLE — Generic QSO-party template; choose and verify the actual sponsor's rules independently.

### qso_party_sn

**QSO PARTY SN** — generic-template; family `county-qso-party`. Core **PASS**.

Modes: CW, SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m, 6m, 2m, 70cm. Sent exchange hint: County. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=NIT`. Entry examples: Call (`callsign`) = `K1ABC`; SentNR (`sent`) = `001` [allocated/read-only]; RcvNR (`receive`) = `42`; County/State/DX (`other_1`) = `NEW`.

Duplicate scope: Duplicate checking disabled. (plugin type 4). Multiplier/bonus scope: Generic-template received county identity once across the contest; actual party rules need separate selection/review. First-contact fixture: points=2, multipliers=1, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_type4_utility_plugins_host.Type4UtilityPluginTests.test_draft_commit_edit_delete_restart_replay_and_historical_sent_fields`. Append: PASS — 10 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: NOT APPLICABLE — Generic QSO-party template; choose and verify the actual sponsor's rules independently.

### ca_qso_party

**California QSO Party** — contest; family `county-qso-party`. Core **PASS**.

Modes: CW, SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: # + state/province or CA county. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=MIXED, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=# ORAN/SBER`. Entry examples: Call (`callsign`) = `K1ABC`; SentNR (`sent`) = `001` [allocated/read-only]; RcvNR (`receive`) = `101`; State/County (`other_1`) = `ALAM`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Received county/state/province identity once across the contest; compound counties expand in the pinned export. First-contact fixture: points=3, multipliers=1, total=3; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_first_remaining_plugins_host.FirstRemainingPluginTests.test_cqp_same_second_multiplier_replay_is_stable`. Append: PASS — 3 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### canada_day

**CANADA DAY** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW, SSB. Bands: 2190m, 630m, 560m, 160m, 80m, 60m, 40m, 30m, 20m, 17m, 15m, 12m, 10m, 8m, 6m, 5m, 4m, 2m, 1.25m, 70cm, 33cm, 23cm, 13cm, 9cm, 6cm, 3cm, 1.25cm, 6mm, 4mm, 2.5mm, 2mm, 1mm, submm. Sent exchange hint: # + province/territory. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=MIXED, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=# NT`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001 NT` [allocated/read-only]; Prov/territory or SN (`other_2`) = `ON`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Received province/territory identity per band/mode. First-contact fixture: points=2, multipliers=1, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_first_remaining_plugins_host.FirstRemainingPluginTests.test_each_plugin_lifecycle_recalculate_restart_and_exports`. Append: PASS — 2 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### cqws

**CQ WORLD SCOUT** — contest; family `scout-classification-and-uf`. Core **UNVERIFIED**.

Modes: CW, SSB. Bands: 2190m, 630m, 560m, 160m, 80m, 60m, 40m, 30m, 20m, 17m, 15m, 12m, 10m, 8m, 6m, 5m, 4m, 2m, 1.25m, 70cm, 33cm, 23cm, 13cm, 9cm, 6cm, 3cm, 1.25cm, 6mm, 4mm, 2.5mm, 2mm, 1mm, submm. Sent exchange hint: Station type. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=MIXED, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=DX`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Station type (`other_2`) = `FD`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Country once across all bands plus explicitly established Brazilian UF per band; missing UF yields a visibly partial score. First-contact fixture: points=7, multipliers=1, total=7; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_first_remaining_plugins_host.FirstRemainingPluginTests.test_cqws_accepts_all_pinned_scoring_classes`. Append: PASS — 5 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Available official 2023 class/country/UF rules informed the overlay; 2026 edition is unknown. The explicit-UF one-point branch preserves legacy behavior without an established 2023 point-rule authority, so providing UF alone does not certify this branch.

### darc_schwaben

**DARC SCHWABEN** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW, SSB, FM. Bands: 80m, 40m, 2m, 70cm. Sent exchange hint: DOK/NM or # (+Locator for VHF). Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=MIXED, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=T01`. Entry examples: Call (`callsign`) = `DL1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; DOK/# Sent (`other_1`) = `T01`; DOK/# RCVD (`other_2`) = `T01 JN58`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: No displayed multiplier; DOK/location bonuses are included in the contest-specific score callback. First-contact fixture: points=5, multipliers=0, total=5; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_first_remaining_plugins_host.FirstRemainingPluginTests.test_darc_vhf_requires_locator_but_hf_does_not`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### winter_field_day

**Winter Field Day** — contest; family `field-day-class-or-serial`. Core **PASS**.

Modes: CW, SSB, RTTY, AM, FM. Bands: 2190m, 630m, 560m, 160m, 80m, 60m, 40m, 30m, 20m, 17m, 15m, 12m, 10m, 8m, 6m, 5m, 4m, 2m, 1.25m, 70cm, 33cm, 23cm, 13cm, 9cm, 6cm, 3cm, 1.25cm, 6mm, 4mm, 2.5mm, 2mm, 1mm, submm. Sent exchange hint: Class + section. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=MIXED, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=1O ORG`. Entry examples: Call (`callsign`) = `K1ABC`; Class (`other_1`) = `1O`; Section (`other_2`) = `EMA`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Unique band/mode operating combinations and configured power factors; separate sponsor bonus claims are not certified. First-contact fixture: points=2, multipliers=1, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_first_remaining_plugins_host.FirstRemainingPluginTests.test_each_plugin_lifecycle_recalculate_restart_and_exports`. Append: PASS — 2 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### agcw_qrp

**AGCW QRP** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW. Bands: 80m, 40m, 20m, 15m, 10m. Sent exchange hint: # power-class member-number. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=# QRP NM`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Sent (`other_1`) = `001` [allocated/read-only]; SN Pwr MbrNr (`other_2`) = `101 QRP 1234`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Numeric QRP member-number first occurrence per band; NM excluded. Pinned country-credit code is inactive. First-contact fixture: points=3, multipliers=1, total=3; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_second_remaining_plugins_host.SecondRemainingPluginTests.test_all_eight_lifecycle_score_history_exports_and_restart`. Append: PASS — 5 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### raem

**RAEM** — contest; family `coordinate-exchange`. Core **PASS**.

Modes: CW. Bands: 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Latitude/longitude. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=48N17O`. Entry examples: Call (`callsign`) = `K1ABC`; Sent S/N (`sent`) = `001` [allocated/read-only]; Rcv S/N (`other_1`) = `101`; Exchange (`other_2`) = `40N74W`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Station latitude factor (1 or 1.1) combined with contact coordinate/bonus points, not a worked-entity multiplier. First-contact fixture: points=115, multipliers=0, total=115; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_second_remaining_plugins_host.SecondRemainingPluginTests.test_all_eight_lifecycle_score_history_exports_and_restart`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### rda_contest

**RDA Contest** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW, SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: # or RDA code. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=MIXED, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#`. Entry examples: Call (`callsign`) = `UA3ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; Serial or RDA (`other_2`) = `MO01`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Russian district and eligible DXCC country once across the contest. First-contact fixture: points=10, multipliers=1, total=10; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_second_remaining_plugins_host.SecondRemainingPluginTests.test_all_eight_lifecycle_score_history_exports_and_restart`. Append: PASS — 5 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### rdxc

**RDXC** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW, SSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m. Sent exchange hint: Serial or oblast. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=MIXED, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; Serial or Oblast (`other_2`) = `101`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Russian oblast and eligible DXCC country per band. First-contact fixture: points=5, multipliers=1, total=5; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_second_remaining_plugins_host.SecondRemainingPluginTests.test_all_eight_lifecycle_score_history_exports_and_restart`. Append: PASS — 5 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### rsgb_iota

**RSGB-IOTA** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW, SSB. Bands: 80m, 40m, 20m, 15m, 10m. Sent exchange hint: # or # and IOTA reference. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=MIXED, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=# EU005`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Sent Nr (`other_1`) = `001 EU005` [allocated/read-only]; # and Dist (`other_2`) = `101 NA001`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Eligible IOTA reference per band/mode; new-session sponsor overlay excludes ineligible own-group multipliers. First-contact fixture: points=15, multipliers=1, total=15; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_second_remaining_plugins_host.SecondRemainingPluginTests.test_all_eight_lifecycle_score_history_exports_and_restart`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### stew_perry_topband

**Stew Perry Topband** — contest; family `grid-distance-or-square-bonus`. Core **PASS**.

Modes: CW. Bands: 160m. Sent exchange hint: 4-character grid square. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=JN88`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Grid (`other_1`) = `FN20`.

Duplicate scope: Worked in this contest. (plugin type 1). Multiplier/bonus scope: No multiplicative contest identity; points/distance/timed behavior is calculated by the contest callback. First-contact fixture: points=28, multipliers=0, total=28; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_second_remaining_plugins_host.SecondRemainingPluginTests.test_all_eight_lifecycle_score_history_exports_and_restart`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### ukeidx

**UKEI-DX** — contest; family `regional-serial-or-location`. Core **PASS**.

Modes: CW, SSB. Bands: 80m, 40m, 20m, 15m, 10m. Sent exchange hint: # or # and district. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ModeCategory=MIXED, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=# DX`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Sent Nr (`other_1`) = `001 DX` [allocated/read-only]; # and Dist (`other_2`) = `101 AB`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Non-UK/EI DXCC country and received district suffix identities once across the contest. First-contact fixture: points=4, multipliers=2, total=8; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_second_remaining_plugins_host.SecondRemainingPluginTests.test_all_eight_lifecycle_score_history_exports_and_restart`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### wia_remembrance

**WIA REMEMBRANCE** — contest; family `timed-or-location-repeat`. Core **PASS**.

Modes: CW, SSB, FM, RTTY, RTTY-R, LSB-D, USB-D, AM-D, FM-D, DIGI-U, DIGI-L, RTTYR, PKTLSB, PKTUSB. Bands: 160m, 80m, 40m, 20m, 15m, 10m, 6m, 2m, 1.25m, 70cm, 33cm, 23cm, 13cm, 9cm, 6cm, 3cm, 1.25cm, 6mm, 4mm, 2.5mm, 2mm, 1mm, submm. Sent exchange hint: Years licensed. Serial: conditional; entrant/configuration determines allocation.

Fixture station: `Call=OM0RX, GridSquare=JN88`. Setup/category: `BandCategory=ALL, ContestUTCOffsetMinutes=570, ModeCategory=MIXED, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; Years Licenced (`other_2`) = `10`.

Duplicate scope: Worked on this band and mode within the preceding three hours. (plugin type 5). Multiplier/bonus scope: No multiplicative contest identity; points/distance/timed behavior is calculated by the contest callback. First-contact fixture: points=2, multipliers=0, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_second_remaining_plugins_host.SecondRemainingPluginTests.test_all_eight_lifecycle_score_history_exports_and_restart`. Append: NOT APPLICABLE — Not admitted to the generic chronological-append fast path; existing scoring owner retained..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

Operator setup: enter the literal number of years licensed as the sent exchange (for example `25` for an operator licensed for 25 years). The `#` appearing in this synthetic fixture is legacy compatibility evidence only; do not use it as the operating exchange. The additional literal-25 host lifecycle (`test_wia_literal_years_never_allocate_or_renumber_a_sent_serial`) and current React desk case verify that normal setup without reserving or renumbering a serial; see the acceptance record for their runs.

### cq_ww_vhf

**CQ WW VHF** — contest; family `received-grid-by-band`. Core **PASS**.

Modes: CW, SSB, FM, RTTY, RTTY-R, LSB-D, USB-D, AM-D, FM-D, DIGI-U, DIGI-L, RTTYR, PKTLSB, PKTUSB. Bands: 6m, 2m. Sent exchange hint: 4-character grid square. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=QG62, StartDate=2026-10-21 00:00:00`. Entry examples: Call (`callsign`) = `K1ABC`; Sent Grid (`other_1`) = `QG62`; Grid (`other_2`) = `FN31`.

Duplicate scope: Worked on this band from this sent grid square. (plugin type 5). Multiplier/bonus scope: Received grid identity per band; contest-specific point/power factors remain plugin-owned. First-contact fixture: points=2, multipliers=1, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_final_remaining_plugins_host.FinalRemainingPluginTests.test_cq_vhf_rover_grid_survives_setup_edit_replay_and_restart`. Append: PASS — 4 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### darc_vhf

**DARC VHF** — contest; family `grid-distance-or-square-bonus`. Core **PASS**.

Modes: CW, SSB, FM. Bands: 2m, 70cm, 23cm, 13cm, 9cm, 6cm, 3cm, 1.25cm, 6mm, 4mm, 2.5mm, 2mm, 1mm, submm. Sent exchange hint: # + 6char grid. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#, StartDate=2026-10-21 00:00:00`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; # Grid (`other_2`) = `101 JO60AA`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: No multiplicative contest identity; points/distance/timed behavior is calculated by the contest callback. First-contact fixture: points=443, multipliers=0, total=443; exact callbacks are linked in JSON. Exports: cabrillo, adif, edi.

Fixture: `test_final_remaining_plugins_host.FinalRemainingPluginTests.test_grid_exchanges_are_strict_and_normalized`. Append: PASS — 3 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### john_moyle_field_day

**John Moyle Field Day** — contest; family `timed-or-location-repeat`. Core **PASS**.

Modes: CW, SSB, FM, AM. Bands: 160m, 80m, 40m, 20m, 15m, 10m, 6m, 4m, 2m, 1.25m, 70cm, 33cm, 23cm, 13cm, 9cm, 6cm, 3cm, 1.25cm, 6mm, 4mm, 2.5mm, 2mm, 1mm. Sent exchange hint: #. Serial: allocated serial.

Fixture station: `Call=VK4ABC, GridSquare=QG62`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#, StartDate=2026-10-21 00:00:00`. Entry examples: Call (`callsign`) = `VK2AAB`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; RcvNR (`other_2`) = `101`.

Duplicate scope: Worked on this band and mode group in this three-hour UTC block. (plugin type 5). Multiplier/bonus scope: Eligible VK/P2/ZL WPX prefix per band, mode group and three-hour UTC block; full rebuild retained. First-contact fixture: points=2, multipliers=1, total=2; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_final_remaining_plugins_host.FinalRemainingPluginTests.test_jmmfd_timestamp_blocks_dupes_and_multiplier_tie_break`. Append: NOT APPLICABLE — John Moyle uses full rebuild because earlier multiplier assignments can differ..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### labre_rs_digi

**LABRE-RS Digi** — contest; family `received-grid-by-band`. Core **PASS**.

Modes: RTTY, RTTY-R, LSB-D, USB-D, AM-D, FM-D, DIGI-U, DIGI-L, RTTYR, PKTLSB, PKTUSB. Bands: 80m, 40m, 20m, 15m, 10m. Sent exchange hint: 4-character grid square. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=RTTY, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=JN88, StartDate=2026-10-21 00:00:00`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `jn88`; Grid (`other_2`) = `gg40`.

Duplicate scope: Worked on this band. (plugin type 2). Multiplier/bonus scope: Received grid identity per band; contest-specific point/power factors remain plugin-owned. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_final_remaining_plugins_host.FinalRemainingPluginTests.test_grid_exchanges_are_strict_and_normalized`. Append: PASS — 1 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### nac_vhf

**NAC VHF** — contest; family `grid-distance-or-square-bonus`. Core **PASS**.

Modes: CW, SSB. Bands: 6m, 4m, 2m, 1.25m, 70cm, 33cm, 23cm, 13cm, 9cm, 6cm, 3cm, 1.25cm, 6mm, 4mm, 2.5mm, 2mm, 1mm. Sent exchange hint: # + 6char grid. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#, StartDate=2026-10-21 00:00:00`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `599`; RCV (`receive`) = `599`; SentNR (`other_1`) = `001` [allocated/read-only]; # Grid (`other_2`) = `101 JO60AA`.

Duplicate scope: Worked in this contest. (plugin type 1). Multiplier/bonus scope: Distance points plus first large locator-square bonus; bonus credit assigned chronologically. First-contact fixture: points=943, multipliers=1, total=943; exact callbacks are linked in JSON. Exports: cabrillo, adif, edi.

Fixture: `test_final_remaining_plugins_host.FinalRemainingPluginTests.test_grid_exchanges_are_strict_and_normalized`. Append: PASS — 4 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### ta_vhf_uhf_contest

**TA VHF UHF** — contest; family `grid-distance-or-square-bonus`. Core **PASS**.

Modes: CW, SSB. Bands: 6m, 2m, 70cm. Sent exchange hint: # + 6char grid. Serial: allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=#, StartDate=2026-10-21 00:00:00`. Entry examples: Call (`callsign`) = `K1ABC`; SNT (`sent`) = `59` [allocated/read-only]; RCV (`receive`) = `59` [allocated/read-only]; SNTNR (`other_1`) = `001` [allocated/read-only]; RCV NR + GRID (`other_2`) = `101 JO60AA`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: No multiplicative contest identity; points/distance/timed behavior is calculated by the contest callback. First-contact fixture: points=886, multipliers=0, total=886; exact callbacks are linked in JSON. Exports: adif, edi.

Fixture: `test_final_remaining_plugins_host.FinalRemainingPluginTests.test_grid_exchanges_are_strict_and_normalized`. Append: PASS — 6 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

### vhf_sprint

**VHF SPRINT** — contest; family `received-grid-by-band`. Core **PASS**.

Modes: CW, SSB. Bands: 6m, 2m, 1.25m, 70cm, 33cm, 23cm, 13cm, 9cm, 6cm, 3cm, 1.25cm, 6mm, 4mm, 2.5mm, 2mm, 1mm, submm. Sent exchange hint: 4-character grid square. Serial: no allocated serial.

Fixture station: `Call=OM0RX, GridSquare=JN88XX`. Setup/category: `BandCategory=ALL, ModeCategory=CW, OperatorCategory=SINGLE-OP, OverlayCategory=N/A, PowerCategory=LOW, SentExchange=JN88, StartDate=2026-10-21 00:00:00`. Entry examples: Call (`callsign`) = `K1ABC`; Sent Grid (`other_1`) = `jn88`; Grid (`other_2`) = `jo60`.

Duplicate scope: Worked on this band and mode. (plugin type 3). Multiplier/bonus scope: Received grid identity per band; contest-specific point/power factors remain plugin-owned. First-contact fixture: points=1, multipliers=1, total=1; exact callbacks are linked in JSON. Exports: cabrillo, adif.

Fixture: `test_final_remaining_plugins_host.FinalRemainingPluginTests.test_grid_exchanges_are_strict_and_normalized`. Append: PASS — 2 fixture append comparisons; full score and per-contact fields..

Multiplier view: UNVERIFIED — No tested per-plugin detailed worked/needed view; plugin total remains authoritative. Sponsor edition: UNVERIFIED — Pinned integration and explicit fixture arithmetic do not certify the current organizer edition.

## Reproduce and refresh

Run only against synthetic disposable storage:

```sh
/opt/local/bin/python3.12 tools/check_all_contests_readiness.py --family-tests --output .build/all-contests-readiness.json
cd prototype && XLOG_CONTEST_PYTHON=/opt/local/bin/python3.12 npm exec vitest -- run src/contesting/AllContestsPythonDesk.test.tsx --reporter=json --outputFile=/tmp/xlog-all-contests-ui-final-accepted-results.json
# Run PythonCatalogueReadinessTests with the repository's native prototype test command.
# Run tools/check_contest_append_equivalence.py and save its bounded result log.
cd .. && /opt/local/bin/python3.12 tools/render_all_contests_readiness.py
```

The renderer requires exact registry/result set equality, preserves every feature outcome and records stale source hashes. It never turns missing evidence into PASS. Saved logs under `/tmp` and `.build` are local artifacts; their compact hashes and outcomes are committed in JSON. Re-run the source gate after all implementation owners converge, then refresh this report. Packaging/version/build provenance and any authorized installation belong to the final coordinated release acceptance record.
