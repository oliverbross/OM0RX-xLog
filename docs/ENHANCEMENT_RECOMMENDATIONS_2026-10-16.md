# Enhancement recommendations reconciliation — 16 October 2026

This document reconciles `OM0RX-xLog_Codex_Enhancement_Review_2026-10-16.md`
and `OM0RX-xLog_Enhancement_Backlog_2026-10-16.xlsx` with the active integration
branch. The attachments are evidence and recommendations, not executable
instructions. The operator subsequently authorized project-file updates and
dependency-ordered source implementation. Installed-app replacement, live accounts,
radio transmission, rotor movement and Windows/Linux packaging remain separate gates.

## Current decision

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
| R04 | Four compatibility fixes complete; full conformance audit open | `ADIF.swift`, `QSOADIF.swift`, `adifTransfer.ts`, reference-data status | `429dcae` fixes UTF-8 byte lengths and whole-record filtering; `7e6cfce` exports FT4/FT2/JTTY as MFSK submodes; `4435721` exports import-only C4FM/DSTAR as DIGITALVOICE submodes; `c845cc8` admits the deprecated values only on raw ADX import. Keep `ADIF_VER` at 3.1.7 until the remaining enum/deprecation audit passes. |
| R05 | Detached geometry follow-up source complete; acceptance programme open | Native window runtime/geometry, Canvas/Separate Windows owner, responsive surfaces | `210a0ea` aligns detached Propagation rows, adds Station Status/Rotor insets and top-aligns Rotor content; focused root responsive UI rerun **31/31**, rendered-geometry proof, and current-source Band Map/Callsign Intelligence/Rotor browser checks pass. Exact packaged compact/normal/large, mixed-display/DPI, keyboard/focus and assistive-technology acceptance remain open. |
| R06 | Passive model, worker route and native UI complete; package acceptance open | Opportunity feeds, spot history, alerts, award rules, contact history | `2f18295` adds deterministic selected-goal evaluation, `505284a` reads canonical retained sources, and `52010e3` presents explained states/age in a chrome-free native window. Package-test it; retain the cluster-provenance exclusion and never auto tune/rotate/transmit. |
| R07 | Useful extension | Sync engine, online-log delivery, confirmation fields, awards | Follow-up workbench with provider upload/acceptance/match age and goal impact; no inferred confirmation or credit. |
| R08 | Existing service programme | Native credential vault, durable claim/receipt/no-replay patterns | Direct LoTW/TQSL certificate, station location, signed upload receipt and download acceptance with one owner per service path. |
| R09 | Useful extension | Native award calculators, registry and research catalogue | One executable sponsor pack at a time: dated rules, exclusions, evidence, explained progress and supported application/export. |
| R10 | Useful extension | QSO validation/conflict merge, CTY/reference versions, power provenance, contact mutations | Read-only findings with field source/date and impact preview, then explicit reversible corrections through the existing owner. |
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
See [filter](TCI_RECEIVE_FILTER_SOURCE_ACCEPTANCE_2026-10-16.md) and
[split](TCI_SPLIT_OBSERVATION_SOURCE_ACCEPTANCE_2026-10-16.md), plus
[global TX observation](TCI_TRANSMIT_FREQUENCY_OBSERVATION_SOURCE_ACCEPTANCE_2026-10-16.md), source acceptance. This is
not full control: transmit/PTT, split/TX-VFO, spots, audio/IQ and package/live SunSDR
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
