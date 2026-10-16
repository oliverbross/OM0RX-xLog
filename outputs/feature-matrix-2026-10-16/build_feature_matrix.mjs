import fs from "node:fs/promises";
import os from "node:os";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

process.on("uncaughtException", (error) => {
  console.error(`BUILD_ERROR_NAME=${error?.name ?? "Error"}`);
  console.error(`BUILD_ERROR_MESSAGE=${error?.message ?? String(error)}`);
  console.error(`BUILD_ERROR_STACK=${error?.stack ?? "unavailable"}`);
  process.exit(1);
});

const outputDir = new URL(".", import.meta.url).pathname;
const outputPath = `${outputDir}OM0RX-xLog_Feature_Comparison_2026-10-16.xlsx`;
const previewMatrixPath = `${outputDir}feature-matrix-preview.png`;
const previewOutstandingPath = `${outputDir}outstanding-preview.png`;
const previewReviewPath = `${outputDir}enhancement-review-preview.png`;
const previewSourcesPath = `${outputDir}sources-preview.png`;
const writePreviews = !process.argv.includes("--no-preview");

const matrixRows = [
  ["Logbook — local/offline authority","Installed / accepted — local SQLite remains usable offline with local create, edit, delete and search.","Documented — unlimited local logs and QSOs on macOS.","Documented — local SQLite backend on Linux and Windows.","Documented — local SQLite logbook or optional per-profile shared MySQL; configuration remains local SQLite."],
  ["QSO entry — simple and full modes","Source complete — shared canonical draft supports compact Simple and responsive Full editors; packaged acceptance exists for the installed baseline, later radio-owner changes remain source-only.","Documented — normal logging plus a separate specialized contest logger.","Documented — general-purpose QSO logging; customizable interface.","Documented — single-strip entry and configurable panes. A matching Simple/Full editor contract was not established."],
  ["QSO editing — open, edit and delete","Source complete — pointer or keyboard row activation opens the revision-fenced canonical editor; modeled and arbitrary ADIF fields can be added, edited, cleared or deliberately preserved, while the existing safe delete/undo owner remains authoritative. Packaged interaction acceptance remains.","Documented — log editing, searches, queries and import/export workflows.","Documented — log management and custom QSO filters; arbitrary-field editor breadth was not established in the reviewed README.","Documented — QSO editing, generic ADIF extras and duplicate deletion choices. Matching revision/undo guarantees were not established."],
  ["QSO data quality findings","Source complete for read-only findings, exact-contact route, Details UI and bounded duplicate review. c6ada81 reuses native exact call/band/primary-mode case-insensitive +/-600-second matching, self/deleted excluded, cap 5 plus lookahead with complete/truncated/unknown states. No semantic/frequency/submode/portable-callsign inference or mutation. Existing validation, dated CTY comparisons and retained power provenance remain review evidence; CTY version/date unknown and stored/manual values authoritative. Agent core 8/8, route/regression 6/6, frontend 19/19, tsc/build/window gates; root route 3/3, duplicate 3/3, frontend 19/19 pass. Native/package/live/full-coverage/correction/provider gates stay open; no award/sync delta. Installed alpha.32 is exact source e270ab5; later findings work remains source-only. 33e5eb4 adds a pure bounded contact-update validation/raw field-diff prerequisite reused by canonical apply without changing receipts/revision/save semantics. Explicit invalid/stale/protected-identity failures; literal arbitrary fields preserve absent/empty distinction; cap 128 changes and 24,576 bytes/input with truncated/unavailable states. New 6/6 plus route/contact 15/15 and root focused 6/6 pass, including DB/WAL/SHM/journal purity. Not a saved-value simulation or correction-preview route/UI; correction UI/apply/undo remain open. 8ccffe7 adds read-only CTY DXCC-only correction preview, exact-contact/generation/revision/current-comparison-evidence fenced, using the canonical finding and pure review owner (root 2/2 plus data-quality regression). Unknown source/version/date facts stay unknown; stored/manual values are unchanged. No apply/undo/UI, operation ID, receipt, journal, provider correction or live acceptance. 327648c adds compact read-only CTY DXCC preview inside existing Logbook Details only, validating exact scope/evidence (Swift 2/2, UI/bridge 22/22, tsc). No apply/undo, operation ID, receipt, journal or provider correction; package/native/copied-log/live acceptance stays open.","Documented — QSO editing and DXCC/QSL workflows; comparable field-provenance findings were not established.","Documented — log management and service reconciliation; comparable field-provenance findings were not established.","Documented — dated CTY/ClubLog resolution, preservation of deleted DXCC entities and per-row RDA disagreement choices. Matching field-origin provenance was not established."],
  ["ADIF field preservation","Source complete for fourteen reviewed compatibility stages — local records retain a JSON field bag; unknown/custom fields, Unicode, station/contact and RX/TX data survive supported ADI/ADX round trips. UTF-8 byte scanning, FT4/FT2/JTTY MFSK-submode export, C4FM/DSTAR DIGITALVOICE-submode handling and import-only PSK31/PSK63/PSK63F/PSK125/PSKAM10/PSKAM31/PSKAM50/PSKFEC31 to PSK/submode normalization are fixed. PSKAM31 90f7a3e: Swift 18/18, frontend 1,218/1,218 and tsc. PSKAM50 e34a094: Swift 18/18, frontend 1,234/1,234 and tsc. PSKFEC31 8c43ef5: Swift 18/18, frontend 1,250/1,250 and tsc. PSKHELL 9e8b97b: official import-only to HELL; Swift 18/18, frontend 1,266/1,266, tsc; root reviewed/diff checked. QPSK31 8934ab6: official import-only to PSK/submode; agent Swift 18/18, frontend 1,282/1,282, tsc; root frontend 1,282/1,282, tsc/diff. Lexical import normalization exports canonical PSK/submode and preserves explicit submode authority. Remaining 3.1.8 audit and package/real-log acceptance stay open; ADIF_VER stays 3.1.7.","Documented — import/export plus four user-definable logging fields.","Documented — ADIF-oriented logbook and online-service interchange; unknown-field preservation was not established in the reviewed README.","Documented — ADIF 3.1.7 dictionary, promoted columns, generic extras and standard/all export modes. Round-trip fidelity is not independently verified."],
  ["ADIF import — duplicate/update review","Source complete — bounded ADI/ADX preview, invalid-record reporting, explicit insert/duplicate counts and revision-fenced field update choices.","Documented — ADIF import and exchange with other logging tools.","Documented — import and service reconciliation are present; exact duplicate/update review behavior was not established in the reviewed README.","Documented — skip/update/import-anyway choices, optional field mapping and duplicate tools."],
  ["ADIF export — all, filtered and selected","Source complete — freezes a consistent all/filtered/selected snapshot before paged ADI or ADX export.","Documented — quick/detailed queries and export routines.","Documented — log and service integrations imply interchange; exact selected/filtered export behavior was not established in the reviewed README.","Documented — filter builder and filtered/selected ADIF export, plus standard/all export modes."],
  ["Logbook table — selectable columns","Source complete — normal Logbook columns are available in dedicated, detached and map-split views; visibility and keyboard-accessible ordering persist independently per presentation context. Packaged visual acceptance remains open.","Documented / locally observed — configurable Logbook columns and table sizing.","Documented — customizable GUI and saved table state patterns.","Not established in reviewed v0.51.10 documentation as equivalent selectable Logbook columns."],
  ["Logbook table — adjustable column widths","Source complete — bounded pointer, keyboard and numeric width controls persist per presentation context; packaged follow-up acceptance remains open.","Documented / locally observed — adjustable table columns.","Documented — movable/visible columns are used in QLog tables; exact persistence varies by view.","Not established in reviewed v0.51.10 documentation as equivalent persisted Logbook column widths."],
  ["Previous QSOs — independent window","Source and synthetic visual stage complete — a native Window-menu surface follows the canonical Log QSO draft and existing local-history projection, closes on Canvas transition, and adds no contact owner. Focused frontend/Rust/build checks and 320/420/900-pixel visual checks pass; exact packaged native acceptance remains.","Documented — QSO search and entity/QSO search windows.","Not established in reviewed evidence as a dedicated independent window.","Documented — recent QSOs and worked-before band/mode matrix. Independent native-window behavior was not established."],
  ["Callsign and DXCC intelligence","Source complete — dedicated/detached panel with QRZ enrichment, date-aware CTY/DXCC classification, grids, zones, distance and worked/confirmed matrices. The incorrect all-PJ-to-305 shortcut is removed, stored DXCC overrides remain authoritative, and a bounded read-only Logbook preview explains inferred PJ changes without a correction route. Exact-package/copied-log acceptance remains open.","Documented — QRZ/HamQTH lookups, Club Log DXCC recognition and detailed DXCC status.","Documented — QRZ.com and HamQTH callbook integration plus club-member lookup.","Documented — QRZ/HamQTH lookup, offline CTY, call-area handling and dated ClubLog exceptions."],
  ["Operating goals and opportunity context","Passive source window complete — explicit callsign, entity/band/mode and IOTA/POTA/SOTA/WWFF targets are evaluated against station-scoped retained history and official opportunities. The native window keeps selection ephemeral and separates worked, confirmed, sponsor evidence and sponsor credit while showing source age/time basis. Cluster observations are explicitly excluded; package acceptance and opt-in reminders remain open.","Documented — DX-alarm, band-map and award-status workflows; the reviewed evidence did not establish the same shared goal model.","Documented — alerts, custom filters and award tracking; the reviewed evidence did not establish the same shared goal model.","Documented — award/reference detection and POTA-tagged spots. An equivalent shared goal/opportunity model was not established."],
  ["Connection Doctor and support preview","Passive native window plus click-only redacted export source complete — fixed provider/configuration/connection/freshness/capability stages consume only already-retained allowlisted state. The typed preview and exported JSON cannot represent secrets, endpoints, identifiers, raw errors, radio values, timestamps or log contents. The former late-CSS bundle gate is fixed; exact-package Save/Cancel/overwrite and retained-provider acceptance remain open.","Not established as a comparable product surface in reviewed primary evidence.","Not established as a comparable product surface in reviewed primary evidence.","Not established in reviewed v0.51.10 documentation as an equivalent redacted diagnostic/support surface."],
  ["Wavelog two-way reconciliation","Installed / live accepted — read-first reconciliation imported safe contacts and refreshed linked confirmations/enrichment without deleting or overwriting ambiguous records. 7adb008 adds an end-to-end synthetic Wavelog sync regression (focused 1/1): clean linked contacts receive fresh eQSL/LoTW/QRZ/message confirmation fields; local-only station/custom fields survive; no outbox/conflict; second sync idempotent. Fixture-only source evidence, not new live-provider/package acceptance.","Not documented as a native Wavelog workflow in reviewed primary evidence.","Documented — Cloudlog/Wavelog integration.","Documented — Cloudlog/Wavelog upload and confirmation download. Matching conflict-safe two-way reconciliation was not established."],
  ["Confirmation refresh from remote services","Installed / live accepted through Wavelog — LoTW, eQSL, QRZ and enrichment changes update matching local QSOs while ambiguous identities remain held for review. 7adb008 adds an end-to-end synthetic Wavelog sync regression (focused 1/1): clean linked contacts receive fresh eQSL/LoTW/QRZ/message confirmation fields; local-only station/custom fields survive; no outbox/conflict; second sync idempotent. Fixture-only source evidence, not new live-provider/package acceptance.","Documented — direct LoTW/eQSL workflows and Club Log real-time synchronization.","Documented — LoTW, eQSL, QRZ.com, Club Log, HRDLog.net and Cloudlog/Wavelog integrations.","Documented — ClubLog/LoTW/QRZ/eQSL/Cloudlog/Wavelog/HAMLOG confirmations refresh award statistics."],
  ["QRZ.com callbook lookup","Partial — Keychain-backed live lookup, operator-edit preservation and precise-grid targeting exist; cache/session/privacy controls remain.","Documented — QRZ.com and other online directory queries.","Documented — QRZ.com callbook integration.","Documented — QRZ.com lookup with photo and contact-field autofill."],
  ["QRZ.com log upload","Source complete — prospective default-off upload owner with vault credentials, exact claims, durable receipts and no ambiguous replay; live account acceptance open.","Documented via the separate real-time upload utility.","Documented — QRZ.com online-log integration.","Documented — QRZ.com upload and confirmation workflows; account/runtime acceptance not independently verified."],
  ["Club Log upload/sync","Source complete for prospective upload; installed Wavelog reconciliation also receives Club Log-related log state. Direct live account acceptance remains open.","Documented — real-time Club Log synchronization.","Documented — Club Log integration.","Documented — batched ADIF upload and confirmation download."],
  ["Online-log follow-up evidence","Source and browser verified — generation-fenced local route and Logbook row panel expose canonical QRZ/Club Log delivery state, receipt revision and attempt age, separately from retained paper/LoTW/eQSL confirmations. Opening performs no fetch; explicit Refresh reads local evidence, and Close/context changes retire pending reads. Swift route 1/1, Rust permission 1/1, frontend 31/31, TypeScript/build/bundle gates and 640x480/1280x800 actual-Logbook browser checks pass. Provider acceptance/match age and sponsor credit remain unknown; exact-package/native and live-account acceptance remain open.","Documented service status and confirmation workflows; exact evidence boundaries were not audited.","Documented online-log integrations; exact evidence boundaries were not audited.","Documented — confirmation download and award refresh. Equivalent provider acceptance/match ages and sponsor-credit semantics were not established."],
  ["HRDLog.net upload","Outstanding — deferred until the current official service contract is verified and implemented behind the same vault/receipt/no-replay boundary.","Documented via the separate real-time upload utility.","Documented — HRDLog.net integration.","Not established in reviewed v0.51.10 documentation."],
  ["Direct LoTW and eQSL workflows","Partial — dedicated bounded LoTW parser plus fixed-origin GET plan, strict response validation and frozen station/generation/revision-fenced match/change preview are source complete (25/25 combined Swift). Mode only disambiguates multiple date/time/band/call matches; minute-only times retain minute precision, unmatched records are not inserted and positive confirmations are never downgraded. No credentials, network request or database action occurred. Redirect-disabled streaming transport, confirmation-only no-outbox apply, TQSL upload and all eQSL owners remain outstanding.","Documented — direct upload/download, QSL statistics and paper-QSL workflows.","Documented — LoTW and eQSL integration; TQSL is optional for LoTW and eQSL can download QSL pictures.","Documented — direct LoTW and eQSL upload/confirmation workflows."],
  ["WSJT-X Logged ADIF UDP intake","Source complete — explicit default-off receive-only listener for official Logged ADIF messages; loopback/multicast validation and duplicate-safe local save; live WSJT-X acceptance open.","Documented / locally inventoried — configurable WSJT-X UDP logging and save choices.","Documented — WSJT-X integration; source audit shows one configurable unicast/multicast receiver and QSO Logged/Logged ADIF parsing.","Documented — WSJT-X/JTDX/MSHV UDP decodes and outbound logged-QSO ADIF. Matching inbound Logged ADIF safety contract was not established."],
  ["WSJT-X CQ activity and novelty","Source complete — bounded receive-only FT8/FT4 CQ activity feeds named alerts with current local call/DXCC novelty; no reply, CAT, PTT or save authority.","Documented / locally inventoried — WSJT-X activity-window and callsign-checking choices.","Documented — WSJT-X activity can feed its alert evaluator.","Documented — UDP decodes feed band maps, alerts and Flex spots; v0.51.10 notes a direct-reply filtering fix."],
  ["DX Cluster","Implemented — native shared cluster owner, profiles, filters, console paths and retained spot state; configuration and display remain separated.","Documented — internet/local-skimmer cluster, terminal and separated/alerted spots.","Documented — DX cluster integration.","Documented — multiple clusters, reconnect, shared filters and new/new-band/new-slot/worked status."],
  ["Spot History","Source complete — separate retained local reports, search/filter/statistics and read-only review. Detached visibility, width and keyboard-accessible column ordering persist while headers, cells and widths move together; packaged/live retention acceptance remains open.","Documented — incoming cluster data and spot/search workflows; exact retained-history model differs.","Documented alert/history tables; exact long-term raw report retention was not established in the reviewed README.","Not established in reviewed v0.51.10 documentation as an equivalent retained report/history store."],
  ["Named DX/WSJT-X alert rules","Source complete — independently enabled structured rules, all matching names, bounded dedup/rate limiting and passive recent-alert dashboard. Retained events explain evidence/history, sort deterministically, support exact-UUID selective clearing, and persist operator-selected table columns while Select/Call remain mandatory; compact cards retain all evidence. Presentation changes preserve rules, UUID selection, source baselines, delivery limits and no-replay state.","Documented — DXCC/band/mode/IOTA novelty, confirmation source choices, wildcard station watches and optional spoken delivery.","Documented — named cloneable rules combining source, callsign, entity, novelty, geography, comment, band, mode, memberships and activity references.","Documented — call/country/band/mode/spotter alert rules and WSJT-X/JTDX/MSHV activity."],
  ["Alert delivery without RF authority","Source complete — native default-off popup plus optional sound, no action button or station authority; installed live-cluster popup/sound acceptance open.","Documented — color-only or opt-in spoken alarm delivery.","Documented — optional bell and outbound UDP; QLog may also tune/reply from alert UI, which OM0RX-xLog intentionally does not copy.","Documented — sound, visual and email alerts. Equivalent no-action/no-RF authority guarantees were not established."],
  ["World map and grayline","Implemented — online hybrid/satellite/standard map, spot and DXCC layers, route/grayline/sun overlays and semantic labels; prolonged operator observation remains.","Documented — maps/grayline and DXCC/spot workflows.","Documented — online and offline map.","Documented — great-circle and locator maps, basemaps, distance/bearing and antenna lobes. Grayline was not established."],
  ["Band maps","Implemented — multiple independently keyed band maps, follow-radio behavior and detached windows; final mixed-size/multi-display packaged acceptance remains.","Documented / locally observed — multiple independent band-map windows.","Documented — bandmap.","Documented — multi-band panadapter-style strips and worked-status filtering."],
  ["Canvas and separate-window modes","Source complete — persistent Canvas/Separate Windows choice, named native task windows and geometry recovery. Switching to Canvas closes child windows; simultaneous multi-display packaged acceptance remains.","Documented / locally observed — many named native windows with saved placement conventions.","Documented — customizable GUI and saved layout profiles; macOS is experimental.","Documented — configurable per-profile panes and independent per-tab persistence in v0.51.10. Equivalent detached lifecycle was not established."],
  ["Responsive detached windows","Partial — common chrome removal and targeted fixes cover many roles. Detached Propagation rows align; Station Status and Rotor use the shared inset; Rotor starts at the top. Focused 31/31 UI, rendered geometry, Band Map 380×1100, Callsign Intelligence 680×500 and Rotor 676×500/400×600 browser checks pass without page overflow. The packaged all-window resolution/scale matrix remains outstanding.","Mature native macOS window behavior is the reference; exact responsive tests were not obtained.","Recommended resolution is 1920×1080; cross-platform GUI is customizable, but compact-window behavior was not established.","Not independently verified. Release notes mention window sizing; exact compact/mixed-display acceptance was not established."],
  ["Custom canvas panel move/resize","Source complete for traditional unlock/edit interaction — panel arrow enters edit mode, title drags position and edges/corners resize; broader mixed-size acceptance remains.","Not a directly comparable canvas workflow in reviewed evidence.","Documented saved layout profiles; exact freeform canvas resize interaction differs.","Documented — configurable panes and dockable/reorderable Station Control. Equivalent freeform canvas resize was not established."],
  ["Radio control providers","Implemented — Remote Agent, direct FLEX LAN and local Hamlib paths are capability-separated with explicit selection/connect and retained observed state.","Documented — Kenwood, Elecraft, Yaesu and Icom support, with deeper controls for selected models.","Documented — Hamlib, OmniRig, TCI and FLRig.","Documented — OmniRig, Flex TCP/UDP, Icom CI-V USB/network, Kenwood/Elecraft, Yaesu and TCI."],
  ["TCI rig control — SunSDR/ExpertSDR and compatible servers","Source complete for receive tune/filter and bounded passive telemetry, including configured-TRX split/TX-frequency, spots, sensors, locks, mute/volume/balance, monitor state, AGC mode, RX_BIN_ENABLE and RX_NR_ENABLE. Independent exact tokens and producer receipts are pruned/reset with discovery/lifecycle changes and never establish audibility, capability, configured readiness, control, TX completion or RF authority. Existing no-replay/readback owner is unchanged. Transmit/PTT, split/TX-VFO controls, outbound spots, audio/IQ and package/native/live station/provider/network/RF acceptance remain open. Installed alpha.32 is exact source e270ab5; later TCI observations are source-only.","Not established in the reviewed primary RUMlogNG evidence.","Documented — QLog supports all TCI-compatible rigs through its native TCI provider.","Documented — push-driven TCI console, bidirectional audio, recorder and DVK. Source, key/release safety, physical calibration and RF acceptance are not independently verified."],
  ["Safe simplex tuning and Tune/Cancel","Source complete — durable exact-owner transactions, one existing-worker dispatch, no replay and authoritative readback where available; packaged/hardware acceptance open.","Documented — CAT can set transceiver parameters from the logbook and vice versa; safety contract was not audited.","Documented — rig control and cluster/bandmap integration; safety contract was not audited.","Documented — tune/PTT controls and frequency/mode actions. Equivalent no-replay, abort and durable readback guarantees were not established."],
  ["Amplifier Operate/Standby","Source complete — one shared Agent-only durable owner provides separate Operate and urgent Standby lanes, exact identity/freshness fences, one-attempt journal-before-send dispatch and explicit unknown-receipt recovery. Packaged Agent, amplifier-readback, hardware and RF acceptance remain.","Model/device controls exist for supported station equipment; exact KPA-style workflow was not established.","No comparable amplifier owner was established in reviewed evidence.","Documented — multiple amplifier controls/status/meters for PGXL, SPE, Acom and Elecraft families."],
  ["Rotor control","Source complete — shared manual Goto, native urgent Stop and standalone Auto/Stop with exact owner/generation fences; packaged/hardware acceptance open.","Documented through a companion advanced Rotor application interacting with RUMlogNG and WSJT-X.","Documented — Hamlib and PSTRotator control.","Documented — PstRotator UDP, Rotator Genius TCP, ARCO LAN/USB and Ultrabeam direction context."],
  ["CW keyer and console","Implemented foundation — shared saved macros/new-QSO context plus explicit selected-radio and independent WinKeyer ownership; remaining end-to-end hardware acceptance is open.","Documented — K1EL WinKeyer, CW keyer and RTTY application.","Documented — CWDaemon, FLDigi, Morse over CAT, WinKey v1/v2 and CW Console.","Documented — macros/F-keys via WinKeyer, Flex CWX, Icom or TCI; DVK and QSO audio recording."],
  ["Propagation display","Source complete with live provider proof — bounded HamQSL/N0NBH refresh and correct freshness semantics; final packaged outage/freshness observation remains.","Not highlighted in reviewed primary feature listing.","Not highlighted in reviewed primary feature listing.","Not established in reviewed v0.51.10 documentation as an equivalent propagation display."],
  ["Awards and statistics","Implemented foundation — nine native calculators plus a 192-programme research library. 6d9b186 adds pure QRPDXCCPreflightV1 snapshot screening (7/7 Swift) as an R09 dependency only: candidates/exclusions/unknowns and exact retained-power checks. Candidate stored DXCCs are not validated entities, progress, completion or sponsor credit. Measurement, sponsor validity, applicant scope, land/direct-contact eligibility and declaration remain unresolved; executable sponsor rules, application/export, route/UI and package/live acceptance stay open.","Documented — DXCC plus IOTA, CQ/ITU zones, grids, states, counties, DOKs and detailed QSL statistics.","Documented — basic awards and station statistics.","Documented — configurable awards/references, worked/confirmed/validated band-mode matrices, reference import/rescan and statistics; sponsor-rule correctness is not verified."],
  ["Contest logging","Outstanding as a separate programme — ordinary logging remains primary; do not add empty parity UI.","Documented — specialized contest/DXpedition logger with scoring and ESM.","Documented — basic contest support; QLog states contests are not its current focus.","Documented — contest selection/exchange, dupe flags and scoreboard. Not independently source/runtime verified."],
  ["Paper QSL and label printing","Outstanding as a dedicated workflow; ADIF QSL fields are preserved and remote confirmations can refresh.","Documented — incoming paper QSL management and QSL label printing.","No paper-label workflow established in the reviewed README.","Documented — QSL management and QSL-card designer/email eQSL. Equivalent paper-label printing was not established."],
  ["Station/location profiles","Partial — saved station identity/equipment/workspace configuration exists with separate radio, rotor, antenna and activity ownership; profile UX can be improved without unsafe implicit apply.","Documented / locally observed — operator identity, radios, QRGs, modes/satellites, cluster, QSL and service groups.","Documented — station location profile support.","Documented — per-profile settings/logbook selection and optional shared MySQL."],
  ["Secure credential storage","Implemented — Keychain/vault-backed provider credentials with ownership and revision fencing.","Uses macOS platform storage for supported services; exact architecture was not audited.","Documented — system keyring/credential store support on Linux, Windows and macOS.","Documented — opt-in passphrase vault using AES-GCM/PBKDF2. Implementation/security not independently source-verified."],
  ["Backups","Partial — local backup/restore safety exists; optional remote FTP/FTPS/SFTP work is active in a separate user-owned change set and is not counted complete here.","Not established in reviewed primary feature listing.","Not established in reviewed primary feature listing.","Documented — optional database/ADIF backup at shutdown. Equivalent verified recovery/restore guarantees were not established."],
  ["Cross-platform delivery","Partial — one shared UI/domain targets macOS, Windows and Linux; Mac is the current acceptance focus and Windows/Linux packaging is intentionally deferred.","Mac only.","Linux and Windows supported; macOS is documented as experimental/developer-only.","Documented as a Windows logger. Cross-platform delivery was not established."],
  ["Privacy and telemetry","Implemented by design — local-first operation, explicit external-service enrollment and no hidden station/network actions in source acceptance tests.","Current App Store disclosure says data is not collected.","Documented — no ads, user tracking or hidden telemetry.","Documented — daily anonymous installation/version/OS telemetry with opt-out. No privacy/runtime verification performed."],
];

