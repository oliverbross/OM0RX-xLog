# macOS 1.3.9 source freeze

Application changes are frozen at `6fb4040d2e386ed66cebb623fcb2d9adc967174e`.
The following release commit changes only version metadata and this build record.
Package that clean release HEAD from the canonical checkout
`/Users/oliver/Documents/Projects/OM0RX-xLog` with
`bash prototype/scripts/package-macos.sh`. The script embeds the exact packaging
HEAD in `Contents/Resources/DistributionMetadata/components.json` (`sourceCommit`)
and embeds the Python runtime provenance separately.

This candidate includes restored main Settings navigation, an unsuspended hidden
contest owner, native Show worked admission and refresh handling, classification
progress during incoming spots and entry edits, periodic Flex spot renewal,
plain worked-call labels, and typed unspotted-call map lookup admission.

Pre-build checks: 827 native tests passed before the final read-only lookup
admission, whose focused native test passed separately; 164 workspace tests,
19 cluster-service tests, 51 BandMap/style tests, and three focused map/path
tests passed. TypeScript passed. Review found and resolved the missing native
Show worked admission; final focused review reported no remaining blocker.

Installation, live device evidence, rollback, and the exact installed release
SHA are recorded in `CQ_WW_SSB_RECONCILIATION_2026-10-23.md` after packaging.
Test results do not claim physical Flex/Maestro or RF acceptance.
