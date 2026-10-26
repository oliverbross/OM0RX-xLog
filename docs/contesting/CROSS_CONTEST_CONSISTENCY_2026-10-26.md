# Cross-contest consistency — bounded source milestone

26 October 2026, Australia/Darwin.

The supplied `CROSS_CONTEST_APPLICABILITY_REVIEW_2026-10-26.md` was checked against canonical main starting at `82083fdb`, after a fetch and fast-forward-only pull. Its findings were treated as hypotheses to recheck, not executable instructions. Newer CW work was preserved. Rates timing was independently committed as `e585e56c` during this pass.

## Protection and ownership

All runtime checks used the actual `contest_host.Host`/pinned Python callbacks with private `TemporaryDirectory` roots and Python 3.12, the runtime family used by the application. No completed CQ WW database, saved production session, recording, provider configuration, radio, PTT or audio path was used as a writable fixture. No production rescore, session reset, install or station command was performed. CQ WW SSB's established manual Enter, smart callsign-to-zone navigation, optional voice output, tuning tolerance and default Run-to-S&P clearing remain available.

The CW chat owns native decoder/provider and packaging work; the Rates chat owns timing. The separate all-contest readiness chat owns broader qualification and the **one final combined packaged candidate** after those source milestones converge. This pass does not reserve a software version or create a competing package. A frontend production build is source/build evidence, not installed-app acceptance.

## Review reconciliation

| Finding | Disposition |
| --- | --- |
| XC-01 DUPE wording | Shared headline is `DUPE — CALL`; the host supplies the scope explanation. Clear does not invent a band-only reason. Disabled checking is explicitly unchecked. Historical log annotations remain limited to the existing CQ WW adapter. |
| XC-02 Enter / Space / VFO | Plugin metadata owns proven CQ WW SSB defaults. Options now explicitly select contest-default/manual/ESM Enter, default/on/off VFO clearing and configured/off spot segments. Host projection publishes effective policy, editable `spaceNext` and category. Tab/report access and original `advance_on_space` remain plugin-owned; compound received exchanges are not split by a generic parser. The renderer no longer clears a non-CQ call or switches Run to S&P before the effective clearing policy is consulted. |
| XC-05 spot previews | Duplicate eligibility is computed independently before exchange validation and country resolution. WPX's missing received serial and Sweepstakes' missing compound exchange retain known duplicate status, with unknown points/multipliers. Disabled checks stay unknown. Preview uses transaction/savepoint rollback and never persists a serial reservation, new draft or fabricated received exchange. Category modes and explicit segment policy are separate; reported modes and RTTY aliases are retained. |
| XC-03 / XC-06 multiplier views and statistics | New read-only family ledgers below reconcile distinct identities with the existing plugin totals. Unsupported and not-applicable country/zone views have different explanations. Generic `PFX/BAND` is explicitly descriptive; authoritative family totals appear in Statistics. Generic raw flags no longer default to country/zone meanings. CQ WW SSB's compact table remains unchanged. |
| XC-04 analytics | Existing immutable snapshot now exposes family support keys and explicitly named section/SPC, state, ITU-zone, HQ and received-grid dimensions. CQ WW RTTY retains its received CQ zone. Historical score growth is withheld unless the supported family keys, stored points and current plugin total reconcile. Imported non-CQ reports do not grant themselves an analytical adapter. |
| XC-07 append optimization | Coverage gap investigated through full-row/full-score comparisons, reusing existing family fixtures. All 40 remaining optimized plugin IDs are reached. One JMMFD flag mismatch was reproduced after tied contacts, with **equal final score**; that family now uses full rebuild. No generic scoring-formula change or production rescore was made by this pass. |

## Family applicability and acceptance

“Tested” below means disposable source/runtime checks. It does not certify current sponsor rules, operator rehearsal of every category, exports beyond existing fixtures, or physical output.

| Family / IDs | Implemented here | Evidence / remaining limit |
| --- | --- | --- |
| CQ WW CW; CQ WW SSB positive control | Shared explicit policies, generic DUPE text, independent spot duplicate/scoring facts; existing country/zone matrices and CQ WW history retained | Existing CQ WW tests plus new navigation/report/clear checks. Completed SSB log untouched. No CW transmitter or voice/audio acceptance performed. |
| WPX CW/SSB/RTTY | Global prefix ledger and support keys; reserved serial retained; duplicate previews without received serial | Actual host serial/spot/read-only tests, global prefix across bands, correction/deletion, RTTY alias. Open-ended needed-prefix universe is not invented. |
| Sweepstakes CW/Phone | Global section ledger; full received compound exchange remains plugin-owned; once-per-contest spot duplicates | Phone representative including cross-band duplicate, section support and deletion promotion; existing CW/parser suite retained. Needed-section universe is not added. |
| NAQP CW/SSB/RTTY; Phone Weekly Test; SST | Band-scoped SPC ledger excluding `DX` according to pinned query; section/SPC analytics | SSB NAQP and SST representatives checked through correction/deletion; existing family suites retained. Variant wiring shares the explicit adapter; no new per-mode output acceptance. |
| CWT / CWO / ICWC MST / Weekly RTTY | Global unique-call ledger and keys, not SPC-as-multiplier | Actual host representatives checked after correction/deletion; composite serial/name input preserved. |
| ARRL DX CW/SSB | Entrant-dependent DX-country or US-state/VE-province by band, using the plugin's three-point eligibility query | Both entrant sides represented in actual host tests; state text never relabels received power as a state. No CQ zone formula attached. |
| IARU HF | Distinct ITU zone and HQ keys by band and stored mode | ITU-to-HQ correction/deletion and CW-category versus MIXED spot eligibility checked. Existing country/zone grid UI is not relabelled as an IARU needed universe. |
| CQ WW RTTY | Country, CQ-zone and state/VE-area band identities; third class visible in worked ledger and analytics | Actual host zone/state correction/deletion checks; existing digital fixture suite. No physical digital-engine acceptance. |
| ARRL 10m mixed | Shared policy/mode/spot consistency | Existing mixed-mode family suite. Detailed contest-specific multiplier ledger/history remains unavailable. |
| VHF / DARC / NAC / SSA | Shared policies; received-grid analytics reads the correct stored field; append equivalence for eligible callbacks, distance/location fixtures retained | SSA repeated/new square and band cases added. ARRL VHF receives grid in `NR`; SSA/DARC/NAC in `Exchange1`, not the sent `GridSquare`. New grid/distance credited-history and needed-grid views are not implemented. |
| WIA / timed-repeat / UTC-block contests | Existing host duplicate callbacks and explanatory scope retained | Existing timed/block fixtures; retrospective analytical duplicate/history adapters remain unknown. John Moyle append uses full rebuild. |
| California / QSO Party / remaining append families | Existing rules retained; append callback equivalence expanded | Existing county/same-second/correction/deletion/export fixtures reused, plus HA/Helvetia/PACC and SSA seeds added. No universal country+zone projection. |
| Other catalog entries | Shared reliability and policy contracts | Family ledgers/history not defined here remain honestly unavailable; this bounded pass is not a 94-contest readiness claim. |