const outstandingRows = [
  ["P0", "Amplifier Operate/Standby owner", "Source complete", "Run exact-source packaged Agent acceptance without RF transmission; then obtain authoritative amplifier/drive readback and hardware acceptance under operator control.", "Exact-source Mac package, controlled Agent proof, amplifier/hardware evidence", "OM0RX safety model; QLog does not provide a comparable contract"],
  ["P0", "PTT owner", "Source complete", "Run exact-source packaged and controlled live Agent/FLEX acceptance, including release timing and prior-app fail-closed recovery without RF transmission.", "Exact-source Mac package, live observed-state and physical release evidence", "OM0RX stronger least-authority design"],
  ["P0", "All-window responsive acceptance", "Partial", "Exercise every detached window at compact, normal, large and mixed-display scales; fix clipping and unused space.", "Packaged macOS screenshots and interaction checks", "RUMlogNG native-window maturity"],
  ["P0", "Separate Windows to Canvas transition", "Source complete", "Confirm switching modes closes all child windows and restores Canvas without stale ownership or geometry.", "Packaged simultaneous-window acceptance", "RUMlogNG Window discoverability; QLog saved profiles"],
  ["P0", "Logbook arbitrary ADIF editing", "Source complete", "Run packaged macOS pointer/keyboard interaction and legacy-log round-trip acceptance; retain explicit review for malformed legacy optional values.", "Packaged UI review and copied-database round-trip evidence", "RUMlogNG edit/search/export workflow"],
  ["P0","ADIF 3.1.8 conformance","Fourteen compatibility stages complete","Complete the remaining enum/deprecation and MODE/SUBMODE audit before changing ADIF_VER; run copied-log/package and service-specific interoperability acceptance. PSKAM31 90f7a3e: Swift 18/18, frontend 1,218/1,218, tsc; PSKAM50 e34a094: Swift 18/18, frontend 1,234/1,234, tsc. Source evidence only. PSKFEC31 8c43ef5: Swift 18/18, frontend 1,250/1,250, tsc; ADIF_VER stays 3.1.7. PSKHELL 9e8b97b: official import-only to HELL, Swift 18/18, frontend 1,266/1,266, tsc; root reviewed/diff checked. QPSK31 8934ab6: official import-only to PSK, agent Swift 18/18, frontend 1,282/1,282, tsc; root frontend 1,282/1,282, tsc/diff. ADIF_VER 3.1.7 unchanged.","Pinned official fixtures, copied-log round trip and exact package","Official ADIF 3.1.8"],
  ["P0", "PJ/DXCC affected-record review", "Read-only source preview complete", "Run the bounded preview against a disposable copied real logbook; preserve explicit DXCC/manual overrides and require separate approval before any reversible correction feature.", "Copied real-log preview, exact-package UX and rollback evidence", "Official/date-qualified CTY rules"],
  ["P1","Full TCI radio provider","Receive tune/filter and bounded passive telemetry source complete; full history/counts in project docs and Feature Matrix. Independent RX_VOLUME/RX_BALANCE, MON_VOLUME/MON_ENABLE, AGC_MODE, RX_BIN_ENABLE and RX_NR_ENABLE receipts/reset confer no audio, audibility, capability, configured readiness, control or RF authority. RX_BIN_ENABLE fd12703: 147/147 focused; RX_NR_ENABLE 7fe73ea: 153/153 focused. The closeCount lifecycle failure and package/native/live station/provider/network/RF gates remain open.","Extend the existing no-replay owner with separately reviewed split/TX-VFO controls, urgent release and optional audio/IQ slices; passive notifications never become configured evidence/inventory or CW/RF authority. Transmit/PTT keeps its own explicit authority.","Simulated-server races, package tests, then operator-controlled SunSDR acceptance","Official ExpertSDR3 TCI specification and QLog behavior"],
  ["P1", "Previous QSOs window", "Source plus synthetic visual complete", "Run exact packaged native-window, focus/keyboard and Canvas-transition acceptance; retain the canonical draft/history owners.", "Exact-source macOS package and mixed-window acceptance", "RUMlogNG entity/QSO search surfaces"],
  ["P1", "Direct LoTW/eQSL", "LoTW request and frozen preview source foundation complete", "Add redirect-disabled bounded streaming transport and confirmation-only revision-fenced apply with no outbox; keep TQSL signing/upload and eQSL as separate provider owners. Never log GET credentials or piggyback on Wavelog credentials.", "Parser/request/preview 25/25; remaining transport/apply, provider sandbox/live-account, exact-package and no-outbox acceptance", "RUMlogNG and QLog service workflows; official ARRL LoTW query/TQSL contracts"],
  ["P1", "HRDLog.net", "Outstanding", "Verify the current official contract, then add a default-off prospective uploader if the contract is safe and useful.", "Official API evidence and live-account acceptance", "QLog and RUMlog upload utility"],
  ["P1", "WSJT-X live acceptance", "Source complete", "Run the default-off Logged ADIF and CQ listeners against a real WSJT-X instance without reply/CAT/PTT authority.", "Live UDP capture and duplicate/no-replay evidence", "QLog and RUMlogNG UDP workflows"],
  ["P1", "Alerts live acceptance", "Source complete", "Verify popup, optional sound, expiry, deterministic sorting, persisted column visibility, selective/all clearing and suppression counters from real retained cluster/WSJT-X traffic.", "Installed live-cluster and compact/wide column-presentation evidence", "QLog rule table/columns and RUMlogNG novelty alarms"],
  ["P1", "Saved QSO filter profiles", "Source complete", "Package-test Save/Apply/Clone/Rename/Update/Delete against the canonical query and verify keyboard/focus behavior across window contexts.", "Exact-source package, UX and persistence acceptance", "QLog custom filters and layout profiles"],
  ["P1", "Connection Doctor surface", "Native window and redacted export source complete", "Verify native Save/Cancel/overwrite in the exact package and real retained-provider states; preserve the closed allowlist and no-action boundary.", "Privacy review, exact-package and retained-provider acceptance", "OM0RX least-data diagnostic design"],
  ["P1", "Operating-goal UI", "Passive native source window complete", "Package-test the explained retained-source window; consider explicit opt-in timezone reminders as a separate slice.", "Exact-package presentation/freshness and optional reminder tests", "RUMlogNG alarms/award status; QLog alerts/filters"],
  ["P1", "Online-log follow-up UI", "Read-only route/UI source and browser verified", "Accept the exact package/native interaction; define provider acceptance/match timestamps and sponsor rules before extending the retained-evidence contract. Upload delivery never establishes confirmation or sponsor credit.", "Exact-package/native interaction and live-account evidence", "RUMlogNG/QLog online-log status workflows"],
  ["P1", "Contest logging", "Programme decision", "Decide whether to build a separate contest engine with scoring, exchange, ESM and Cabrillo/REG1TEST export.", "Rules, performance and contest-specific acceptance plan", "RUMlogNG mature contest workflow; QLog basic contests"],
  ["P2", "Paper QSL and labels", "Programme decision", "Decide whether paper-QSL tracking and label printing belongs in the product or remains an external workflow.", "Printer/template requirements and operator demand", "RUMlogNG"],
  ["P2", "Regional band/allocation guides", "Candidate", "Add only from authoritative regional data with operator-selected region and update provenance.", "Authoritative data source and boundary tests", "QLog band guides; RUMlogNG editable QRG segments"],
  ["P2", "Windows and Linux packages", "Deferred", "Build only after Mac visual and workflow acceptance, then validate platform-specific keyrings, radios and window behavior.", "Native Windows/Linux packages and hardware tests", "QLog cross-platform distribution"],
  ["P1","OpsLog source/licence access","Documentation-only supplementary reference","Obtain legitimate access to actual versioned Gitea application source and explicit application licensing before any source audit or reuse. Public v0.51.10 mirror contains only README.md/README.fr.md; current source is auth-gated (Git credentials, web/archive login, API 403). No direct code copied.","Versioned application source and licence; no runtime/live acceptance inferred","RUMlogNG #1, QLog #2, OpsLog #3; OpsLog audit"],
  ["P1","Independent cross-surface acceptance","Planning; existing owners only","Separate standard ADIF/full-backup export; one award/spot-status projection across refresh; revision-checked caches; capability/transport/observed/action separation; TCI endpoint/key-release validation; per-map persistence/resize-after-layout; preserve user award customizations across catalogue upgrades.","Focused owner tests, exact-package/native/copied-log acceptance, then explicitly authorized device/provider/RF proof","OpsLog v0.51.10 README/release as supplementary behavior only"],
];

