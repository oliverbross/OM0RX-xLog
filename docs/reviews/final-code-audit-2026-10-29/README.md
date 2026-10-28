# Phase 6 independent audit evidence

Audited canonical source: `0ce97a12bb06f1fb7c501c3f1286ae9bb1aca450`. Comparison baseline: `530de4c4e4b23281ec60585cc7a2e5ca011476fb`. These files support [FINAL_CODE_AUDIT.md](/Users/oliver/Documents/Projects/OM0RX-xLog/FINAL_CODE_AUDIT.md).

Only this archive and the final audit report are repository outputs. Application/test/configuration files, dependencies, built frontend assets, operator data and earlier reports are preserved. No installed/native UI, provider, live transport, hardware or RF operation was performed.

- `baseline.json`, `baseline-source-sha256.json`: audited source, comparison range and all 1,832 preserved tracked application/support inputs. Resource/fixture entries do not imply semantic review.
- `changed-inputs.json`, `changed-input-coverage.json`: all 60 changed inputs accounted for, with owner/depth pointers.
- `root-coverage.json`, `agents/*/coverage.json`: actual changed-function bodies, callers/test paths, additional source ranges and explicit remaining limitations. Agent `REVIEW.md` files retain their scoped analyses; the root report supplies final IDs/severities and disposition.
- `environment.json`, `root-helper-checks.json`, agent command ledgers/receipts and raw logs: actual environment and focused execution evidence. Cached tests, fresh exact-body compilation, expected failing counterexamples, baseline controls, blocked commands and harness failures are distinguished in the report.
- `proofs/process-generation-coverage.json`: independent re-analysis of the earlier byte-identical current scenario ledger. This is not a fresh process execution.
- `artifact-index.json`: archive path, original scratch location, exact raw/compressed byte counts and SHA-256 for each imported artifact. Raw logs and source snapshots are gzip-compressed without normalizing bytes. For example, `gzip -dc <path>.log.gz` reads the original output.
- `source-preservation.json`, `final-validation.json`, `SHA256SUMS`: preservation and final archive/report validation receipts. The checksum file excludes itself to avoid circular hashing.

The source proofs use actual project implementation bodies or current-source-provenance built modules with fake transports/private synthetic data. Their source hashes, commands and boundaries are retained. Python scripts are archived for inspection; original scratch/build paths in them are provenance, not a promise of hermetic replay on another host. Portable IQ output excludes its build tree. Binaries, SQLite/sidecars, dependency symlinks and runtime fixture directories are not archived.

The initial Python 3.9 import failure, frontend config-loader attempts and other unsuccessful probes remain as evidence. They are not hidden or counted as semantic test failures after a corrected harness succeeds. One current rendered preservation assertion intentionally remains failing because application fixes are prohibited in Phase 6; characterization passes do not mean that behavior is correct.

`assemble_audit_evidence.py` records the archive selection and coverage assembly. `validate_audit.py` records final hashes, JSON/gzip integrity, report-link/coverage checks and original dependency/asset preservation. Review source and evidence before rerunning any script; this archive does not authorize station/provider operations.
