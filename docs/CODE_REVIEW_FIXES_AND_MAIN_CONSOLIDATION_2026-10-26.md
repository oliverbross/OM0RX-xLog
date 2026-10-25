# Whole-app review fixes and canonical main consolidation — 2026-10-26

## Fixed findings

| Finding | Fix | Regression coverage |
| --- | --- | --- |
| Restore failure left a partially replaced workspace | `af1f6428`: reverse every published component, defer preferences, and block reopening after incomplete rollback | Database/contest/reference/completion failures and failed rollback |
| Wavelog could acknowledge an unverified QSO end time | `66edffc1`: verify returned TIME_OFF or a bounded, identity-checked ADIF readback before acknowledgement | Stale/null/missing times, wrong IDs, identity and end date |
| A failed search displayed the previous query's contacts | `df2c8126`, `22447077`: clear query/owner-specific rows and selection; expose failure and retry | Failed query, disabled row actions and successful retry |
| History/duplicate lookups decoded every matching contact | `3246f2a8`: stop decoding once enough true portable-call matches are found | Portable/location suffixes, excluded edit, zero limit and unread malformed tail |
| Every spot acknowledgement rewrote the whole JSON inventory | `5eb7deb6`, `48f02db4`: durable per-receipt SQLite updates and one-time transactional legacy import | Restart, failed import retry, concurrent receipts, exact conditional removal, radio identity and 4,096-row bound |
| Several contest plugins replayed the entire log on append | `7c180069`: apply pinned multiplier callbacks to the new chronological row while retaining full SQL history | Score/multiplier parity, duplicate preservation, out-of-order replay and bounded SQL workload |

Corrections, deletions, and tied/older contest inserts retain the full rebuild path. No source-pinned vendor plugin was edited. Spot and sync acceptance tests use mocked transports; these results do not claim hardware, Maestro rendering or provider-account acceptance.

## Performance evidence

Local debug/test measurements, with fixtures independent of station data:

| Workload | Review baseline | Fixed |
| --- | ---: | ---: |
| Latest history, 10,000 same-call contacts | ~214 ms | ~7 ms |
| Duplicate lookup, 10,000 same-call contacts | ~226 ms | ~41 ms |
| 100 mocked spot deliveries, 1,000 receipts | ~787 ms | ~57 ms |
| 100 mocked spot deliveries, 4,096 receipts | ~2,717 ms | ~182 ms |
| Contest append, 3,000 prior QSOs | ~2,071 ms / 15,032 SQL statements | ~5–17 ms / 28 SQL statements |

The durable spot benchmark excludes the one-time legacy import from steady-state timing and asserts that acceptance leaves the legacy JSON unchanged. Tests enforce bounded work and correct results rather than machine-dependent latency thresholds.

Validation: default Swift suite; portable Swift affected suites; 4,338 frontend tests across 296 files; 349 Python tests; 895 Rust tests; TypeScript, Vite and detached-window startup bundle budgets. A full portable rerun is recorded in the completion entry below. The initial broad run also exposed an outdated JSON-inspection assertion (updated to SQLite) and a catalogue-start timing failure that passed in the targeted rerun.

## Retired history

This merge retains old branch commits as ancestors of `main` using the `ours` merge strategy. Its application tree remains the reviewed canonical tree. This is an explicit retirement of superseded implementations, not a claim that every historical patch should be reactivated.

- Amplifier, portable-location and previous-QSO changes already have equivalent patches on main.
- DXpedition Map was integrated and reviewed in `06b37201` and subsequent fixes.
- The early declarative contest operator/rate/isolation branches predate the production Not1MM Python owner. Their source and acceptance history remain available in Git.
- `51e96abd` contains an unused Swift rover-grid store API. It is retained as historical source; the active Rover workflow uses the Python contest owner. The historical API is not enabled by this consolidation.
- The macOS alpha recovery branch changes an obsolete version candidate; current installed provenance remains in the later release records.
- Spot forwarding's historical test provenance is already present in `6d15d7b6`.
- Contest review checkpoints and the remote-only CQ WW SSB review branch are historical documentation retained by this merge.

The obsolete uncommitted settings prototype is **not** merged into the application or absorbed into this change. Main already implements settings revisions, durable receipts and workspace-generation fences (`b58163fa` and later integration). Its draft source and tests are preserved locally in Git stash `b93b0fa0fee397ace95f82cc13eed9e8fb6f33f8`; ignored review evidence is preserved in local stashes `848d46b13b983ffd103ddf7292ce33f2c5c20bb7` and `2afc5889937d02495d74342581cb15f939c784af`. Existing unrelated stashes are untouched.

## Application copies

The 11 older application copies (1.3.11–1.3.18 and 1.3.20–1.3.22) were permanently deleted at the user's request. Their temporary application archive was removed. `/Applications/OM0RX-xLog.app` remains version 1.3.23, main executable SHA-256 `69309b44aed61e76050a9067dac7a186e66f57917f2b1b16b5d374b0e75b0e7f`.

This task does not package or install a new candidate. The fixes are source changes on main; the running application was not stopped or replaced. No release version was reused or bumped.

## Completion

Final portable validation, retired checkout/branch removal and temporary consolidation-artifact removal are recorded after their verification.
