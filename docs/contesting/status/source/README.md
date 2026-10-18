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

`pending-updates.json` records evidence measured after the published snapshot; it does not regenerate or alter that snapshot. The aggregate remains 16 previews, 78 pending and zero complete, with 94 metadata-only records; seven declarative definitions remain inactive. The exclusive operating-module/main-1.2.22 integration is accepted, committed and pushed as `cb41607e0919fd0946788fc9f42e9cb29c9db104` from verified source tree `d145e4afeacb07b3c65dc167a74ce0bf68d14895`; source checks and build passed, while the parent source checkpoints `3c7a618` and `f734158` each passed all six native CI jobs (`39087782113`, `39088234545`). Do not infer a fresh CI pass for `cb41607`. Generic definition activation remains under repair for supported nondefault modes, persisted identity spelling and descriptor-sized exchange aggregates. Full module acceptance still requires background-ingress ownership and packaged restart. Main `1.2.22` at `6c4dd993fd42f78d030a0e674f830ff339380842` remains the latest accepted installed baseline. The `1.2.23` candidate's map labels were visually accepted, but a history-panel startup issue remains under investigation; runtime/source SHA and final release acceptance are pending. Operator diagnostic 7 passed its scoped run (85 frames, six commits, four exports, protected database metadata unchanged), but it is not full acceptance. The larger dev30 run failed: 1,018 frames, 84 commits, 42 reservations, 56 exports and 14 corrections; the protected Integrated Preview shared-memory file's metadata changed during the run, with no writer attribution, so the run is not accepted. The main task also reports UI rebuild and startup investigation in progress. The builder does not apply these source updates automatically; review the evidence boundaries before changing the pinned snapshot.

## Evidence boundary

This source reproduces the fixed 94-contest and 33-feature report and its stated evidence boundary. Later native test runs, branch changes, and runtime/device outcomes remain separately identified in `pending-updates.json`; they require explicit evidence review before updating any report claim. The open workbook lock is preserved, and the published snapshot and generated outputs remain unchanged.
