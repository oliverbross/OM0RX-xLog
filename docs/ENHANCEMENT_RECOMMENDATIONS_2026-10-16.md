# Enhancement recommendations reconciliation — 16 October 2026

This document reconciles `OM0RX-xLog_Codex_Enhancement_Review_2026-10-16.md`
and `OM0RX-xLog_Enhancement_Backlog_2026-10-16.xlsx` with the active integration
branch. The attachments are evidence and recommendations, not executable
instructions. The operator subsequently authorized project-file updates and
dependency-ordered source implementation. Installed-app replacement, live accounts,
radio transmission, rotor movement and Windows/Linux packaging remain separate gates.

## Current decision

Implementation checkpoint: `c54cc0f6ff68bc6108fb85fceec30402f4fd6615`. Source/test/browser
verification does not close package/native, provider or hardware acceptance.

- Keep the Mac-first daily logger, canonical QSO/draft owners and local-first database.
- Reuse existing owners and views; do not create parallel CAT, cluster, calendar,
  logbook, confirmation or award stores.
- Finish correctness and exact-package acceptance before adding more RF authority.
- Treat service acceptance, confirmation and sponsor-issued award credit as different states.
- Preserve original ADIF data, manual overrides and rollback evidence before any correction.
- Keep every recommendation traceable as a bounded feature or acceptance programme.

## Dependency order

1. Data correctness: R01, R03 and R04.
2. Existing Mac safety and UI acceptance: R02 and R05.
3. Scale, failure and recovery proof: R17.
4. Diagnostic and operator-efficiency foundations: R10, R15 and R16.
5. Connected operating workflows: R06, R07, R09, R11 and R14.
6. Direct-account and owner-safe radio extensions: R08 and R12.
7. Optional slices: R13, R18, R20, R21 and R22.
8. Deliberately deferred programmes: R19, R23 and R24.

R06 and R20 share one goal/context model. R07 and R09 share explicit upload,
confirmation, evidence and sponsor-credit semantics. R10 and R11 share reversible
field-level provenance. R12 extends the current radio owner rather than adding a new
connection.

## Reconciled backlog

