# macOS 1.3.13 — combined Contest Analytics and Log Review

Reviewed application source: `651bd97c7ce37a365e5be73fad15a581404846ca`, canonical `main`.
The clean version/build commit containing this document is embedded as the exact
source in DistributionMetadata/components.json and Not1MM/python-runtime.json.
Build only from the canonical checkout using `bash prototype/scripts/package-macos.sh`.

Includes Contest → Analytics, Contest → Log Review, corrected wall-clock Rates,
and the following independently reviewed release fixes:

- Analytics read timeouts preserve the shared logging/station worker.
- Invalid or oversized analysis ranges remain recoverable; comparison validation
  cannot crash rendering; obsolete failed checks cannot clear a newer snapshot.
- Duplicate attribution follows the host's stored contact order for backdated entries.
- Unrelated contact correction preserves existing plugin-owned power categories.

Validation before packaging: 4,263 frontend tests, 339 Python tests, 836 Rust tests,
full portable Swift suite, 24 focused Analytics frontend regressions, five Analytics
host tests, and TypeScript/Vite/window-bundle gates passed. The initial full Python
run exposed the power-category issue above; the corrected full run passed.
Synthetic fixtures and source tests do not establish installed webview or physical
Flex/Maestro acceptance. No production contacts were changed for these tests.

Protect the installed 1.3.12 app and production settings/databases before replacement.
Verify the signed packaged and installed receipts, then exercise installed isolated
logging/persistence/export plus both new utility windows. Record exact source,
rollback location and remaining operator-controlled checks in the reconciliation record.
No test RF/PTT/audio/rotor actions. Recorded voice remains optional and separately untested.

Historical branches contain independent unfinished work (including DXpedition Map
and settings-safety drafts); these are not silently included in this candidate.
All committed Git history was preserved in a verified bundle at
`/Users/oliver/Documents/Backups/OM0RX-xLog-main-consolidation-20261025/all-refs.bundle`.
Branch cleanup and unfinished-feature disposition require the recorded scope decision;
the bundle alone does not preserve uncommitted settings-safety files.
