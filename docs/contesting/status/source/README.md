# Contesting status report source

This folder contains the reproducible source for the 18 October 2026 contesting parity snapshot. The published workbook and status note remain at the parent directory.

## Latest source-only refresh — 18 October 2026, 07:53 UTC

Corrected package `5024b2c` is installed and launches in the isolated Contesting Test app; the original normal app remains unchanged. Saved CQWW SSB opens with 4 QSOs, 10 points, 8 multipliers and score 80, and the panel selector works. A bounded draft check typed W1AW, switched to Statistics and back to Entry, and preserved W1AW with simulation disarmed; this proves panel switching only, not geometry, restart recovery or detached-child acceptance. Native canvas acceptance **FAILED**: the transport fallback is absent, the app remains a compact single-panel selector with large unused canvas at 1440×940 and native zoom 3840×2160, and movable/resizable multi-panel headers are absent. The earlier framed-envelope mismatch and safe fallback are recorded in `docs/contesting/evidence/operator-desk-canvas-package-2026-10-18.json` at `dc2f601`. Corrected-package native QA receipt: `docs/contesting/evidence/operator-desk-canvas-response-fix-2026-10-18.json`, committed and pushed at `76a6bb3`. Fix `703bc56` is reviewed and merged at `5024b2c`; 42 independent Canvas/Workspace tests and TypeScript compilation passed. A separate frontend fix is in progress, so full canvas acceptance remains open. RBN `4bb5571` integrated at `935816d` with 29 Swift and 41 UI checks plus TypeScript passing. Native bridge `0ac1c68f0053e533d46bfcbce0cd5d2a02fb043b` is isolated and queued for review; CQWW activation `e642d64e14a371d94f6fe9a0d3468e885208176b` is isolated and under review after correcting the oracle for African Italy IG9/IH9 versus Sicily. Country-resource materialization `1be403` and lifecycle `2ab979` are integrated. Keep the ledger at 16 previews / 78 pending / 0 complete; extra CQWW preview profiles do not increase full-port parity. macOS only, RF disabled, and the original app remains user-controlled.

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

## Historical refresh notes

This 07:09 UTC checkpoint is retained below as dated historical evidence; the newer source-only refresh above supersedes its current-state wording.

## Historical source evidence — 07:09 UTC

`pending-updates.json` records evidence measured after the published snapshot. The historical baseline `52ef5d3` passed all six native jobs plus regular CI; subsequent shared-policy and history UI results are separately recorded there. The catalog ledger remains 16 previews / 78 pending / 0 fully ported; SST is the eighth bundled declarative definition at source level. The 14-profile/84-contact legacy headless rehearsal passed. The 11-profile/66-contact declarative workflows functionally completed, but their protection gate remains unresolved/failed after concurrent normal-database metadata changed without process attribution; the evidence does not establish that the headless process touched the normal database. Current source receipts include scoped layout isolation, native registry scope validation, a four-panel shared-owner canvas, ARRL DX editable intermediate KI input with strict wire/commit validation, and integrated 30dcdab42bb0337aee9c60e816d6b151d6b453ce/Special filters. Combined source `e22cf95` passed 181/181 tests across 12 files plus TypeScript compilation; the exact receipt preserves the historical 70/71 failure and isolated 26-pass result and records the bounded wait fix passing in combined source. These changes are not in installed Test app source `3a05c2e`. Native runtime `1050a5b` + `2ae19aa` and CQWW country materialization `806873e` remain under review; no bridge/child parity is claimed, and the generated 362-endpoint resource is not active in catalog, worker or UI. SST source `cb18f8f` was reviewed and merged/pushed at `8e2ac9b`, but installed app still has seven definitions. Preserve the published ledger and avoid treating the 94-entry metadata as a completion percentage. The builder does not apply these source updates automatically; review exact evidence boundaries before changing the pinned snapshot.

**Reconciliation measured 18 October 2026, source refreshed 16:39 ACST (07:09 UTC):** published historical snapshot remains distinct from current source evidence. Installed Test app is still `3a05c2e` over accepted baseline `b9accc7`. Bounded CQWW observations remain CW Run/S&P (three QSOs, seven points, six multipliers, score 42) and SSB Run/S&P/Plain Log (four QSOs, ten points, eight multipliers, score 80), with duplicate blocking, SCP selection, exports and restart recovery observed; this is not full all-contest acceptance. New source work includes scope isolation merged `18c8ba1`, native registry validation `5e43c53`, four-panel canvas `e0026bc` merged `b6d9e3b4` (eight remaining upstream windows), ARRL DX editable-input fix `7b0ed2d` merged `e22cf95`, and integrated 30dcdab42bb0337aee9c60e816d6b151d6b453ce/Special filters. Combined `e22cf95` passed 181/181 tests across 12 files and TypeScript compilation; receipt `contesting/evidence/main-spot-settings-integration-2026-10-18.json` records the historical 70/71 failure, isolated 26-pass result, and bounded 3000 ms wait fix passing in combined source. These changes are absent from installed `3a05c2e`. Native runtime `1050a5b` + `2ae19aa` remains UNDER REVIEW with concurrency fixes pending; no bridge/child parity claim. CQWW country materialization `806873e` remains UNDER REVIEW pending legacy-token matching; 362 endpoints are generated but not active in catalog/worker/UI. Headless result remains 14 legacy profiles (84 contacts) passed and 11 declarative profiles (66 contacts) functionally completed with protection failed/unresolved after un-attributed concurrent database metadata changes; this does not establish the headless process touched the normal database. SST source remains integrated while installed app retains seven definitions. Preserve the published status/workbook cutoff and ledger at 16 previews / 78 pending / 0 complete. Metadata counts are not completion percentages. macOS is current app scope; Windows/Linux builds remain deferred.

## Evidence boundary

This source reproduces the fixed 94-contest and 33-feature report and its stated evidence boundary. Later native test runs, branch changes, and runtime/device outcomes remain separately identified in `pending-updates.json`; they require explicit evidence review before updating any report claim. The open workbook lock is preserved, and the published snapshot and generated outputs remain unchanged.
