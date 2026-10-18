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

`pending-updates.json` records evidence measured after the published snapshot; it does not regenerate or alter that snapshot. The published acceptance ledger remains 16 previews, 78 pending and zero complete, with 94 metadata-only records. The accepted source composition `6b51b9a0ac3947bf7c221f51291335867819efdb` combines main 1.2.23, activation/module/background ownership and Windows shutdown tests. It passed exact-composition regular CI `39093928513` and all six native jobs `39093928563`; six local shutdown and ten Rust module tests also passed. Its parent shutdown source `10674b6f0096bc2a4cdd17c183390035c6dca6ee` separately passed regular CI `39092778910` and all six native jobs `39092778957`, including six executed Windows shutdown tests. Policy correction `e61e7cc5e5ba55d923467e4480aed873dc96617d` restores v1 factory bytes/nil policy and keeps archive-v2 opt-in; regular CI `39093463886` and all six native jobs `39093463831` passed.

Source composition `0bb2938a86259763237446833ce7b04770543ef2` combines `db8fd6f` with SAC fix `4bd897b`, with 192 frontend, 41 Swift, 75 Rust and build passing; root reviewed and pushed it, while CI and incorporation of the latest installed receipt remain pending. `db8fd6f` regular CI passed; native CI had three jobs pass, two macOS/Linux Swift failures from stale capability-count assertions (expected 14 vs current 21), and Windows Swift was still running. Geographic `7631fa9` CI is running and strict authoring bridge `8c46355` CI is queued. Seven additional definitions remain integration work and do not increase accepted catalog counts. SST geographic core does not activate SST. The sponsor’s [SST page](https://www.k1usn.com/sst) links its developed [N1MM UDC](https://n1mmwp.hamdocs.com/mmfiles/k1usnsst-udc/) and records that the DC multiplier was added in UDC version 1.1.4; the [FAQ](https://www.k1usn.com/sst_faq.html) and [published FAQ document](https://docs.google.com/document/d/e/2PACX-1vQE0mZkKt5qr-KJ1B7cfOgfgPcCfghxT-jIZd2JomJp1kNelaIAyvyZEViq1sB9aYm3IezL-abEPsi4/pub?embedded=true) describe an NL-to-NF workaround and 3830 score-summary reporting rather than Cabrillo/ADIF submission. Primary table and full membership/province authority remain under review. Latest accepted installed 1.2.23 is source `23d0dee04f2a5c7ca3a733b3b60f1b859beeb851`, receipt `f84c4975fccb5ae3c021b2a09bd86b938ddbb053`; root verified strict deep signature and installed host/worker hashes. New RBN datasource mismatch work is unaccepted WIP. The published acceptance ledger remains 16 previews, 78 pending and zero complete; generic runtime and full operator acceptance remain open.

Latest accepted installed main 1.2.23 is source `23d0dee04f2a5c7ca3a733b3b60f1b859beeb851`, receipt `f84c4975fccb5ae3c021b2a09bd86b938ddbb053`; root verified host SHA-256 `ea906cadd1c1d427fe2f5c6c5e3bf15c1798a1320ae0388752ac5d0da3454d48`, worker SHA-256 `31982ec08d2762c800c323dc8c9cf57102e348062ddf415b38b9e7376b303c88`, and strict deep signature. New RBN datasource mismatch work is unaccepted WIP. Main previously reported 3,120 UI tests across 219 files. db8fd6f adds source-level actual-mode context, structured RST for JIDX/ARRL DX and generic recovery; its CI is not green and full runtime/operator acceptance remains open. SST remains unactivated pending primary-table and full membership/province authority review. A 74-byte read/correction is proven separately; archive exports use projection-safe corrected widths. Operator diagnostic 7 passed scoped checks; dev30 failed after 1,018 frames, 84 commits, 42 reservations, 56 exports and 14 corrections when Integrated Preview SQLite shared-memory file metadata changed during the run. Its writer is unattributed and no user-data mutation is claimed. Full 94-entry and F01-F33 acceptance remains incomplete. The builder does not apply these source updates automatically; review evidence boundaries before changing the pinned snapshot.

## Evidence boundary

This source reproduces the fixed 94-contest and 33-feature report and its stated evidence boundary. Later native test runs, branch changes, and runtime/device outcomes remain separately identified in `pending-updates.json`; they require explicit evidence review before updating any report claim. The open workbook lock is preserved, and the published snapshot and generated outputs remain unchanged.