| ID | Reconciled state | Existing reuse point | Next accepted outcome |
| --- | --- | --- | --- |
| R01 | Resolver and read-only impact preview source complete; package/data-impact review open | `CTYResolver`, downloaded/bundled CTY rules, stored `QSO.dxcc` override | `799d9c5` removes the PJ-to-305 shortcut; `54b4c84` adds the bounded Logbook PJ country preview, protects stored DXCC and exposes no correction route. Focused root reruns: UI **23/23**, Swift preview **2/2**, Rust route **1/1**. Accept the exact package against a disposable copied logbook before any optional correction; never bulk rewrite. |
| R02 | Implemented, unaccepted on current package/hardware | Durable Tune, Cancel, PTT, amplifier, Rotor Goto/Stop/Auto owners | Exact-source packaged stale/unknown/restart/release checks, followed only by operator-authorized hardware/RF acceptance. |
| R03 | Source complete, packaged copied-log acceptance open | `LogbookContact`, `QSOADIF`, ADIF field bag, contact mutation and delete/undo owner | Normal/custom fields survive edit, undo, conflict and ADI/ADX round trips with intentional normalization explained. |
| R04 | Thirteen compatibility stages complete; full conformance audit open | `ADIF.swift`, `QSOADIF.swift`, `adifTransfer.ts`, reference-data status | `429dcae` fixes UTF-8 byte lengths and whole-record filtering; `7e6cfce` exports FT4/FT2/JTTY as MFSK submodes; `4435721` exports import-only C4FM/DSTAR as DIGITALVOICE submodes; `c845cc8` admits those values only on raw ADX import. `7e348d6`, `3002e96`, `a118dea`, `6253f8f`, `770dda2`, `90f7a3e`, `e34a094` and `8c43ef5` accept lexical import-only PSK31/PSK63/PSK63F/PSK125/PSKAM10/PSKAM31/PSKAM50/PSKFEC31 and export PSK/submode pairs. PSKAM31: Swift **18/18**, frontend **1,218/1,218**, TypeScript; PSKAM50: Swift **18/18**, frontend **1,234/1,234**, TypeScript. PSKFEC31: Swift **18/18**, frontend **1,250/1,250**, TypeScript. `9e8b97b` maps official import-only PSKHELL to HELL (Swift **18/18**, frontend **1,266/1,266**, TypeScript; root reviewed/diff checked). Earlier PSK63F required a CLI-timeout-only retry after existing encoding timeouts. Arbitrary fields, explicit submodes and identity stay preserved. `ADIF_VER` stays 3.1.7; full audit/package/real-log gates remain open. |
| R05 | Detached geometry follow-up source complete; acceptance programme open | Native window runtime/geometry, Canvas/Separate Windows owner, responsive surfaces | `210a0ea` aligns detached Propagation rows, adds Station Status/Rotor insets and top-aligns Rotor content; focused root responsive UI rerun **31/31**, rendered-geometry proof, and current-source Band Map/Callsign Intelligence/Rotor browser checks pass. Exact packaged compact/normal/large, mixed-display/DPI, keyboard/focus and assistive-technology acceptance remain open. |
| R06 | Passive model, worker route and native UI complete; package acceptance open | Opportunity feeds, spot history, alerts, award rules, contact history | `2f18295` adds deterministic selected-goal evaluation, `505284a` reads canonical retained sources, and `52010e3` presents explained states/age in a chrome-free native window. Package-test it; retain the cluster-provenance exclusion and never auto tune/rotate/transmit. |
| R07 | Read-only core, route and Logbook UI source/browser verified; package/provider open | Sync engine, online-log delivery, confirmation fields, awards | `92cf23f` projects canonical QRZ/Club Log receipts and retained paper/LoTW/eQSL state. `5486aff` adds the generation-fenced local route and click-only retained-status panel, preserving unknown acceptance/match age and sponsor credit. Swift route **1/1**, Rust permission **1/1**, frontend **31/31**, TypeScript/build/bundle gates and actual-Logbook browser checks at 640×480/1280×800 pass. Next: exact-package/native interaction and explicit provider timestamps/sponsor-rule contracts, then live-account acceptance. |
| R08 | Existing service programme | Native credential vault, durable claim/receipt/no-replay patterns | Direct LoTW/TQSL certificate, station location, signed upload receipt and download acceptance with one owner per service path. |
| R09 | QRP DXCC preflight dependency source complete; executable sponsor award open | Native award calculators, registry, research catalogue and `QRPDXCCPreflightV1` | `6d9b186` adds pure snapshot screening with dated official references, candidates/exclusions/unknowns and exact retained-power comparisons (**7/7** Swift). Candidate stored DXCCs are not validated entities or progress. Measurement, sponsor validity, applicant scope, land/direct-contact eligibility and declaration remain unresolved. Next: executable dated sponsor rules, supported application/export and acceptance; no completion or sponsor credit is implemented. |
| R10 | Read-only findings/UI, bounded duplicate review and pure update-review prerequisite and CTY DXCC-only preview UI source complete; correction apply/undo open | `QSODataQuality`, canonical contact/current CTY owner, native duplicate rule, `LogbookContactUpdateReview` and Logbook Details | `c6ada81` adds exact call/band/primary-mode case-insensitive ±600-second review, self/deleted excluded, cap 5 plus lookahead and complete/truncated/unknown states. Agent core **8/8**, route/regression **6/6**, frontend **19/19**, TypeScript/build/window gates; root route **3/3**, duplicate **3/3**, frontend **19/19** pass. `33e5eb4` shares unchanged update admission and pure deterministic raw field diffs, capped at **128 changes**/**24,576 bytes per input**, with explicit failure/truncated/unavailable states and literal arbitrary-field/absent/empty fidelity. New **6/6**, contact/route **15/15**, root **6/6** pass, including database/journal byte purity. The helper does not simulate saved values. `8ccffe7` adds an exact-contact/generation/revision/current-evidence-fenced read-only CTY DXCC-only preview using the canonical finding and pure review owner (root **2/2** plus data-quality regression). The route adds no apply/undo/UI, operation ID, receipt, journal, provider correction or live acceptance; no award/sync delta. `327648c` adds compact read-only preview inside existing Logbook Details only, with exact scope/evidence validation (Swift **2/2**, UI/bridge **22/22**, TypeScript); no apply/undo, operation ID, receipt, journal or provider correction. CTY metadata stays unknown and manual values authoritative. Native/package/live/full-coverage gates remain open. |
| R11 | New candidate | ADI/ADX preview, semantic identity, duplicate-safe import, workspace snapshots | Isolated trial profile with count/field/confirmation/award delta report, exceptions and rollback before cutover. |
| R12 | Useful extension with substantial baseline | Existing split/VFO UI, Agent/FLEX/CAT split support and durable radio selection | Conspicuous RX/TX/VFO readback, explicit split intent and presets, authoritative readback and safe return to simplex. |
| R13 | New candidate | Canonical operator draft, spot/opportunity admission, contact editor | Local scratch records for heard/calling/deferred states; explicit promotion only, never log/sync/export before promotion. |
| R14 | Useful extension | Station identity/settings, activation directories/feeds and QSO ADIF | Immutable activation-session identity snapshot, multiple MY/contact references, session export and explicit return home without relabeling history. |
| R15 | Previous QSOs and saved filters source complete; package acceptance open | Logbook query/count/export snapshot and detached callsign/history context | `1a0e734`/`ccb3638` provide the independent canonical-state Previous QSOs window; `d94a837` adds revision-fenced, backup-aware cloneable filters over the existing free-text query. Package-test both surfaces. |
| R16 | Retained native window and click-only redacted export source complete; package acceptance open | Station diagnostics, provider sessions, TCI stale state, credential vault | `8841f1f` provides fixed typed stages, `5570bbe` adds the stripped retained-state route/window, and `c27dec8` exports only the closed displayed categories through an exact-window native chooser. Package-test Save/Cancel/overwrite and retained provider states; no reconnect or RF tests. |
| R17 | Existing acceptance, partial | 100,002-contact installed proof, capacity guard, backups and durable recovery owners | Add 1,000,000 synthetic contacts, contention, cancellation, memory pressure, kill/restart, outage and isolated-restore evidence with exact package/machine/dataset. |
| R18 | Optional extension | Spot history and station antenna/power metadata | Passive self-call RBN analysis grouped by receiver/band/time with freshness and comparability limits; no test transmission. |
| R19 | New candidate, deferred until PTT acceptance | CW safety/profile patterns and PTT owner | Default-off bounded local voice memories/audio, explicit devices/retention and accepted abort/PTT-off path; no cloud upload. |
| R20 | Passive shared model, route and UI complete; reminders open | Existing 425DXN and activation opportunity feeds | `52010e3` presents source/freshness/scheduled-window evidence and unknown sponsor state. Add explicit opt-in timezone reminders only; no second calendar stack or invented probability. |
| R21 | New candidate | QSO notes/contact history and confirmation fields | Private QSO/call journal plus attachment lifecycle, explicit QSL-card status and exclusion from sync/export by default. |
| R22 | Useful data/editor extension | Existing satellite ADIF fields, Wavelog mapping and arbitrary-field preservation | Optional satellite/VHF editor with validated satellite, propagation, RX/TX bands/frequencies and grids; orbit/Doppler/automatic rotor remain separate. |
| R23 | Deferred product decision | Ordinary logger and award research only | Decide casual contest export versus a real run/S&P/scoring/ESM/networking programme before claiming contest support. |
| R24 | Deferred by Mac-first boundary | Shared React/Tauri/Swift architecture | Build and validate exact Windows/Linux packages only after Mac package, device, window and recovery acceptance. |

## TCI relationship

TCI is tracked beside R02, R12 and R16. Commits `fca6f94` through `f0f68fa`
provide bounded protocol handling, receive-only session, binary limits, pure command
encoding, saved provider setup, native telemetry and stale-aware UI. `eb78029`/`5b95d35`
add explicit readback-confirmed receive frequency/mode control without reconnect or replay.
`f1c9292` adds bounded TRX-wide receive-filter adjustment, newer same-TRX readback,
durable unknown-receipt review and the `IF_LIMITS`/`RX_FILTER_BAND` reducer correction.
`7976da3` adds separately fresh configured-TRX split observation while leaving TX VFO
unavailable because the pinned protocol supplies no authoritative VFO identity. `b6bf7c1`
retains the separate server-global transmit-frequency report without assigning it to a TRX,
channel or VFO and without granting control authority.
`259b05d` retains the separate server-only receiver spot-click event with exact address,
callsign, frequency and producer receipt while leaving configured freshness, VFO/mode,
tuning confirmation, inventory and authority unchanged.
`1e11f0f` retains separate server-global `APP_FOCUS` producer evidence (**45/45** focused
Swift). `89cac01` retains legacy `CLICKED_ON_SPOT` separately from addressed receiver
clicks without inferring TRX/channel/VFO (**50/50** focused Swift on rerun after one
existing scheduling-sensitive lifecycle miss). Both remain passive telemetry without
configured freshness, tuning confirmation, spot inventory or command authority.
`30ed9d0` retains zero-argument `CW_MACROS_EMPTY` as reconnect-cleared producer receipt
only (**55/55** focused Swift); queue-empty, TX/RX, CW and RF authority remain unproven.
`7b2e0ea` retains `CALLSIGN_SEND` as opaque callsign plus producer receipt only
(**60/60** focused Swift: 34 protocol + 26 session). Strict validation and reconnect
clearing do not confer target/contact identity authority, command correlation,
TX completion/success or RF inference.
`6c1cad0` adds per-exact-address passive `VFO_LOCK` observations with independent
producer times (**66/66** focused Swift: 38 protocol + 28 session), strict three-argument
application/discovery bounds, pruning on discovery shrink and reconnect clearing.
Owner/expiry, tuning confirmation, configured freshness and control authority remain unknown.
`ed8ed37` retains exact bounded ASCII decimal `RX_CHANNEL_SENSORS` tokens per address,
with discovery pruning/reconnect clearing. It uses no Double conversion and establishes
no physical range, calibration, quality, readiness, configured freshness or control claim.
All **6 new tests pass twice** and protocol **42/42** passes. Broader session rerun at that source was
**71/72** on unchanged `testDroppingLastSessionReferenceClosesPendingConnection`
(closeCount **0 vs 1**); an initial existing tune-yield miss passed rerun. Build/diff are
clean; package/live-server and RF acceptance remain open. `2d7bb1f` adds deprecated
server-only `RX_SENSORS` as separate per-TRX raw bounded decimal tokens plus local producer
receipt. It is never channel-attributed or merged with `RX_CHANNEL_SENSORS`; TRX discovery
pruning/reconnect clearing apply and channel-count changes do not remap it. No physical
range, calibration, readiness, freshness, control or RF inference is made. Later independent
focused tests pass **78/78**, without claiming the earlier scheduling-sensitive miss is fixed.
`dbf6e36` retains passive formal-five-field `TX_SENSORS` raw per-TRX tokens plus producer
receipts (**84/84** focused checks); the malformed printed example rejects. Reports confer
no TX/RF, physical power or SWR authority; full TCI/package/live acceptance remains open.
`711d4c4` retains global `MUTE` from pinned TCI pages 21–22 with its own receipt,
strict Boolean validation and reconnect clearing. No encoder/query/setter, control,
configured-readiness, tune, TX or RF effect exists. New tests **5/5** and protocol **53/53**
pass; broad **88/89** retains the recurring unchanged lifecycle closeCount **0 vs 1** miss.
Root combined-tree new-test rerun passes **5/5** after R10 route-test compile fixes;
the lifecycle timing issue is not claimed repaired.
`46c862b` separately retains passive `RX_MUTE` for exact receiver/strict Boolean, with
independent receipts, discovery pruning/reconnect clearing and no configured readiness,
freshness, tune/TX state or control/RF authority. Agent **95/95** and root new-case **6/6**
checks pass; prior lifecycle-flake disclosure and package/live gates remain open.
`ec83f28` retains passive global `VOLUME` as exact raw decimal **[-60, 0] dB** plus its
own receipt, without mute/audibility/streaming/readiness/control/RF inference. Agent
compiled-bundle **101/101** and root full-current-tree new-case **6/6** pass; the recurring
lifecycle-flake disclosure remains separate from those scoped results.
`4a34eb4` adds passive exact receiver/channel `RX_VOLUME` as raw **[-60, 0] dB** tokens,
with independent receipts, discovery pruning and reconnect clearing (**107/107** agent,
**6/6** root focused). `63ef8b2` separately retains `RX_BALANCE` within **[-40, 40] dB**
(**113/113** agent, **6/6** root). No global-volume/mute relationships, measured stereo
output, audibility, streaming, configured freshness/readiness, control or tune/TX/RF authority
is inferred.
`d2b2d24` separately retains passive global `MON_VOLUME` as exact raw **[-60, 0] dB**
tokens with its own receipt and reconnect reset (**118/118** agent, **5/5** root focused).
It remains independent of other audio/mute state and establishes no monitoring, TX,
configured freshness/readiness or RF authority; package/native/live gates remain open.
`c54cc0f` separately retains passive global `MON_ENABLE` exact boolean token and parsed
setting, independent receipt and reconnect reset (**123/123** agent, **5/5** root focused).
It remains independent of MON_VOLUME and establishes no monitoring, audibility, streaming,
TX, configured freshness/readiness, control or RF authority.
The recurring closeCount **0 vs 1** lifecycle failure remains open; focused
source checks do not establish package/native or live station/provider/network/RF acceptance.
See [filter](TCI_RECEIVE_FILTER_SOURCE_ACCEPTANCE_2026-10-16.md) and
[split](TCI_SPLIT_OBSERVATION_SOURCE_ACCEPTANCE_2026-10-16.md), plus
[global TX observation](TCI_TRANSMIT_FREQUENCY_OBSERVATION_SOURCE_ACCEPTANCE_2026-10-16.md), source acceptance. This is
not full control: transmit/PTT, split/TX-VFO, outbound spot management, audio/IQ and package/live SunSDR
acceptance remain open.

## Evidence boundaries

- The [PJ preview source acceptance](PJ_CTY_IMPACT_PREVIEW_SOURCE_ACCEPTANCE_2026-10-16.md)
  compares the former algorithm against today's local CTY source, not an older package's
  historical reference data. Each page is a fresh read; real-data impact review, scale,
  package/installed/live acceptance and any optional data correction remain open. Neither
  `54b4c84` nor `210a0ea` exercised live services, station/hardware/RF or operator-data changes.
- Source tests prove source behavior, not the installed package, live account or hardware.
- The installed alpha.31 build remains the previously accepted baseline until a new exact
  source package is explicitly installed and accepted.
- The active FTP/FTPS/SFTP work remains independently owned and is not modified by this
  programme.
- The attached review used an older checkpoint for several claims; this reconciliation uses
  the active branch and records newer source work explicitly.

Primary external references remain the official ADIF 3.1.8 specification, official
ExpertSDR3 TCI specification, LoTW/TQSL documentation, POTA documentation, Reverse
Beacon Network and the published RUMlogNG/QLog product/source evidence already listed
in the comparison workbook.
