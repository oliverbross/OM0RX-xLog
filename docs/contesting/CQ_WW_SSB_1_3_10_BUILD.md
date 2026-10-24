# macOS 1.3.10 source freeze

Application changes frozen at `005747155b62e11d49722f0edd023e3b8cca9f8e`. Version metadata is raised from
1.3.9 to 1.3.10 in the release-record commit. Build that clean commit from
the canonical `/Users/oliver/Documents/Projects/OM0RX-xLog` checkout with
`bash prototype/scripts/package-macos.sh`. The embedded components receipt
records the exact packaging HEAD; record installed hashes and rollback in
`CQ_WW_SSB_RECONCILIATION_2026-10-23.md` after installation.

Changes: indexed authoritative classification queries; request-local country
map reuse with defensive lookup copies; single-flight classification during
incoming bursts; stable equal-time Cluster row order; contest-only separated
Band Map labels with exact-frequency leaders; rounded heading/distance display.
No scoring-rule change or cross-revision classification cache was introduced.

Validation: 26 focused Python CQ WW tests; 168 workspace tests; 205 detached,
cluster and filter tests; 52 Band Map/style tests; TypeScript and diff checks.
Full Python suite: 327/330 pass; the same three failures reproduce against
installed 1.3.9 (two older test_host country_identity expectations and one
Stew Perry power-field error). Exact classification parity and timing samples
are in `evidence/cq-ww-ssb-1.3.10/classification-performance.json`.
Independent backend, scheduling and Band Map reviews found no blocking issue.
Band Map crowded-label fixture was visually checked at 430px width.

Physical radio delivery, live operator timing and installed UI are distinct
from these tests. Preserve production data/settings and do not create test
QSOs, tune, key, play audio or move hardware during installation checks.
