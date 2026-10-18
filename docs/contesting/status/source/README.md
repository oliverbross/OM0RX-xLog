# Contesting status report source

This folder contains the reproducible source for the 18 October 2026 contesting parity snapshot. The published workbook and status note remain at the parent directory.

## Rebuild

Use Node.js with `@oai/artifact-tool` available. With the Codex bundled runtime, create a writable working directory and link its `node_modules` to the bundled package directory:

```sh
mkdir -p /tmp/xlog-parity-report-run
ln -s /Users/oliver/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules /tmp/xlog-parity-report-run/node_modules
cp -R /path/to/OM0RX-xLog/docs/contesting/status/source /tmp/xlog-parity-report-run/source
mkdir -p /tmp/xlog-parity-report-run/output
```

Run the copied builder with explicit source and output paths, add native Excel hyperlink relationships, then reopen and inspect the workbook:

```sh
XLOG_REPO_ROOT=/path/to/OM0RX-xLog XLOG_REPORT_OUTPUT_DIR=/tmp/xlog-parity-report-run/output node /tmp/xlog-parity-report-run/source/build.mjs
python3 /tmp/xlog-parity-report-run/source/native_links.py /tmp/xlog-parity-report-run/output/CONTESTING_PARITY_MATRIX_2026-10-18.xlsx
node /tmp/xlog-parity-report-run/source/reopen_final.mjs /tmp/xlog-parity-report-run/output/CONTESTING_PARITY_MATRIX_2026-10-18.xlsx
```

The builder writes the workbook, Markdown report, generated hyperlink manifest, six sheet previews and verification JSON to the selected output directory. It keeps the published snapshot cutoff fixed and records the actual build time separately in `verification.json`. `native_links.py` patches the exported XLSX package with native hyperlinks because the Artifact Tool version used for this report did not support hyperlink authoring. The final reopen step checks the row counts, summary values, IDs and formula errors, and exits with an error if the scan is not clean.

Set `XLOG_REPO_ROOT` when running from a different checkout, and `XLOG_REPORT_OUTPUT_DIR` to redirect every generated file. The source reads the exact recorded Git snapshots with `git show`; it uses product commit `34de5291eb067aa8387a5a0032e3a038534f1ab0`, documentation checkpoint `3a5864e8b937625249f2ec01b4607d316ef6d3fd`, and Python comparator commit `7c8b499225a73f7f8f792246881bd7aefc05452f`. A replacement snapshot requires deliberate updates to those pins and the evidence text.

For a non-destructive reproduction, point `XLOG_REPORT_OUTPUT_DIR` to a new temporary directory before running `build.mjs`; pass that directory's workbook to both follow-up scripts. The status note preserves the original cutoff and report claims. Verification metadata records the current build time.

`native-links.json` records the hyperlink manifest used for the published snapshot. Normal builds produce a fresh `native-links.generated.json` beside the output workbook.

## Proposed next refresh

`pending-updates.json` records evidence measured after the published snapshot. Baseline `52ef5d3` passed all six native jobs plus regular CI. Operator capability `fc973c5`, shared unique-call `4d77f94`, and shared-policy integration `74ef3ba` passed their recorded native and regular workflows. The catalog remains at 16 previews; separately, seven declarative definitions are inactive. History UI source `8ff0e531` passed focused worker/frontend checks and build. Its integration `22857aa98a6dce1f4684937443f017866cdc8cd8` is reviewed, committed and pushed on top of `74ef3ba`; local checks passed 155 core, 80 store and 63 support tests (298 distinct selected; the repeated 30-test focused run is not counted again), 198 frontend tests, two Node assertions and production build. Hosted native CI remains pending. NAQP `52ef5d3` has a root-reviewed bounded synthetic rehearsal: six sessions, 345 ordinary and three lifecycle frames, 26 commits, 14 parsed exports and 82 simulated outputs; it provides no package, RF, native chooser or sponsor acceptance. The 14-profile/84-contact harness remains development-only, and the seven-definition v2 export candidate is frozen pending review. The main task reports 1.2.21 installed while runtime fixes continue; no final accepted source SHA has been handed off, and 1.2.22/1.2.23 remain in progress. Metadata stays at 94 metadata-only records; the catalog remains 16 previews, 78 pending and zero fully ported. The builder does not apply these source updates automatically; review the exact evidence boundaries before changing the pinned snapshot.

**Reconciliation measured 18 October 2026:** the stale main-release statements above describe the proposal-time snapshot and are superseded by `contesting/evidence/noncontest-main-baseline-2026-10-18.json` and `contesting/evidence/cqww-feedback-package-2026-10-18.json`; these receipts do not change the separate historical CI results. The latter verifies the separately identified Contesting Test app installed and launched from source `3a05c2e6778a1ec86326eb5466eef51d37fca7f3`, reviewed contest source `bf2fa2cefe038fc6e7b7c6df228f7be7b7ffa5f3`, over accepted main baseline `b9accc7f81453f1f2cab1758a48192322213f590`. Bounded native observations cover CW Run DL1AAA (zone 14) and K1AAA (zone 5), CW S&P JA1AAA (zone 25), three CW QSOs/seven points/six multipliers/score 42, duplicate blocking, and a native Cabrillo with three CW QSOs and score 42. Root inspected the three CW ADIF records for call, band, mode and exchange. SSB Run covered DL1AAA (zone 14) and K1AAA (zone 5); SSB S&P covered VK2AAA (zone 30) with MYCALL and exchange 59/15 confirmed, for four QSOs/ten points/eight multipliers/score 80. Plain Log covered JA1AAA (zone 25). A seven-record SCP fixture imported, K1A→K1ABC selection worked, and reports/frequency/exchange persisted. After restart, manager cards recovered CW 3 and SSB 4; reopening SSB restored four QSOs/ten points/eight multipliers/score 80 at 14.250 MHz, report 59, sent zone 15, and all seven SCP records. The run ended disarmed with trace cleared. Native ADIF and Cabrillo hashes are recorded in `pending-updates.json`. This is a bounded native smoke, not full all-contest acceptance. The 14-profile plus 11-profile headless matrix is underway. SST worker tests are frozen pending review; SST is inactive. Preserve the published status Markdown/workbook cutoff and ledger at 16 previews / 78 pending / 0 complete. macOS is the current app-build scope; Windows/Linux app builds are deferred by user direction, while the plan's ultimate cross-platform goal remains.

## Evidence boundary

This source reproduces the fixed 94-contest and 33-feature report and its stated evidence boundary. Later native test runs, branch changes, and runtime/device outcomes remain separately identified in `pending-updates.json`; they require explicit evidence review before updating any report claim. The open workbook lock is preserved, and the published snapshot and generated outputs remain unchanged.
