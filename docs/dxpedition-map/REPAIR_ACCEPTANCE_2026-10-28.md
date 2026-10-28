# DXpedition Map repair acceptance — 28 October 2026

## Source and scope

Canonical source changes are pushed on `main`:

- `3840d316`: catalogue identity, published portable aliases, approximate entity positions, primary Club Log enrichment, archive reader and informational-row native authority.
- `28515ae8`: shipping LiveWorker injection of its own cluster's durable history reader.
- `d96c8c4f`: one-time old-catalogue parser refresh, retirement of withdrawn active records, and explicit IOTA conflict protection.
- `9e6fd02e`: permanent callsign/status/frequency callouts, collision displacement, historical activity and local history/details, disabled contest actions, narrow layout and regression tests.

The final shared-map follow-up, `97ceb629`, gives an exact selected occurrence ID precedence over the prior callsign when centring the map; separate visits no longer centre on the earlier visit. Ended-operation messaging is distinct from an unpublished-callsign announcement.

Finish-Line owned the version, canonical package, signing and isolated native acceptance. It requested a frozen tested source handoff for the combined 1.3.58 candidate. The implementation/reference-comparison phase used no production installation or native/radio actions. The subsequently authorized installation and live native verification are recorded separately below.

## Combined candidate and native smoke

Finish-Line retained the signed **1.3.58** candidate from exact canonical source **`1225274b4c0f5890a03ceb63159cd5577bc32b57`**, comprising the frozen DXMap handoff plus version/provenance reservation. It verified Developer ID signing, deep/strict signature validation and component source provenance. The retained 4,113-entry bundle has tree SHA-256 `5dab8b32846057455f1b52c8fe9f9276c415446ee4d0dbba49fe5d54d3d8175c`. Package receipt: `.build/releases/1.3.58/UNFINISHED_WORK_CANDIDATE_RECEIPT.json`.

Its actual native **Window > DXpedition Map** route opened `tauri://localhost/index.html?view=dxpedition-map` in the retained candidate under PID 37958 and a fresh private root. Search, status/band filters, expedition list and interactive world map loaded. The owner closed the observed DXMap window and verified that the normal logging draft fields remained unchanged. Receipt `.build/unfinished-continuation/dxmap-native-smoke.json` records **`PASS_BOUNDED_NATIVE_WINDOW_BUNDLE_SMOKE`**, zero activation commands and external I/O disabled. The unavailable catalogue in this profile was expected; this check establishes packaged window/route loading, while the live-feed/marker comparison below remains separate evidence.

At this initial smoke checkpoint no production installation had occurred and Finish-Line's wider reliability acceptance was still in progress. Finish-Line subsequently completed its finite checks, recorded explicit Dock/OS limits, pushed documentation checkpoint `f4e9e6be340445058582df45407475193133b6a5` and explicitly handed over native UI ownership. See [unfinished-work acceptance](../planning/UNFINISHED_WORK_ACCEPTANCE_2026-10-28.md).

## Authorized installed live verification — 28 October 2026

The user explicitly authorized installation after Finish-Line's checks and requested live-data/callsign-marker verification in the installed app. The existing installer replaced `/Applications/OM0RX-xLog.app` with the retained **1.3.58 / `1225274b4c0f5890a03ceb63159cd5577bc32b57`** bundle without a rebuild or version reuse. The full installed 4,113-entry tree, component hashes, source provenance and Developer ID signature match the candidate. Security-framework inspection independently verified the actual running app/worker **43112/43123** against their installed-path code hashes.

Ordinary Command-Q closed 1.3.54; process-only checks confirmed app/worker absence before replacement, with no stopped binding queried. The complete revision-**3099** native draft and all **33** existing recovery records matched across Quit. Fresh closed-app backup **`/Users/oliver/Documents/Backups/OM0RX-xLog/DXMap-1.3.58-before-install-20261028T104601+0930`** contains **1,882 files/links / 9,923,757,454 bytes** across all five established roots. **119/120** copied databases passed SQLite checks; the remaining WebKit IndexedDB requires private `IDBKEY` collation and remains SQL-integrity unverified, with exact source/copy hashes preserved. No collation substitution, cache repair or data restore occurred. All five roots still matched the backup immediately before first open. Backup manifest SHA-256: `18beec5f629506f640fc22146b6f60ea21c4de5b859117a0e070935984a74e2d`.

Immediate **1.3.54** rollback is verified and retained under that backup at **`Applications-Rollback/OM0RX-xLog-previous-20261028T011832Z-42999.app`**. The older guarded 1.3.57 fixture was left untouched; only the exact production application was ordinarily quit/replaced.

Actual installed **Window > DXpedition Map** verification passed:

- All three public sources and spot history showed **current**. The catalogue contained **62** current/upcoming operations. **Four Live** operations had permanent callsign/status/frequency markers: **7P8GE, S9R, 6W/I2YSB and T88CZ**. The mixed view also exposed Active, Recent and On air states.
- Upcoming showed **23 operations and 23 labelled, dashed markers** at the settled world view, including KH8A, FW3GT and E51A. This later UTC capture differs from the earlier 26-upcoming fixture because start dates had advanced; it is not a fixed-count promise. An intermediate AX observation during the zoom animation exposed only 20; the settled AX tree and screenshot verified all 23.
- Clicking S9R's map marker opened the correct details, with dates, QSL, approximate-position provenance, source names, local callsign/DXCC history, Club Log last QSO and multi-band frequencies. Older observations visibly disabled tuning. The observed S9R total advanced automatically **45,792 → 45,798 → 45,800 → 45,804** while new cluster reports arrived, proving continuing live updates rather than a static fixture.
- Published-alias search **6W/IK2HKT** returned the single **6W/I2YSB** operation. Active showed **9** operations including the four Live rows. The 30m filter admitted operations with actual 30m history; C5R details verified 10.1371/10.1375/10.1360 MHz observations even though its newest displayed report was on 15m. Filters were restored to **Live / all bands**, search cleared and details closed.
- Browsing used no Tune & load, radio, PTT, rotor or audio control. The full native draft, normal operator-receipt table, all 33 prior recovery records and all **20** existing contest contexts/states/protected ledgers remained exact. All **69,418** original QSO identities remained, with zero additions/deletions. Saved automatic sync downloaded eQSL flags/dates and a QSL message for **four** contacts; update timestamps and revisions advanced **172418 → 172422**, and baseline serialization changed without semantic change. The completed automatic run reports four local updates and zero uploads/remote writes; separate failed/running automatic-run observations are retained. No manual sync was triggered, and continuing background services are not claimed immutable.

Completion receipt: **`.build/install-1.3.58/installation-1.3.58-completed.json`**, status **`INSTALLED_VERIFIED_LIVE_DXPEDITION_MAP_ACCEPTED`**. The backup's **`Installation-evidence/`** contains **42** sealed evidence/procedure files, including native screenshots/AX captures, source/runtime/signature verification, full draft/recovery comparisons, installer logs and exact automatic-sync differences. Evidence-manifest SHA-256: `887a2dc7553d1331736b0f3026009a023d0cc74f0c69062eeff18a51ca552351`. The installed app was left open on the Live map. Actual Dock Quit, OS shutdown, broader display/accessibility and physical RF/audio qualification retain their stated limits.

## Checks

- Focused frontend: **56 passed**, six files (DX model/surface/styles, actual shared Map DOM, MapSpots and marker layout). The Map test verifies world-zoom labels, status/frequency text, preservation of MapLibre positioning classes, exact occurrence camera selection and passive interaction. The surface tests distinguish historical/ended information from unpublished announcements.
- Swift projection/parser/history/transport/concurrency: **24 reported tests passed** across four suites; the opt-in network check is skipped by default. After the final cache-retention correction, the two migration/occurrence checks passed again. The real worker construction and held-download logging-concurrency checks also passed after history injection.
- Rust opportunity-selection identity pool: **6 passed**, including no native authority for recently ended/prefix-only informational records.
- Full `npm run build`: TypeScript, Vite and every existing window graph/CSS/startup-budget check passed. No budget was changed. Final output is preserved as `xlog-dxmap-final-build.log` in the evidence directory below.

## Live comparison

The opt-in test downloaded actual primary NG3K ADXO, 425DXN and Club Log feeds into an empty disposable logbook. The captured response at **2026-10-27 23:43:47 UTC** (28 October Darwin) contained **62 reconciled catalogue operations, all 62 mapped**, with all three sources current. IDs were at most 87 bytes, below the native 128-byte admission limit. S9R appeared once, with **45,614 QSOs**, a **23:41:00 UTC** last QSO, both catalogue source names and an explicitly approximate DXCC position. The Senegal and Honduras operating aliases were present. These are capture-specific values, not continuing-availability claims.

The browser comparison used the real React DXMap and MapLibre components, the actual primary-provider snapshot, and a separately captured public reference-site cluster response for frequency/status comparison. Its explicit browser-only native adapter returned the captured data and refused activation commands. It used no production logbook, credentials or station connections. This is rendered/live-data evidence, not packaged native IPC or physical-radio acceptance.

Compared with `https://iu2vwk.com/dxmap.html`:

- Permanent callsign labels distinguish Live, Active, On air and dashed Upcoming states at world zoom; observed rows add exact displayed frequencies. Label displacement preserves geographic anchors using leader lines.
- Upcoming selected **26 cards and 26 map markers**, all with Upcoming state, replacing the observed installed-app failure of 26 cards and no expedition markers.
- S9R detail showed the actual total/last QSO, source attribution, approximate-position explanation, local callsign/DXCC history and multi-band frequencies.
- Recorded card/marker/filter browsing issued **zero `activate_spot` or `activate_opportunity` commands**.
- Desktop 1440×900 and narrow 480×800 renders were inspected. Narrow cards now retain their full height; the map remains usable above the list. The shared MapLibre marker class is retained rather than replaced.
- The reference has fewer catalogue rows because xLog also includes the independent 425DXN calendar. Different configured cluster observations legitimately produce different instantaneous activity. QSO/h and Watchers remain unavailable, matching the reference's absent data rather than fabricating values. Old Club Log totals are not attached to a future return visit.

## Evidence and limits

Durable evidence directory:

`/Users/oliver/Documents/Backups/OM0RX-xLog/DXpeditionMap-20261028-9e6fd02e/`

It contains the provider snapshot, reference spot response, browser adapter/source data, desktop/upcoming/detail/narrow screenshots, reference screenshot and final build output. Temporary browser files were removed from the checkout before handoff.

The archive regression reopened SQLite after 600 unrelated reports and recovered the expedition report without an activation token. Existing archive gaps and retention still bound available history. The public providers do not establish exact station locations; entity centres are approximate. Physical tuning/readback, multi-display accessibility and a measured long-session profile remain external acceptance gates. The native Normal Logging guard is preserved; contest-mode actions are visibly disabled and explained.