const reviewRows = [
  ["R01", "P0", "Resolver and read-only preview source complete; package/data-impact review open", "CTYResolver, stored QSO DXCC override and bounded Logbook preview", "Accept against a disposable copied log; never bulk rewrite."],
  ["R02", "P0", "Implemented; package/hardware acceptance open", "Durable Tune, Cancel, PTT, amplifier and rotor owners", "Exact-package stale/unknown/release checks, then authorized hardware/RF."],
  ["R03", "P0", "Source complete; copied-log acceptance open", "ADIF field bag, contact mutation, delete/undo", "Edit/undo/conflict plus ADI/ADX round-trip proof."],
  ["R04","P0","Fourteen compatibility stages complete","ADIF parser/writer and frontend transfer","PSKAM31 90f7a3e: Swift 18/18, frontend 1,218/1,218, tsc. PSKAM50 e34a094: Swift 18/18, frontend 1,234/1,234, tsc. Finish remaining 3.1.8 audit/copied-log/package acceptance; retain ADIF_VER 3.1.7. PSKFEC31 8c43ef5: Swift 18/18, frontend 1,250/1,250, tsc; import-only to PSK. PSKHELL 9e8b97b: import-only to HELL, Swift 18/18, frontend 1,266/1,266, tsc; root reviewed/diff checked. QPSK31 8934ab6: import-only to PSK; agent Swift 18/18, frontend 1,282/1,282, tsc; root frontend 1,282/1,282, tsc/diff. ADIF_VER 3.1.7."],
  ["R05", "P0", "Detached geometry and targeted browser checks complete; package acceptance open", "Native window geometry and Canvas/Separate Windows owner", "Package-test all sizes, displays, DPI, focus, keyboard and accessibility."],
  ["R06", "P1", "Passive model, worker and native UI complete; package open", "Opportunity feeds, spots, alerts, awards and history", "Package-test 52010e3 plus Spot History ordering 82bcbee and deterministic/selective/configurable-column Alerts f517d9a/685f468/27354a3; retain explicit cluster-provenance exclusion and no station actions."],
  ["R07","P1","Read-only route/UI source and browser verified; package/provider open","Sync/delivery/confirmation and award state","Package-test 5486aff; retain unknown provider ages/credit until timestamp and sponsor-rule contracts exist. 7adb008 adds an end-to-end synthetic Wavelog sync regression (focused 1/1): clean linked contacts receive fresh eQSL/LoTW/QRZ/message confirmation fields; local-only station/custom fields survive; no outbox/conflict; second sync idempotent. Fixture-only source evidence, not new live-provider/package acceptance."],
  ["R08", "P1", "LoTW request and frozen preview source foundation complete", "Dedicated LoTW parser/request/preview plus vault and durable claim/receipt patterns", "3c6f26f parses bounded LoTW-only evidence; 8a45a73 adds fixed-origin GET planning, response validation and frozen match/change preview (25/25 combined) without live request or DB action. Add redirect-disabled streaming transport and revision-fenced no-outbox apply; keep TQSL signing/upload and eQSL separate."],
  ["R09", "P1", "QRP DXCC preflight dependency source complete; executable award open", "Award calculators, research registry and QRPDXCCPreflightV1", "7/7 Swift screens candidates only; resolve measurement/sponsor/scope/eligibility/declaration requirements before executable rules, application/export or credit."],
  ["R10","P1","Read-only findings/duplicate review, pure helper and CTY DXCC-only preview UI source complete; apply/undo open","Exact-contact canonical route, native duplicate rule, Details and canonical contact-update owner","33e5eb4: zero-write bounded validation/raw diff reused by canonical apply unchanged; new 6/6 + route/contact 15/15, root focused 6/6, DB/WAL/SHM/journal purity. The helper is not saved-value simulation. Correction apply/undo and package/native/live/full coverage remain open. 8ccffe7 adds read-only CTY DXCC-only correction preview, exact-contact/generation/revision/current-comparison-evidence fenced, using the canonical finding and pure review owner (root 2/2 plus data-quality regression). Unknown source/version/date facts stay unknown; stored/manual values are unchanged. No apply/undo/UI, operation ID, receipt, journal, provider correction or live acceptance. 327648c adds compact read-only CTY DXCC preview inside existing Logbook Details only, validating exact scope/evidence (Swift 2/2, UI/bridge 22/22, tsc). No apply/undo, operation ID, receipt, journal or provider correction; package/native/copied-log/live acceptance stays open."],
  ["R11", "P1", "New candidate", "Import preview, semantic identity and workspace snapshots", "Isolated migration trial, delta report, exceptions and rollback."],
  ["R12", "P1", "Useful extension; baseline exists", "Existing split/VFO UI and CAT owners", "Explicit split intent, dual readback and safe simplex return."],
  ["R13", "P1", "New candidate", "Canonical draft and spot/opportunity admission", "Local scratch queue; explicit promotion only."],
  ["R14", "P1", "Useful extension", "Station identity, activation directories and QSO ADIF", "Immutable activation session and explicit return home."],
  ["R15", "P1", "Previous QSOs and saved-filter source complete; package open", "Logbook query snapshot and canonical detached history context", "2f00a55 adds query-only Update with no implicit Apply. Package-test native history plus Save/Apply/Clone/Rename/Update/Delete persistence."],
  ["R16", "P1", "Native window and click-only redacted export source complete; package open", "Retained station diagnostics only", "Package-test Save/Cancel/overwrite and real retained states; preserve the closed allowlist."],
  ["R17", "P1", "Existing acceptance; partial", "100k proof, capacity guard, backups and recovery owners", "1m, contention, kill/restart, outage and isolated restore."],
  ["R18", "P2", "Optional extension", "Spot history plus antenna/power metadata", "Passive self-call RBN analysis with comparability limits."],
  ["R19", "P2", "New candidate; deferred", "CW/PTT safety patterns", "Default-off local voice/audio only after PTT acceptance."],
  ["R20", "P2", "Passive shared model/route/UI complete; reminders open", "Existing 425DXN and activation feeds", "Use existing scheduled evidence for explicit opt-in timezone reminders only."],
  ["R21", "P2", "New candidate", "QSO notes, history and confirmation fields", "Private journal/attachments excluded from sync/export by default."],
  ["R22", "P2", "Useful data/editor extension", "Satellite ADIF/Wavelog mapping and arbitrary fields", "Optional validated satellite/VHF editor; defer orbit/Doppler."],
  ["R23", "P2", "Deferred product decision", "Ordinary logger only", "Choose casual export versus real contest programme."],
  ["R24", "P2", "Deferred by Mac-first boundary", "Shared architecture", "Exact Windows/Linux packages only after Mac acceptance."],
];

