# Contest Analytics source acceptance — 25 October 2026

Application source: `eb90c71953627c5a3c0f67a38aa444e58bbacbb5`, canonical `main` in `/Users/oliver/Documents/Projects/OM0RX-xLog`, pushed to origin. This record changes documentation and a bundle-gate explanatory comment only; the application implementation remains that source commit.

Related pushed commits: `aac7c332` (wall-clock Rates/UTC boundaries/unknown attribution); `29cb8346` and `b68fbf01` (existing host-test expectation drift after `b70ba7f9` added hydrated country identity). The full host suite passes after those expectation repairs, preserving direct stored-row and audit comparisons.

## Delivered and checked

The [feature guide](CONTEST_ANALYTICS.md) defines the initial delivered scope and deferred stages. The new native menu entry and dedicated renderer/bridge are present in source. The host remains the score authority and sole QSO writer; the analytical copy is bounded, revision-consistent and read-only.

| Check | Observed result |
|---|---|
| `npm run test:vitest -- src/contesting` | 61 files / 1,005 tests passed, including live entry, detached windows, routing, protocol, Log Review and Analytics. Existing React `act` warning in the ESM test remains non-fatal. |
| New cross-tab pagination regression, run separately after adding it | 1 test passed; both row and column pages recover after scope reduction. |
| Final focused analytics semantic/UI run | 19 tests passed, including equivalent elapsed comparison intervals and preserving full timeline extent after band filtering. Service tests also pass in the wider run. |
| Python `test_host` | 65 passed. |
| Python `test_analytics.AnalyticsHostTests`, `test_rates`, `test_cq_ww_ssb_host` | 34 passed; new analytics module alone subsequently 4/4. |
| `XLOG_PORTABLE_ONLY=1 swift test --filter PythonContestLaneTests/testAnalyticsSnapshotThroughRealPythonBridgeKeepsDraftAndLogSeparate` | 1 real Swift → Python bridge test passed against a disposable contest root; copied contact/zone/band and stable identity after callsign typing/lazy country hydration verified. |
| `cargo test contest_analytics::tests` | Label/method/page admission test passed; native target compiled. Existing unrelated dead-code warnings remain. |
| `npx tsc --noEmit` and `npm run build` | Passed, including production window-bundle checks. Analytics UI/worker do not enter ordinary-window eager graphs and do not import the live station controller/map. Measured Logbook graph: 402,470 bytes, bounded by 402,750. |
| 10,000-contact pure prepare + aggregate probe | Approximately 54.5–84.2 ms across local runs. This is local aggregation time, not end-to-end refresh latency, writer latency or a WAN/RF measurement. |

Real Web Worker browser rehearsal used synthetic 10,000-contact / 47-hour data. Desktop 1440×1000 and narrow 640×800 captures showed no page-level horizontal overflow; the long timeline/cross-tab have their own horizontal scroll. Selecting a cross-tab cell opened exactly its contributing copied contact with stable ID, UTC and read-only scope. The rehearsal fixture is retained at `prototype/tests/fixtures/analytics-rehearsal.html` with its TSX generator for reproducibility; it is not a production entry or demonstration mode in the packaged application.

An independent Impeccable finish review identified heatmap text contrast, mismatched comparison time scopes and pagination after filtering. The bounded verdict pass scored all three resolved: heatmap contrast approximately 6.29:1 at maximum fill, equivalent elapsed intervals for both logs, and both page indexes resetting when scope/dimensions change. This verdict covers those listed fixes only. The existing PRODUCT.md/DESIGN.md visual system was preserved.

Screenshots are synthetic evidence, not Oliver's real contest result:

- [Overview, desktop](evidence/analytics-2026-10-25/overview-desktop.png)
- [Overview, narrow](evidence/analytics-2026-10-25/overview-narrow.png)
- [Explorer, desktop](evidence/analytics-2026-10-25/explorer-desktop.png)
- [Explorer, narrow](evidence/analytics-2026-10-25/explorer-narrow.png)

## Release boundary

No version bump, package, signature, installation or production log mutation was performed. The user-confirmed working 1.3.12 installation remains the operating build. Native menu/window IPC in an installed candidate, actual CSV/JSON downloads in that webview, native print/PDF, Log Review's installed path and existing Flex spot visibility still require the coordinated versioned candidate acceptance.

The remaining design stages are explicitly deferred: spot-based conditional opportunity ranking, raw Cabrillo/ADIF reference import, official LCR/UBN adjudication, comparative geography and measured operating/radio/antenna intervals. No source test or screenshot establishes those capabilities or real station/RF/provider outcomes.
