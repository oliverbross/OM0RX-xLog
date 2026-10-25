# Contest Analytics source acceptance — 25 October 2026

Initial source acceptance: `eb90c71953627c5a3c0f67a38aa444e58bbacbb5`, canonical `main` in `/Users/oliver/Documents/Projects/OM0RX-xLog`, pushed to origin. The initial evidence below describes that source stage. The combined 1.3.13 release update at the end records subsequent fixes and completed installed acceptance separately.

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

At the initial source-acceptance stage, no version bump, package, signature, installation or production log mutation was performed. That historical stage did not replace the user-confirmed 1.3.12 build. Subsequent candidate installation exposed the export failure described below; installed acceptance cannot be inferred from the source checks above.

The remaining design stages are explicitly deferred: spot-based conditional opportunity ranking, raw Cabrillo/ADIF reference import, official LCR/UBN adjudication, comparative geography and measured operating/radio/antenna intervals. No source test or screenshot establishes those capabilities or real station/RF/provider outcomes.

## Combined 1.3.13 release evidence — READY WITH LIMITATIONS

Final application source is `d728e593f034bd4f1bda76cf24e6961dc2f56e6b`.
The first candidate, `de8f91c6b9303d9e63799da194b0de446a40fe12`, passed signing and
disposable packaged-runtime checks but was **rejected** after installed Analytics
JSON export hung in WebKit's Blob download path. The replacement uses a native Save
dialog, bounded admission, explicit cancellation/error feedback and atomic file
replacement. Candidate `bea0467218292f3835e6042710b336bcc675836c` passed installed native Save checks,
but its webview print call did nothing. The final source adds native printing;
signed packaging, installation and final installed native preview/Save as PDF passed.

| Evidence | Result and scope |
|---|---|
| `/tmp/xlog-1313-frontend.log` | 289 files / 4,263 frontend tests passed before the export replacement. |
| `/tmp/xlog-1313-python-final.log` | 339 tests passed after correcting plugin-owned power-category preservation; the initial failed run is retained separately. |
| `/tmp/xlog-1313-rust.log` | 836 native tests passed before the export replacement. |
| `/tmp/xlog-1313-swift.log` | Full portable Swift run passed; portable coverage does not establish hardware behavior. |
| `/tmp/xlog-1313-build-gate.log` | TypeScript, Vite and production window-bundle gates passed for the earlier candidate. |
| Final native export/print focused run | Five tests passed, as reported by the release owner/review agent. Earlier four-export-test archive: `810280b9029c4812`. |
| Final export/print frontend review | Fourteen tests passed, as reported by the release owner/review agent; no separate log path was supplied. |
| `/tmp/xlog-1313-packaged-verification.json` and `/tmp/xlog-1313-installed-verification.json` | Each records 32 passing disposable packaged Python tests (27 CQ WW and five Analytics), correct signatures/runtime receipts and source **de8f91c6**. These are rejected-candidate evidence, not corrected-build acceptance. |

No raw production contact rows are reproduced in this record. Broad suites and
focused post-fix tests remain distinguished; no full-suite rerun after the final
export/print changes is implied.

Final-source receipts `/tmp/xlog-1313-r3-packaged-verification.json` and
`/tmp/xlog-1313-r3-installed-verification.json` each record 32 passing disposable
Python tests (27 CQ WW plus five Analytics), valid deep/strict signatures, matching
component hashes and exact source `d728e593f034bd4f1bda76cf24e6961dc2f56e6b`.
The [sanitized durable receipt](evidence/cq-ww-ssb-1.3.13/release-verification.json)
preserves only bounded metadata, check results, counts and hashes.

The preceding native-Save candidate `bea0467218292f3835e6042710b336bcc675836c`
passed 35 isolated native checks in `/tmp/xlog-1313-r2-native-acceptance.json`,
including contact log/readback, edit/delete/undo, ADIF roundtrip, settings and layout
persistence. These checks are reused because the last application change only
fixes print; the 35-check suite is not claimed as rerun on the final source.

Direct installed UI checks by the release owner on that preceding candidate:

- Analytics displayed 313 contacts; native JSON Save produced 313 rows and filtered
  CSV Save produced eight rows. Cancellation left the window responsive.