const sourceRows = [
  ["OM0RX-xLog","Current implementation checkpoint 27354a36f062f3790b2ee8f7b8ea4570d1b8d015","2026-10-16","PROJECT_STATUS.md, PROJECT_BOARD.md, operator-feedback tracker and enhancement-recommendations reconciliation. Source/test/browser results remain separate from package/native/live/hardware acceptance. Installed alpha.32 is the separately accepted exact source e270ab5; later commits are not claimed inside that bundle."],
  ["OM0RX-xLog","https://github.com/oliverbross/OM0RX-xLog/commit/27354a36f062f3790b2ee8f7b8ea4570d1b8d015","2026-10-16","Current RUMlog-first/QLog-second source increments after installed alpha.32: Logbook ordering 544b763; Alerts sorting f517d9a; passive TCI RX_BIN_ENABLE fd12703; Spot History ordering 82bcbee; passive TCI RX_NR_ENABLE 7fe73ea; selective Alerts clearing 685f468; saved-filter query Update 2f00a55; bounded LoTW parser 3c6f26f; fixed-origin request/frozen preview 8a45a73 (25/25 combined); persisted Alerts columns 27354a3 (28/28 plus build). Focused/source evidence only; package/native/live provider/station/network/RF acceptance remains open."],
  ["Enhancement review", "OM0RX-xLog_Codex_Enhancement_Review_2026-10-16.md and OM0RX-xLog_Enhancement_Backlog_2026-10-16.xlsx", "2026-10-16", "User-supplied advisory sources reconciled against the active checkout; recommendations are classified on the Enhancement Review sheet."],
  ["RUMlogNG", "Installed RUMlogNG 6.5.1, build 727", "2026-10-16", "Read-only bundle metadata. Prior local audits inspected menus, bundled help and visible Settings labels without reading user data or changing preferences."],
  ["RUMlogNG", "https://apps.apple.com/us/app/rumlogng/id964454561?mt=12", "2026-10-16", "Current official App Store description: logging, QSL, contest, cluster, CAT, WinKeyer, awards and Club Log features; macOS 12.4+ and Mac-only."],
  ["RUMlogNG", "https://dl2rum.de/forum/app.php/downloads", "2026-10-16", "Official developer download page and companion utilities, including the real-time upload utility and Rotor application."],
  ["RUMlogNG", "https://dl2rum.de/RUMlogNG/docs/en/pages/DX-Alarm-Setting.html", "2026-10-16", "Official DX Alarm behavior used as alert explainability inspiration; no implementation code was copied."],
  ["RUMlogNG", "https://dl2rum.de/RUMlogNG/docs/en/pages/Win-DX-Spots.html", "2026-10-16", "Official DX Spot window documentation used for behavior comparison only."],
  ["QLog", "https://github.com/foldynl/QLog/blob/master/README.md", "2026-10-16", "Official feature inventory for GUI, radio/rotor/CW, callbooks, DX cluster, online logs, maps, WSJT-X, awards, contests and supported operating systems."],
  ["QLog", "https://github.com/foldynl/QLog/commit/cbb75f2f2555a4a84c9761e38075754f4821c27c", "2026-10-16", "Verified upstream HEAD used by the read-only source/workflow audit."],
  ["LoTW", "https://lotw.arrl.org/lotw-help/developer-query-qsos-qsls/", "2026-10-16", "Official ARRL GET/report contract used for the dedicated confirmation-envelope parser and download plan; no account request or credential use was performed."],
  ["LoTW/TQSL", "https://lotw.arrl.org/lotw-help/developer-submit-qsos/", "2026-10-16", "Official ARRL submission boundary: certificate/station-location signing and upload remain separate from report download and are not implemented by the parser stage."],
  ["TCI protocol", "https://github.com/ExpertSDR3/TCI/tree/b081213ff97150fd29f669c633f060f93c81a286", "2026-10-16", "Pinned official ExpertSDR3 MIT protocol source for the original codec/reducer implementation; no QLog implementation code was copied."],
  ["Comparison method", "RUMLOG_WORKFLOW_GAP_AUDIT_2026-10-14.md; QLOG_WORKFLOW_GAP_AUDIT_2026-10-15.md; OPSLOG_REFERENCE_AUDIT_2026-10-16.md", "2026-10-16", "Behavioral inspiration only. No third-party source, artwork, settings, credentials or logbook data is copied into OM0RX-xLog."],
  ["Reference order","RUMlogNG #1; QLog #2; OpsLog #3","2026-10-16","OpsLog is documented supplementary only until current source and application licensing can be reviewed. Existing xLog checkpoint/test/acceptance limits remain unchanged. See docs/OPSLOG_REFERENCE_AUDIT_2026-10-16.md."],
  ["OpsLog (#3)","https://github.com/GregTroar/OpsLog/releases/tag/v0.51.10","2026-10-16","Official release published 2026-10-15. Mirror tag SHA b30bd55c3de979edc76a965034e8d2f7fd5fdc12. Release notes supply acceptance ideas, not independent runtime/source verification."],
  ["OpsLog (#3)","https://github.com/GregTroar/OpsLog/blob/b30bd55c3de979edc76a965034e8d2f7fd5fdc12/README.md","2026-10-16","Public tag contains README.md and README.fr.md only. Documented Wails 2.11/Go/React/TypeScript/Vite, SQLite configuration and optional shared MySQL log; feature statements in OpsLog column are documentation claims."],
  ["OpsLog (#3)","https://git.rouggy.com/rouggy/OpsLog","2026-10-16","Actual source authority is authentication-gated: Git credentials, web/archive sign-in and API 403 in access audit. GitHub API license:null; no app source licence found. Not current-source-reviewed or licence-verified; no code copied."],
];

