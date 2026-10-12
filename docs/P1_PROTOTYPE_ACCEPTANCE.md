# P0/P1 implementation evidence

Date: 2026-10-12. Development branch: `codex/unified-xlog-prototype-p1`.

## Production preservation

The [P0 manifest](P0_MACOS_BASELINE.md) records production application hashes, source baselines and test counts. The v0.3.0 release is explicitly labelled **Current working macOS-only release**; its original ZIP and tag are preserved. README/release documentation was published separately to main before prototype code. The prototype has a separate bundle identity, output directory and memory-only fixtures. No production app is replaced/restarted, no live logbook is opened, and no station/configuration/credential write is part of P1.

Existing uncommitted xCat work is preserved, not silently swept into this repository or called a released baseline. Reconciliation remains required before extraction of those modules.

## Evidence ledger (updated as gates run)

| Check | Result / boundary |
| --- | --- |
| Original xLog suite | 43 tests, seven suites passed after conditional portability imports |
| Existing xCat / xCluster baseline | 58 / 22 tests passed; not retested as integrated modules |
| Portable Swift unit suite, macOS | 7 passed |
| Real worker process framing, macOS | 2 passed: open stdin, fragments, malformed/oversized recovery |
| Worker self-test, macOS | ADIF roundtrip, semantic hash, SQLite memory, XML, SHA-256 and URLSession mock passed |
| Frontend | 11 tests passed; production bundle built; npm audit zero advisories at verification |
| Hamlib 4.7.2 macOS | 8 dummy protocol checks passed; owned process/port cleanup proven; see dedicated report |
| Rust shell tests | Pending final run |
| Three-platform native CI | Pending pushed branch run; do not infer Windows/Linux success from Mac tests |
| Browser / packaged UI | In progress; separate evidence below |

Initial real-process testing found Foundation's read-up-to-count blocked while stdin stayed open; worker now uses native bounded reads and the regression passes. Initial browser rendering caught a MapLibre worker-load problem, so visual verification is not inferred from the frontend build.

## Scope achieved vs remaining

The prototype compiles the original `ADIF.swift`, `Models.swift`, `QSOADIF.swift`, `SemanticQSOIdentity.swift` and `WavelogClient.swift` directly in a portable target. Production source changes are limited to platform-conditional Crypto/FoundationNetworking imports. This proves an extraction route, not portability of the full logbook, awards, backups or station services.

The P1 frontend preserves the operator-console vocabulary and selected-spot workflow in synthetic data. It does not replace the production screens. MapLibre uses offline vector polygons; matching production cartography, text/performance and accessibility across all three webviews are open acceptance items. The ~1.29 MB uncompressed main JS bundle needs a measured startup/memory budget before release.

Still required before G1 architecture approval / P2 production migration:

- Native build/test evidence on Windows/Linux and packaged UI launch, not just browser preview.
- Clean-machine runtime closure, all bundled Swift/SQLite/Hamlib dependencies, signing/notarization and supported OS matrix.
- Actual HTTP socket/TLS transport tests (the URLSession self-test is an intercepted mock, not HTTPS proof).
- Worker crash/hang/restart and full persistent core/backup/restore migration acceptance.
- Local helper supervision integrated with provider capabilities; real radio/rotor tests only in an explicitly approved commissioning phase.
- Full CAT/CLU parity inventory, current xCat dirty-work reconciliation, shared settings/credentials and existing-user migration.

**Status: P0 preservation complete; P1 implementation under verification. No production multi-platform release or full integration claim.**
