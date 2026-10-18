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

`pending-updates.json` records evidence measured after the published snapshot. The historical baseline `52ef5d3` passed all six native jobs plus regular CI; subsequent shared-policy and history UI results are separately recorded there. The catalog ledger remains 16 previews / 78 pending / 0 fully ported; SST is now the eighth bundled declarative definition at source level, separate from installed-app acceptance. The 14-profile/84-contact legacy headless rehearsal passed. The 11-profile/66-contact declarative workflows functionally completed, but their protection gate remains unresolved/failed after concurrent normal-database metadata changed without process attribution; the evidence does not establish that the headless process touched the normal database. SST source `cb18f8f` was reviewed and merged/pushed at `8e2ac9b`; root reviewed 41 Swift tests, 13 TypeScript tests, TypeScript compilation and fixture equality. This source-level integration does not update the installed Test app, which retains seven definitions. The main release and native CQWW evidence are reconciled below. Metadata remains 94 metadata-only records; that figure is not a completion percentage. The builder does not apply these source updates automatically; review exact evidence boundaries before changing the pinned snapshot.

**Reconciliation measured 18 October 2026:** the proposal-time main-release statements above are superseded by `contesting/evidence/noncontest-main-baseline-2026-10-18.json` and `contesting/evidence/cqww-feedback-package-2026-10-18.json`; these do not change historical CI results. The package receipt verifies the separately identified Contesting Test app installed/launched from source `3a05c2e6778a1ec86326eb5466eef51d37fca7f3`, over accepted main baseline `b9accc7f81453f1f2cab1758a48192322213f590`, with separate bundle and support roots. Bounded native observations cover CW Run/S&P, three QSOs/seven points/six multipliers/score 42 and duplicate blocking; SSB Run, S&P and Plain Log total four QSOs/ten points/eight multipliers/score 80. Cabrillo and ADIF exports, seven-record SCP selection and restart recovery were observed; this is not full all-contest acceptance. The manager-card refresh repair `c4620a3` merged at `7d8768d`, but is not installed. Headless evidence records 14 legacy profiles (84 contacts) passed and 11 declarative profiles (66 contacts) functionally completed; the declarative protection gate is unresolved/failed after concurrent normal-database metadata changed without process attribution. It does not establish that the headless process touched the normal database. SST source `cb18f8f` merged/pushed at `8e2ac9b` as the eighth bundled declarative definition (24 rules, 22 capabilities: 14 legacy + 8 declarative, plus 2 inert RTTY rules). Root reviewed 41 Swift tests, 13 TypeScript tests, TypeScript compilation and historical fixture equality. SST remains source-level evidence: the installed `3a05c2e` app retains seven definitions; native packaged presentation, schedule admission, results reporting, sponsor acceptance and RF remain open. See `contesting/SST_PACKAGED_ACTIVATION.md` and the linked receipts in `pending-updates.json`. Preserve the published status Markdown/workbook cutoff and ledger at 16 previews / 78 pending / 0 complete. macOS is the current app-build scope; Windows/Linux app builds are deferred, while the plan's cross-platform goal remains.

## Evidence boundary

This source reproduces the fixed 94-contest and 33-feature report and its stated evidence boundary. Later native test runs, branch changes, and runtime/device outcomes remain separately identified in `pending-updates.json`; they require explicit evidence review before updating any report claim. The open workbook lock is preserved, and the published snapshot and generated outputs remain unchanged.