const workbook = Workbook.create();
const matrix = workbook.worksheets.add("Feature Matrix");
const outstanding = workbook.worksheets.add("Outstanding");
const review = workbook.worksheets.add("Enhancement Review");
const sources = workbook.worksheets.add("Sources");
const font = "Arial";
const navy = "#0B1B2B";
const blue = "#163A5F";
const cyan = "#2EC5E8";
const teal = "#10BFA3";
const amber = "#F2B84B";
const paleBlue = "#EAF4FB";
const paleGreen = "#E7F6F1";
const paleAmber = "#FFF4D6";
const paleRed = "#FCE8E6";
const text = "#17212B";
const muted = "#5F6B78";
const border = "#CBD5E1";

function setupSheet(sheet, title, subtitle, widths) {
  const lastColumn = String.fromCharCode(64 + widths.length);
  sheet.showGridLines = false;
  sheet.getRange("A2").values = [[title]];
  sheet.getRange("A2").format.font = { name: font, size: 16, bold: true, color: navy };
  sheet.getRange("A3").values = [[subtitle]];
  sheet.getRange("A3").format.font = { name: font, size: 10, italic: true, color: muted };
  sheet.mergeCells(`A3:${lastColumn}3`);
  sheet.getRange(`A3:${lastColumn}3`).format.wrapText = true;
  sheet.getRange(`A2:${lastColumn}2`).format.borders = { bottom: { style: "thin", color: cyan } };
  sheet.getRange("A1:F200").format.font = { name: font, size: 10, color: text };
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, 200, 1).format.columnWidth = width;
  });
}

