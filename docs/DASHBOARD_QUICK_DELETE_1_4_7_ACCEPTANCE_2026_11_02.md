# Dashboard callsign quick delete — macOS 1.4.7

The dashboard logbook now offers **Delete contact…** when the operator right-clicks a callsign. It opens the existing contact/date confirmation. A successful deletion exposes **Undo delete** directly above the dashboard table. Existing row editing remains unchanged.

The menu selects the clicked contact without opening Edit or replacing the current operator draft. It uses the existing `logbook_contact` snapshot and revision/generation-scoped `logbook_contact_apply` deletion/restore owner, including its durable journal, receipts and conflict handling. Loading, pending operations, workspace changes and external mutation guards block admission. Page refreshes dismiss an open menu. Focused rows support the context-menu key or Shift+F10; the menu supports arrows and Cancel/Escape. No backend deletion or synchronization policy was changed.

## Exact installed candidate

- Functional commit: `4d63bf987a4cdc27ab2cb66b26036aa1cad544a7`.
- Version/build source: `04e95a208ede61df8c9fc37a7399f51ae854ceab`, canonical `main`, **1.4.7**. The version and source/manifest provenance were recorded before packaging.
- App SHA-256: `6465e3e230249c9a4cb2520f4da1fd6d5d0e417bd6ed11a4ef69174c258b9db7`.
- Worker SHA-256: `4fa04a1d91387ece1421a363833fceda053a40b544f9d025daf3761333c6d033`.
- Developer ID / hardened runtime, team `4WCMQ4U946`, matching 1.4.6; strict deep verification passed.
- Apple notary submission `6ad330cf-ddf6-4013-86e7-2c73aef6d4af`: **Accepted**; staple/validation and Gatekeeper acceptance passed.
- Stapled ZIP SHA-256: `5e6e234e493f533b1ef85a28b621b10cbf948a0b44697c08ebd0756dab0c22d5`.

## Verification

- Final frontend cohort: **103 tests passed** across the five LogbookPanel suites, including 11 new context-menu cases. Coverage includes exact clicked identity, confirmation before dispatch, Delete/Undo receipts, unchanged editing, cancellation, keyboard navigation, refresh dismissal, busy/workspace guards and stale-revision conflicts.
- TypeScript and production frontend build passed. The menu body loads on demand; the bundle gate now asserts that it stays outside ordinary detached-logbook startup. The verified graph was **405,138 bytes**, within the unchanged **405,200-byte** budget. Earlier over-budget builds were retained and corrected before packaging; no budget waiver was used.
- Canonical packaging reran frontend/window-bundle gates, packaging/staging tests, worker self-test, bundled Python/CW resource checks and strict signatures. Payload privacy audit: **3,538 files, zero findings**.
- `DESIGN.md` documents the narrow extension. No new raster assets or visual-system replacement were introduced.

## Isolated native acceptance

A fresh canonical private `xlog-wave1-*` root, marker UUID and unique WebKit identity were used. The operating module was checked against its owning type (`normal_logging`). Exact live app PID/executable/full private-root arguments and matching child-worker coordinates were verified before native bindings/observations. The matching marker was visible in the title before input. Network, credentials and station I/O were disabled by the verified runtime profile.

The fixture contained eight generated contacts, with `N0DEL` newest, and a distinct nonempty `K1DRAFT` operator entry with fixed date and retained comment. Native checks verified:

1. Right-click the callsign: selected row and **Delete contact… / Cancel** menu appeared, with no editor opening. Visual inspection confirmed the menu remained inside the viewport and inherited the application palette.
2. Explicit menu Cancel dismissed it and returned focus to the selected row.
3. Delete opened confirmation for the correct callsign and UTC date, initially focused on Cancel. Explicit confirmation Cancel retained all eight contacts and the operator entry.
4. Confirm Delete removed only `N0DEL`, refreshed the total to seven and exposed dashboard Undo.
5. Undo restored `N0DEL`, returned the total to eight and retired the Undo control.
6. Ordinary Quit completed. WAL-aware read-only inspection found exactly one durable Delete and one Restore receipt for the target, byte-identical payload/deletion state for all seven other contacts, restored target content apart from its mutation timestamps, and a **byte-identical complete stored operator draft**.

Native automation observations are bounded: the accessibility menu's advertised secondary Cancel action did not dismiss this custom HTML menu, so its visibly observed Cancel item was used successfully; no blind Escape was sent. After confirmation cancellation changed table capacity, native focus ended on the document following the table reload. Component tests verify keyboard dismissal/focus with a stable page; this does not claim native focus preservation through every capacity-driven remount.

## Protected installation

The earlier production app and worker completed closing; process-only checks confirmed absence. A fresh backup retained the workspace/database, native state, integration services, preferences and WebKit journals. The previous signed staged bundle was also preserved before packaging. The installer retained 1.4.6 at `/Applications/OM0RX-xLog-previous-20261102T050056Z-90599.app` and verified installed executable hashes/resources/signatures.

Before the first 1.4.7 production launch, the database was byte-identical to the backup. Read-only comparisons verified all **69,582 stored / 69,581 live contacts**, the current draft and automatic-start provenance, integration settings, all **33 original main-draft journals**, workspace settings files and all **258 retained spot payloads** unchanged. No production test QSO or deletion was issued.

The exact installed application and child worker were process-verified before a deliberate normal launch observation. Operator Desk opened with the existing draft, **69,581 contacts**, connected cluster/radio status, spots and the map. The app was left running in that workspace. This is local Mac feature acceptance, not an all-platform release or a live remote-deletion/provider qualification. Existing automatic services resume under the operator's retained settings.

The same read-only preservation comparison passed again after this normal launch: no original contact payload/deletion changes, draft changes, settings changes, missing journals or retained-spot changes were found at that checkpoint.

Detailed private receipts, fixtures and backups are retained outside Git under `.build/quick-delete-20261102/` and the backup location recorded there.
