# macOS 1.3.13 — combined Contest Analytics and Log Review

Corrected candidate source: `d728e593f034bd4f1bda76cf24e6961dc2f56e6b`, canonical `main`.
Signed packaging, installation and 32 packaged plus 32 installed disposable Python
checks passed. **READY WITH LIMITATIONS:** final installed Print/PDF passed;
Club Log was unavailable, archive loss is unknown, physical Flex was not retested,
recorded voice remains untested and unique branch consolidation remains undecided.
The final DistributionMetadata/components.json and Not1MM/python-runtime.json
receipts identify that exact source, with matching packaged/installed component
hashes. This documentation update does not change the packaged application source.
Build only from the canonical checkout using `bash prototype/scripts/package-macos.sh`.

Includes Contest → Analytics, Contest → Log Review, corrected wall-clock Rates,
and the following independently reviewed release fixes:

- Analytics read timeouts preserve the shared logging/station worker.
- Invalid or oversized analysis ranges remain recoverable; comparison validation
  cannot crash rendering; obsolete failed checks cannot clear a newer snapshot.
- Duplicate attribution follows the host's stored contact order for backdated entries.
- Unrelated contact correction preserves existing plugin-owned power categories.
- Installed testing exposed a WebKit Blob-download hang. Analytics JSON and CSV
  exports now use the native Save dialog with explicit cancellation/error feedback
  and atomic file replacement. Candidate `de8f91c6b9303d9e63799da194b0de446a40fe12`
  was rejected for this blocker. Its successful signing/runtime checks do not
  establish acceptance of the corrected candidate.
- The subsequent native-Save candidate exposed an ineffective webview print call.
  The final source routes Print / PDF through native printing. The installed
  macOS preview opened and Save as PDF produced a valid two-page document.

Validation before packaging: 4,263 frontend tests, 339 Python tests, 836 Rust tests,
full portable Swift suite, 24 focused Analytics frontend regressions, five Analytics
host tests, and TypeScript/Vite/window-bundle gates passed. The initial full Python
run exposed the power-category issue above; the corrected full run passed.
After the installed export and print failures, five focused native tests and fourteen
frontend tests passed for the native Save and Print paths. These focused checks supplement
the earlier broad suite; they are not a claim that every broad suite was rerun after
the export/print changes. See the [acceptance record](CONTEST_ANALYTICS_ACCEPTANCE_2026-10-25.md)
for evidence paths and candidate boundaries.
Synthetic fixtures and source tests do not establish installed webview or physical
Flex/Maestro acceptance. No production contacts were changed for these tests.

The pre-install settings/database backup is
`/Users/oliver/Documents/Backups/OM0RX-xLog-1.3.13-before-install-20261025T064500`;
the retained rollback app is `/Applications/OM0RX-xLog-previous-1.3.12-20261025.app`.
The preceding native-Save candidate passed 35 isolated native checks, including
logging/readback, edit/delete/undo, ADIF roundtrip and settings/layout persistence.
Installed Analytics JSON (313 rows), filtered CSV (eight rows), responsive cancellation
and Log Review were checked on that candidate. Those checks are reused across the
final print-only change, not claimed as rerun on this source. Production preservation
comparison found all 313 QSO rows, identities and audit rows unchanged from backup.
Final installed Print/PDF passed: the native macOS preview showed two pages;
Save as PDF produced a valid A4, unencrypted, two-page PDF (52,517 bytes), and the
application remained responsive. No physical printing was performed.
No test RF/PTT/audio/rotor actions. Recorded voice remains optional and separately untested.

Historical branches contain independent unfinished work (including DXpedition Map
and settings-safety drafts); these are not silently included in this candidate.
All committed Git history was preserved in a verified bundle at
`/Users/oliver/Documents/Backups/OM0RX-xLog-main-consolidation-20261025/all-refs.bundle`.
Verified cleanup removed 120 local and 120 remote merged branches; 18 local and
18 remote branches remain. Checked-out, unique and unmerged history was retained.
The uncommitted settings-safety patch and test were backed up separately alongside
the bundle. Unique DXpedition/settings work still requires the operator's scope
decision; neither complete consolidation nor “no branches” is claimed.
Deletion evidence: `/tmp/xlog-1313-branch-cleanup.json`.

Sanitized evidence: [release-verification.json](evidence/cq-ww-ssb-1.3.13/release-verification.json).