setupSheet(
  matrix,
  "OM0RX-xLog feature comparison",
  "As of 16 October 2026. OM0RX-xLog states distinguish source implementation, installed/package acceptance and live hardware/service proof. External references: RUMlogNG #1, QLog #2, OpsLog #3. OpsLog v0.51.10 is documented supplementary only, not current-source/license verified; Sources records the access gap.",
  [34, 64, 54, 54, 54],
);
const implementedCount = matrixRows.filter((row) => /^(Installed|Implemented|Source complete)/.test(row[1])).length;
const openCount = matrixRows.filter((row) => /^(Active|Partial|Outstanding)/.test(row[1])).length;
matrix.getRange("A4:D4").values = [["Implemented or source complete", implementedCount, "Active, partial or outstanding", openCount]];
matrix.getRange("A4:D4").format = {
  fill: paleBlue,
  font: { name: font, size: 10, bold: true, color: navy },
  borders: { preset: "outside", style: "thin", color: border },
  verticalAlignment: "center",
};
matrix.getRange("A6:E6").values = [["Feature", "OM0RX-xLog", "RUMlogNG", "QLog", "OpsLog"]];
matrix.getRange(`A7:E${6 + matrixRows.length}`).values = matrixRows;
matrix.getRange(`A6:E${6 + matrixRows.length}`).format.wrapText = true;
matrix.getRange(`A6:E${6 + matrixRows.length}`).format.verticalAlignment = "top";
matrix.getRange("A6:E6").format = {
  fill: navy,
  font: { name: font, size: 10, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "inside", style: "thin", color: "#FFFFFF" },
};
matrix.getRange(`A7:A${6 + matrixRows.length}`).format.font = { name: font, size: 10, bold: true, color: navy };
matrix.getRange(`A7:E${6 + matrixRows.length}`).format.borders = {
  insideHorizontal: { style: "thin", color: border },
  bottom: { style: "thin", color: border },
};
matrix.getRange(`B7:B${6 + matrixRows.length}`).conditionalFormats.add("beginsWith", { text: "Installed", format: { fill: paleGreen, font: { color: "#087A68" } } });
matrix.getRange(`B7:B${6 + matrixRows.length}`).conditionalFormats.add("beginsWith", { text: "Implemented", format: { fill: paleGreen, font: { color: "#087A68" } } });
matrix.getRange(`B7:B${6 + matrixRows.length}`).conditionalFormats.add("beginsWith", { text: "Source complete", format: { fill: paleBlue, font: { color: blue } } });
matrix.getRange(`B7:B${6 + matrixRows.length}`).conditionalFormats.add("beginsWith", { text: "Active", format: { fill: paleAmber, font: { color: "#8A5A00", bold: true } } });
matrix.getRange(`B7:B${6 + matrixRows.length}`).conditionalFormats.add("beginsWith", { text: "Partial", format: { fill: paleAmber, font: { color: "#8A5A00" } } });
matrix.getRange(`B7:B${6 + matrixRows.length}`).conditionalFormats.add("beginsWith", { text: "Outstanding", format: { fill: paleRed, font: { color: "#A61B1B", bold: true } } });
matrix.tables.add(`A6:E${6 + matrixRows.length}`, true, "FeatureComparisonTable").style = "TableStyleMedium2";
matrix.freezePanes.freezeRows(6);
matrix.freezePanes.freezeColumns(1);
matrix.tabColor = navy;

