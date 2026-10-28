# DXpedition Map repair acceptance — 28 October 2026

## Source and scope

Canonical source changes are pushed on `main`:

- `3840d316`: catalogue identity, published portable aliases, approximate entity positions, primary Club Log enrichment, archive reader and informational-row native authority.
- `28515ae8`: shipping LiveWorker injection of its own cluster's durable history reader.
- `d96c8c4f`: one-time old-catalogue parser refresh, retirement of withdrawn active records, and explicit IOTA conflict protection.
- `9e6fd02e`: permanent callsign/status/frequency callouts, collision displacement, historical activity and local history/details, disabled contest actions, narrow layout and regression tests.

The final shared-map follow-up gives an exact selected occurrence ID precedence over the prior callsign when centring the map; separate visits no longer centre on the earlier visit. Ended-operation messaging is distinct from an unpublished-callsign announcement.

The separate Finish-Line chat owns the version, canonical package, signing and native UI lane. It requested a frozen tested source handoff for the combined 1.3.58 candidate. No app was packaged or installed by the DXMap repair chat, and no native UI or radio was used during these repairs. Installed acceptance must be recorded against the exact resulting package separately.

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
