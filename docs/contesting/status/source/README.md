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

`pending-updates.json` records evidence measured after the published snapshot; it does not regenerate or alter that snapshot. The published acceptance ledger remains 16 previews, 78 pending and zero complete, with 94 metadata-only records. The accepted activation/module composition `9a8828b5ee8c0520fbe53c4082fd8750b1f1a2d7` combines bounded seven-definition archive workflows and module ownership. Focused validation passed 206 contesting tests, 176 normal-workspace tests, four activation tests, 22 lane tests and build; generic worker/UI, Run/Search-and-Pounce and full operator/runtime/package/sponsor acceptance remain open. Its parent module/main composition `223f395a817409cb7de678870c42c8f31c4cbd9e` passed regular CI `39090685463` and all six native jobs `39090685461`. Background ownership checkpoint `843c116842f7b76589ed6f3eaa62cb51d0b92abd` passed 28 XCTest, 16 SwiftTesting, six Rust shutdown and ten Rust module tests, regular CI `39091795937` and all six native jobs `39091795941`. The accepted activation/module/background-ownership composition `227c89351b4d262a1f5b38282f08e6f78b74ba8f` has root-verified 56 Swift and 16 Rust tests; composition with accepted main 1.2.23 is being prepared. Windows shutdown source checkpoint `10674b6f0096bc2a4cdd17c183390035c6dca6ee` adds six required Windows workflow tests for direct-child shutdown contracts; six local macOS checks passed, while exact-source Windows CI is pending.

Main 1.2.23 source `ea382fd14cada07160d99bb26411f54c43fe2e25` with receipt `27f8d19` is the latest accepted installed baseline. Root verified installed version 1.2.23, host/worker hashes, strict signature and live processes. Core operator policy source `7d94cff4c3312089de20587c284e17bc5ef95045` is not accepted: 24 focused tests passed, but regular CI `39092434727` failed three legacy CW digest assertions. Preserve legacy v1 factory bytes and inertness, opt into archive v2 explicitly, then rerun the full core suite. Declarative activation docs and manifest are pinned to source commit `badfdbbe4916bffc329e05713e432613b1fe14fd`: [scope](https://github.com/oliverbross/OM0RX-xLog/blob/badfdbbe4916bffc329e05713e432613b1fe14fd/docs/contesting/DECLARATIVE_CONTEST_ACTIVATION.md) and [evidence](https://github.com/oliverbross/OM0RX-xLog/blob/badfdbbe4916bffc329e05713e432613b1fe14fd/docs/contesting/evidence/declarative-contest-activation-2026-10-18.json), manifest SHA-256 `022b01d83d4b76dc06f688814b758c942c32855d7a21094bc31a85bac7f0dd05`. A 74-byte read/correction is proven separately; archive export values use projection-safe corrected widths, with no 74-byte export claim. Operator diagnostic 7 passed scoped checks; dev30 failed after 1,018 frames, 84 commits, 42 reservations, 56 exports and 14 corrections when Integrated Preview SQLite shared-memory file metadata changed during the run. Its writer is unattributed and no user-data mutation is claimed. Full 94-entry and F01-F33 acceptance remains incomplete. The builder does not apply these source updates automatically; review evidence boundaries before changing the pinned snapshot.

## Evidence boundary

This source reproduces the fixed 94-contest and 33-feature report and its stated evidence boundary. Later native test runs, branch changes, and runtime/device outcomes remain separately identified in `pending-updates.json`; they require explicit evidence review before updating any report claim. The open workbook lock is preserved, and the published snapshot and generated outputs remain unchanged.