setupSheet(
  outstanding,
  "Outstanding work and decisions",
  "Priority reflects safety and workflow dependency, not implementation effort. Acceptance evidence is stated separately so source-complete work is not mistaken for installed or live proof.",
  [10, 30, 20, 58, 46, 40],
);
outstanding.getRange("A6:F6").values = [["Priority", "Feature or decision", "Current status", "Outstanding work", "Evidence required", "Reference or inspiration"]];
outstanding.getRange(`A7:F${6 + outstandingRows.length}`).values = outstandingRows;
outstanding.getRange(`A6:F${6 + outstandingRows.length}`).format.wrapText = true;
outstanding.getRange(`A6:F${6 + outstandingRows.length}`).format.verticalAlignment = "top";
outstanding.getRange("A6:F6").format = {
  fill: blue,
  font: { name: font, size: 10, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "inside", style: "thin", color: "#FFFFFF" },
};
outstanding.getRange(`A7:A${6 + outstandingRows.length}`).format.font = { name: font, size: 10, bold: true, color: navy };
outstanding.getRange(`A7:F${6 + outstandingRows.length}`).format.borders = { insideHorizontal: { style: "thin", color: border }, bottom: { style: "thin", color: border } };
outstanding.getRange(`A7:A${6 + outstandingRows.length}`).conditionalFormats.add("cellIs", { operator: "equal", formula: '"P0"', format: { fill: paleRed, font: { color: "#A61B1B", bold: true } } });
outstanding.getRange(`A7:A${6 + outstandingRows.length}`).conditionalFormats.add("cellIs", { operator: "equal", formula: '"P1"', format: { fill: paleAmber, font: { color: "#8A5A00", bold: true } } });
outstanding.tables.add(`A6:F${6 + outstandingRows.length}`, true, "OutstandingWorkTable").style = "TableStyleMedium2";
outstanding.freezePanes.freezeRows(6);
outstanding.freezePanes.freezeColumns(2);
outstanding.tabColor = blue;

