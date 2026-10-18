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

`pending-updates.json` records evidence measured after the published snapshot; it does not regenerate or alter that snapshot. The published acceptance ledger remains 16 previews, 78 pending and zero complete, with 94 metadata-only records. The accepted source composition `6b51b9a0ac3947bf7c221f51291335867819efdb` combines main 1.2.23, activation/module/background ownership and Windows shutdown tests. It is conflict-free; root verified source/log hashes; six local shutdown and ten Rust module tests passed. Windows CI `39092778957` (all six jobs, including Windows job `117572842233` with six executed shutdown tests passed) and regular CI `39092778910` passed for parent source checkpoint `10674b6f0096bc2a4cdd17c183390035c6dca6ee`; exact-composition CI for `6b51b9a` is pending. The main composition `6c3b09cc88891fe5a0c31f246a7e90507262497a` passed isolated UI/workspace and Swift/Rust checks, TypeScript and build, but combined frontend had four failures and a serial workspace async-lookup failure; no full clean frontend or operator claim is made. Policy correction `e61e7cc5e5ba55d923467e4480aed873dc96617d` restores v1 factory bytes/nil policy and keeps archive-v2 opt-in. Its regular CI `39093463886` passed; native run `39093463831` has five jobs passed and Windows Swift still pending. Full-core 170 and store/export 16 passed on a broader candidate, not proven against the exact committed tree. Generic worker/UI, runtime and full operator acceptance remain open.

Main 1.2.23 source `ea382fd14cada07160d99bb26411f54c43fe2e25` with receipt `27f8d19` remains the latest accepted installed baseline. Root verified installed version 1.2.23, host/worker hashes, strict signature and live processes. Policy correction `e61e7cc5e5ba55d923467e4480aed873dc96617d` restores historical v1 bytes and nil policy while retaining archive-v2 opt-in; regular CI passed, portability remains pending Windows Swift. Earlier `7d94cff` CI failure remains historical. Main release composition has isolated UI/workspace and native checks, but combined frontend had four failures and serial workspace async-lookup failure. The full frontend and full operator acceptance have not passed. Generic runtime work on actual-mode context, structured RST inclusion for JIDX/ARRL DX and mixed CW/SSB descriptors remains underway. SST geography is under review only: source SQL scored 84 against official sample 120, so it is not activated. Current RBN/Spotted sidebar and propagation changes in main are unaccepted WIP. A 74-byte read/correction is proven separately; archive exports use projection-safe corrected widths. Operator diagnostic 7 passed scoped checks; dev30 failed after 1,018 frames, 84 commits, 42 reservations, 56 exports and 14 corrections when Integrated Preview SQLite shared-memory file metadata changed during the run. Its writer is unattributed and no user-data mutation is claimed. Full 94-entry and F01-F33 acceptance remains incomplete. The builder does not apply these source updates automatically; review evidence boundaries before changing the pinned snapshot.

## Evidence boundary

This source reproduces the fixed 94-contest and 33-feature report and its stated evidence boundary. Later native test runs, branch changes, and runtime/device outcomes remain separately identified in `pending-updates.json`; they require explicit evidence review before updating any report claim. The open workbook lock is preserved, and the published snapshot and generated outputs remain unchanged.