- Log Review checked 313 contacts and displayed 106 suggestions, 117 corroborated
  and 93 without corroboration; 33,907 eligible and 143 excluded archive spots.
  The archive warned of unknown loss. CTY and LoTW were available; Club Log was
  missing. The Possible typo filter displayed one result. These findings are
  advisory, not adjudication of contact validity.

Independent read-only preservation check `/tmp/xlog-1313-preservation.json` passed:
all 313 production contact rows, including every column and rowid, match the
pre-install backup. QSO identity and audit tables also match exactly. Both backup
copies agree and SQLite quick checks passed. This point-in-time check does not
claim equality of every production settings/service file.

Final installed Print/PDF passed: the native macOS preview showed two pages;
Save as PDF produced a valid A4, unencrypted, two-page PDF (52,517 bytes), and the
application remained responsive. No physical printing was performed. Physical Flex/Maestro,
RF, PTT, transmitter audio and rotor behavior remain outside these checks.

Final-source direct installed checks by the release owner also confirmed Analytics
opened 313 rows; Main Logging retained 313 contacts, 88 multipliers and claimed
score 35,288, along with its existing draft. Bearing, long-path bearing and distance
were displayed. No draft callsign or raw production contacts are copied here.
The local acceptance PDF is `/Users/oliver/Documents/xlog-1313-acceptance-analytics.pdf`;
it is not included in repository evidence because it contains the operator's report.

**READY WITH LIMITATIONS:** Club Log data was unavailable and spot-archive loss
was unknown; these limitations remain visible in Log Review. Physical Flex/Maestro
behavior was not retested, recorded voice remains untested, and the retained unique
branches need an operator scope decision. Deferred Analytics capabilities remain
outside the delivered scope. No physical printer, RF, PTT, audio or rotor test is
claimed.

Backup: `/Users/oliver/Documents/Backups/OM0RX-xLog-1.3.13-before-install-20261025T064500`.
Rollback: `/Applications/OM0RX-xLog-previous-1.3.12-20261025.app`.
See the [build record](CQ_WW_SSB_1_3_13_BUILD.md) and
[reconciliation](CQ_WW_SSB_RECONCILIATION_2026-10-23.md) for consolidation boundaries.

Final-source follow-up: JSON export after Print/PDF saved successfully and read back
313 rows with 313 unique IDs. Contest Cluster showed ShackCQ connected and live SSB
spots. Main Logging was left focused. The two superseded 1.3.13 candidate bundles
were removed; the signed 1.3.12 rollback remains.

## 1.3.14 follow-up — DXpedition Map and Flex delivery

**READY WITH LIMITATIONS.** Installed source is
`0c2b564868cc7999f7674b65b1643b56c10a18c0`, version 1.3.14. The user reported
missing Flex spots in 1.3.13; that earlier unverified result is superseded by the
1.3.14 operator confirmation: “Yes, spots are visible.” The accepted radio
inventory grew from 10 to 33 after restart, demonstrating ongoing arrivals.

The release adds the reviewed DXpedition Map (Window → DXpedition Map), fixes
classification starvation and coalesces queued radio publications without
interrupting valid chunk transactions. Independent review cleared the final
forwarding delta. All 15 focused forwarding tests, typecheck, 32 packaged Python
tests and 35 isolated native acceptance checks passed. The broader workspace
run had 195 passes and two timeouts; both timed-out voice simulations passed
isolated reruns. No physical voice/audio/PTT/RF/rotor check is claimed.

Fresh preservation verified all 323 QSO rows, stable identities and audit rows
unchanged before relaunch. Existing contest windows and connected ShackCQ cluster
returned. Settings remain in the original namespace. The old settings-safety
patch was deferred because its second settings store conflicts with the integrated
schema; its unique work is preserved. DXpedition's installed visual check is
deferred while the operator is actively contesting. Long-duration physical marker
renewal and remaining legacy branch cleanup are not claimed complete.

Full [1.3.14 build and acceptance record](CQ_WW_SSB_1_3_14_BUILD.md), with
[sanitized exact-source evidence](evidence/cq-ww-ssb-1.3.14/release-verification.json).
Backup: `/Users/oliver/Documents/Backups/OM0RX-xLog-1.3.14-before-install-20261025T093000`.
Rollback: `/Applications/OM0RX-xLog-previous-1.3.13-20261025.app`.
