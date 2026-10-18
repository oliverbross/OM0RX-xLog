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

`pending-updates.json` records evidence measured after the published snapshot; it does not regenerate or alter that snapshot. The aggregate remains 16 previews, 78 pending and zero complete, with 94 metadata-only records; seven declarative definitions remain inactive. The accepted exclusive operating-module integration is `223f395a817409cb7de678870c42c8f31c4cbd9e`, a conflict-free merge of harness milestone `1ab9debbfdfa3d64c31928c06af94692ad580452` and module/main-1.2.22 integration `cb41607e0919fd0946788fc9f42e9cb29c9db104`, with verified tree `096160d7493c7ef9c0d41d63e2e50d38c98f0e1d`. Root verified 200 frontend tests across 20 Vitest files, TypeScript and production build; Swift test listing compiled and discovered 880 tests but did not execute them. The discovery output is preserved at `/Users/oliver/.local/share/lean-ctx/archives/c1/c15f4498b37277f5.txt` (SHA-256 `51122a30d7e81ccb7607386ac4a9c268786a1173064ebb74dfb217ff8a735b9d`). The merged parent `cb41607` now has all six native CI jobs passing in `39089798983`, and regular CI `39089798991` passed. Background-ingress ownership and packaged restart remain open, so no full module, package, install or RF acceptance is implied. Generic definition activation remains unaccepted while nondefault modes, legacy camel-case identity and 74-byte aggregate handling are repaired. Main `1.2.22` at `6c4dd993fd42f78d030a0e674f830ff339380842` remains the latest accepted installed baseline. Main `1.2.23` remains under installed HF/RBN UI refinement, including scrolling and sizing; this record does not establish final runtime acceptance or resolve startup behavior. Operator diagnostic 7 passed its scoped run (85 frames, six commits, four exports, protected database metadata unchanged), but it is not full acceptance. The larger dev30 run failed: 1,018 frames, 84 commits, 42 reservations, 56 exports and 14 corrections; the protected Integrated Preview shared-memory file's metadata changed during the run, with no writer attribution, so the run is not accepted. The builder does not apply these source updates automatically; review the evidence boundaries before changing the pinned snapshot.

## Evidence boundary

This source reproduces the fixed 94-contest and 33-feature report and its stated evidence boundary. Later native test runs, branch changes, and runtime/device outcomes remain separately identified in `pending-updates.json`; they require explicit evidence review before updating any report claim. The open workbook lock is preserved, and the published snapshot and generated outputs remain unchanged.