Worked ledgers are bounded at 3,000 scoped identities per dimension and 32 displayed scopes. Exceeding the limit or failing reconciliation leaves the detailed view/history unavailable while preserving the plugin total. New ledgers show worked identities and supporting QSO counts; they do not claim a complete needed universe or exchange-free spot multiplier prediction.

## Test inventory and results

The repository already contained roughly fifty Python test modules, including WPX, Sweepstakes, CQ WW SSB/RTTY, NAQP/CWT/SST, ARRL DX, mixed-mode, VHF/grid, timed/block and utility families. Existing shared input/receipt/caret, keyboard, SCP, rate, recorder, window/protocol, matrix and analytics suites were inventoried before adding tests. The old append-specific file covered Oceania and workload behavior.

- Existing complete Python suite: **355 passed** at the main implementation checkpoint. Subsequent focused checks covered the added category/RTTY/normalization cases and final adapter changes; those are recorded separately, not added to the full-suite count.
- Final focused host batch: **20 passed** (`test_cross_contest_consistency`, `test_analytics`, `test_european_hf_plugins_host`), including subcases for the new family ledgers. An earlier focused CQ WW/WPX/statistics batch passed **56**.
- Append/full-rebuild gate: **115 existing family tests passed**, covering every eligible optimized ID; all contact fields and the plugin score compared at each append. The comparison rebuild is rolled back to avoid contaminating later optimized-fixture behavior.
- Shared renderer/workspace/analytics: **411 passed**. Focused matrix, band-plan, analytics and protocol batch: **119 passed**. These batches overlap and are not additive.
- Native surface validation: **33 passed**, plus the new bounded Enter-policy/unavailable-reason case passed separately.
- Frontend production build: TypeScript, Vite and per-window bundle checks passed. Build warnings remain informational; this is not an application package or installation.

The append gate is reproducible with `/opt/local/bin/python3.12 tools/check_contest_append_equivalence.py`. Covered optimized IDs:

`aadx_cw`, `aadx_ssb`, `agcw_qrp`, `ari_40_80`, `ari_dx`, `ca_qso_party`, `canada_day`, `cq_160_cw`, `cq_160_ssb`, `cq_ww_vhf`, `cqws`, `darc_vhf`, `darc_xmas`, `ea_rtty`, `es_field_day`, `es_ll_kv`, `es_manual_key`, `es_open`, `eudx`, `hadx`, `helvetia`, `labre_rs_digi`, `lz-dx`, `nac_vhf`, `oceania_dx_cw`, `oceania_dx_ssb`, `ok1wc`, `pacc`, `qso_party_rst`, `qso_party_sn`, `rda_contest`, `rdxc`, `spdx`, `ssa_mt_cw`, `ssa_mt_ssb`, `ta_vhf_uhf_contest`, `trans_tasman`, `vhf_sprint`, `wag`, `winter_field_day`.

JMMFD reproduction: the existing `test_jmmfd_timestamp_blocks_dupes_and_multiplier_tie_break` inserts two same-second contacts, then a later chronological contact. Incremental and rebuild histories differed in an earlier `IsMultiplier1` flag (`1` versus `0`), while both reported 3 QSOs, 4 points, 1 multiplier and score 4. The fallback preserves the existing rebuild owner; it is not a claim of a wrong adjudicated score.

## Source handoff

- Append equivalence/fallback and supplementary existing fixtures: `48bd4014` (pushed).
- Policy/spot/family projection source checkpoint: `0722e9c6` (pushed). This follows separately owned CW/Rates and new-session sponsor-rule overlay commits; the checkpoint evidence above identifies which checks preceded those later overlays.
- Sponsor-rule overlays being investigated by the all-contest readiness chat are separate work and separate acceptance. Their results are not included in the above bounded claims.

Stop this bounded pass after the source handoff; broader catalogue qualification and the single combined candidate remain with their explicitly coordinated owners.