setupSheet(
  review,
  "Enhancement review reconciliation",
  "The supplied 24-item review is reconciled against current source. States distinguish implemented source, unaccepted gates, useful extensions, new candidates and deliberate deferrals.",
  [10, 10, 34, 54, 58],
);
review.getRange("A6:E6").values = [["ID", "Priority", "Reconciled state", "Existing reuse point", "Next accepted outcome"]];
review.getRange(`A7:E${6 + reviewRows.length}`).values = reviewRows;
review.getRange(`A6:E${6 + reviewRows.length}`).format.wrapText = true;
review.getRange(`A6:E${6 + reviewRows.length}`).format.verticalAlignment = "top";
review.getRange("A6:E6").format = { fill: teal, font: { name: font, size: 10, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", borders: { preset: "inside", style: "thin", color: "#FFFFFF" } };
review.getRange(`A7:A${6 + reviewRows.length}`).format.font = { name: font, size: 10, bold: true, color: navy };
review.getRange(`A7:E${6 + reviewRows.length}`).format.borders = { insideHorizontal: { style: "thin", color: border }, bottom: { style: "thin", color: border } };
review.getRange(`B7:B${6 + reviewRows.length}`).conditionalFormats.add("cellIs", { operator: "equal", formula: '"P0"', format: { fill: paleRed, font: { color: "#A61B1B", bold: true } } });
review.getRange(`B7:B${6 + reviewRows.length}`).conditionalFormats.add("cellIs", { operator: "equal", formula: '"P1"', format: { fill: paleAmber, font: { color: "#8A5A00", bold: true } } });
review.tables.add(`A6:E${6 + reviewRows.length}`, true, "EnhancementReviewTable").style = "TableStyleMedium4";
review.freezePanes.freezeRows(6);
review.freezePanes.freezeColumns(2);
review.tabColor = teal;

setupSheet(
  sources,
  "Sources and comparison limits",
  "Feature statements are conservative. 'Not established' means the reviewed primary evidence did not prove the feature; it does not prove absence. Third-party products are references only and no code or data was copied.",
  [20, 72, 16, 72],
);
sources.getRange("A6:D6").values = [["Product", "Source or evidence", "Verified", "Scope and limits"]];
sources.getRange(`A7:D${6 + sourceRows.length}`).values = sourceRows;
sources.getRange(`A6:D${6 + sourceRows.length}`).format.wrapText = true;
sources.getRange(`A6:D${6 + sourceRows.length}`).format.verticalAlignment = "top";
sources.getRange("A6:D6").format = {
  fill: navy,
  font: { name: font, size: 10, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "inside", style: "thin", color: "#FFFFFF" },
};
sources.getRange(`A7:A${6 + sourceRows.length}`).format.font = { name: font, size: 10, bold: true, color: navy };
sources.getRange(`A7:D${6 + sourceRows.length}`).format.borders = { insideHorizontal: { style: "thin", color: border }, bottom: { style: "thin", color: border } };
sources.tables.add(`A6:D${6 + sourceRows.length}`, true, "SourcesTable").style = "TableStyleMedium2";
sources.freezePanes.freezeRows(6);
sources.freezePanes.freezeColumns(1);

for (const sheet of [matrix, outstanding, review, sources]) {
  sheet.getRange("A1:F200").format.verticalAlignment = "center";
  sheet.getRange("A3:F3").format.rowHeight = 42;
  sheet.getRange("A6:F6").format.rowHeight = 30;
  const used = sheet.getUsedRange();
  used.format.autofitRows();
}

workbook.recalculate();

const matrixCheck = await workbook.inspect({ kind: "table", range: `Feature Matrix!A2:E${6 + matrixRows.length}`, include: "values,formulas", tableMaxRows: 50, tableMaxCols: 5, maxChars: 18000 });
const outstandingCheck = await workbook.inspect({ kind: "table", range: `Outstanding!A2:F${6 + outstandingRows.length}`, include: "values,formulas", tableMaxRows: 30, tableMaxCols: 6, maxChars: 12000 });
const reviewCheck = await workbook.inspect({ kind: "table", range: `Enhancement Review!A2:E${6 + reviewRows.length}`, include: "values,formulas", tableMaxRows: 30, tableMaxCols: 5, maxChars: 16000 });
const sourceCheck = await workbook.inspect({ kind: "table", range: `Sources!A2:D${6 + sourceRows.length}`, include: "values,formulas", tableMaxRows: 20, tableMaxCols: 4, maxChars: 9000 });
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan" });

if (writePreviews) {
  const matrixPreview = await workbook.render({ sheetName: "Feature Matrix", range: `A1:E${6 + matrixRows.length}`, scale: 1, format: "png" });
  const outstandingPreview = await workbook.render({ sheetName: "Outstanding", range: `A1:F${6 + outstandingRows.length}`, scale: 1, format: "png" });
  const reviewPreview = await workbook.render({ sheetName: "Enhancement Review", range: `A1:E${6 + reviewRows.length}`, scale: 1, format: "png" });
  const sourcesPreview = await workbook.render({ sheetName: "Sources", range: `A1:D${6 + sourceRows.length}`, scale: 1, format: "png" });
  await fs.writeFile(previewMatrixPath, new Uint8Array(await matrixPreview.arrayBuffer()));
  await fs.writeFile(previewOutstandingPath, new Uint8Array(await outstandingPreview.arrayBuffer()));
  await fs.writeFile(previewReviewPath, new Uint8Array(await reviewPreview.arrayBuffer()));
  await fs.writeFile(previewSourcesPath, new Uint8Array(await sourcesPreview.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
// The library also emits an inspect sidecar. Keep that generated helper outside
// the tracked output directory so narrow workbook refreshes preserve it.
const temporaryExportDir = await fs.mkdtemp(`${os.tmpdir()}/om0rx-matrix-export-`);
const temporaryOutputPath = `${temporaryExportDir}/feature-matrix.xlsx`;
try {
  await output.save(temporaryOutputPath);
  await fs.copyFile(temporaryOutputPath, outputPath);
} finally {
  await fs.rm(temporaryExportDir, { recursive: true, force: true });
}

console.log(JSON.stringify({
  outputPath,
  previewMatrixPath,
  previewOutstandingPath,
  previewReviewPath,
  previewSourcesPath,
  rows: { matrix: matrixRows.length, outstanding: outstandingRows.length, review: reviewRows.length, sources: sourceRows.length },
  matrixCheck: matrixCheck.ndjson,
  outstandingCheck: outstandingCheck.ndjson,
  reviewCheck: reviewCheck.ndjson,
  sourceCheck: sourceCheck.ndjson,
  errors: errors.ndjson,
}, null, 2));
