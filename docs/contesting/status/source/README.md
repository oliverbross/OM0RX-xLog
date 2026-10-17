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

`pending-updates.json` records evidence reported after the published snapshot, including the two newly pending integrated-source runs and the NAQP review boundary. It is a review queue only; the builder does not apply it automatically. Resolve pending runs and the NAQP repair, then update the pinned source and report claims deliberately.

## Evidence boundary

This source reproduces the fixed 94-contest and 33-feature report and its stated evidence boundary. Later native test runs, branch changes, dirty development results and production/runtime outcomes require an explicit evidence review before updating any report claim.
