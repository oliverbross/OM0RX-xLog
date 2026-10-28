# Second code-review verification — 29 October 2026

Baseline: clean canonical main `12824393f2799f21c223fadcb19d03305a5bf2f8`;
application unchanged from `4bd554a25951ddc995b4bef1715d3df12918a07b`.
Work spanned 28–29 October Australia/Darwin. Scratch names retain the start date.
No application, existing test, dependency or configuration file was modified.
No GUI/installed app, production logbook, credentials, real radio or account was used.
TCI used a disposable loopback WebSocket; recorder used synthetic PCM only.

The reports are [CODE_REVIEW.md](/Users/oliver/Documents/Projects/OM0RX-xLog/CODE_REVIEW.md) and
[REVIEW_COVERAGE.md](/Users/oliver/Documents/Projects/OM0RX-xLog/REVIEW_COVERAGE.md). Ten original findings survive;
CR-002's module-switch interpretation is narrowed. Two new export findings add
up to 12 (2 High, 9 Medium, 1 Low). Whole-codebase semantic review remains incomplete.

- `REVIEW_INVENTORY.tsv`: cumulative exact 2,347 baseline paths, with separate manual-depth and check notes.
- `coverage-summary.json`, `coverage-merge.json`: counts, 70 distinct newly inspected paths, 30 depth changes, and context/execution-only observations that do not upgrade depth.
- `provenance.json`: exact HEAD, empty application diff and unchanged first-pass evidence.
- `root/`: actual service/manual-time, exact legacy method extraction, independent reruns, focused Swift logs, and original schema second retrieval.
- `frontend/`: real React/writer fixtures, original/derived official schema, complete codec vocabulary comparison, existing focused tests, disposition and range records.
- `native/`: actual-object Swift linking metadata and scripts, actor/loopback/actual Rust-store probes, matrices, selected Cargo manifest/lock and ranges.
- `contest/`: configured real Host fixtures, authoritative admission/rollback/replay results, 41 existing focused tests, command log and coverage increments.
- `copy-manifest.json` maps exact scratch sources to committed readable copies; `SHA256SUMS` covers all durable artifacts except itself.

First-pass evidence in `../full-code-review-2026-10-28/` is immutable and remains
the source of full-suite/build/audit and 97-contest results. No full suites were
repeated in this pass. Counts overlap prior suites; they are not unique coverage.

## Reproducing the bounded checks

Scripts preserve exact original scratch/source coordinates. On the same checkout,
copy the relevant committed area contents to
`/tmp/xlog-review-verification-20261028-12824393/AREA` before rerunning. Builds and
runtime fixture stores/binaries are intentionally excluded. Existing dependencies
and normal Swift production objects from the documented first-pass portable build
are prerequisites; no installation is part of these probes. The native builder
records object hashes and exact linking flags. Do not run fixture scripts in a
production data directory.

Root commands, from the repository root:

```sh
XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/prototype-tests --no-parallel --filter OperatorDraftTests
XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/prototype-tests --no-parallel --filter 'RemoteBackup(Owner|Scheduler|Authorization|RetentionReview)'
python3.12 -B /tmp/xlog-review-verification-20261028-12824393/contest/verify_contracts.py
python3.12 -B /tmp/xlog-review-verification-20261028-12824393/root/prepare_legacy_method_probe.py
```

The last command extracts actual method bodies; it does not modify app code.
Swift service/legacy probes and native actor probes use:

```sh
swift -I .build/prototype-tests/debug -I Sources/CSQLitePrototype -I /tmp/xlog-review-verification-20261028-12824393/native -L /tmp/xlog-review-verification-20261028-12824393/native -lReviewNative -Xlinker -rpath -Xlinker /tmp/xlog-review-verification-20261028-12824393/native SCRIPT.swift
```

The configured Host probe needs the retained pinned WAE HTML; it does no network
retrieval. Contest command record lists the 41-test command. Frontend command record
lists the five 1408-test files; root's combined independent rerun from `prototype/`:

```sh
node node_modules/vitest/vitest.mjs run --config /tmp/xlog-review-verification-20261028-12824393/frontend/vitest-verification.config.ts --testNamePattern VERIFY
python3.12 -B /tmp/xlog-review-verification-20261028-12824393/frontend/validate_schema_structure.py
```

Expected combined React outcome: 3 preservation/label assertion failures, 6 passes,
45 skipped. Fixture scripts asserting observed counterexamples exit 0; this does
not mean product behavior is correct. The exact native build, loopback, recorder
and object-hash commands are retained in `native/verification-matrix.md` and JSON.

## Evidence boundaries and log format

Chooser/model scaffolding substitutes native UI only for the extracted legacy
methods; core/SQLite are actual modules. Actual service timestamp uses no stubs.
fldigi substitutes RPC/receiver only. TCI fake server completes a real handshake
without radio commands; socket closure on eventual process exit is not disputed.
Recorder imports unchanged application store source into an offline test package.

Official ADX 3.1.7 XSD SHA256:
`ce7a86832f7be4a232d2c1ae7432925feb2be8506cba24345b7e3ad994a87331`.
Original xmllint compilation fails on an unrelated NZ regex even for the control;
derived validation removes just that unused facet, preserving field declarations.
Original-schema name comparison independently confirms the two unsupported tags.

Scratch `.log`/`.stderr` captures are committed as `.log.txt`/`.stderr.txt` with
ANSI/trailing whitespace normalized, plus exact raw bytes in the matching `.txt.gz`. Reviewer documents
refer to original capture names; append `.txt` when opening durable copies. Raw
hashes in child manifests refer to original bytes; `copy-manifest.json` and root
`SHA256SUMS` identify durable copies. Setup failures, original validator blockage
and expected assertion failures are retained. No personal/runtime stores or audio
are committed. Complete provider, installed native UI, RF, physical audio, crash/
power-loss, sponsor currency and whole-repository semantic coverage remain open.

Root also independently reran the unchanged recorder package with `cargo run
--quiet --offline --manifest-path /tmp/xlog-review-verification-20261028-12824393/native/Cargo.toml
--target-dir /tmp/xlog-review-verification-20261028-12824393/native/cargo-target`.
`root/assert_results.py` verifies its printed consumer state together with the
service/legacy counterexamples and schema hash. Consolidation scripts expect the
first-pass report baseline; they are preservation/assembly utilities, not fixes.

Official/schema and generated XML files (`.xsd`, `.adx`) retain their exact raw
bytes as `.xsd.gz` / `.adx.gz`; decompress them to the original filename in the
scratch area before executing schema probes. Their uncompressed source hashes
are recorded in `copy-manifest.json`. No primary-source content was altered.
The first staged whitespace check flagged the raw source CRLF/trailing spaces;
lossless gzip preserves them while readable log copies are normalized.
