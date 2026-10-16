# PJ CTY impact preview — source acceptance

This bounded R01 slice adds **PJ country preview** to the existing Logbook
toolbar. It compares inferred DXCC before and after removal of the PJ-to-305
shortcut, using the active local bundled/downloaded CTY source and each contact's
QSO date. This reconstructs the former algorithm against today's local source;
it does not recover the CTY version or classification seen by an older package.

The view shows callsign, local QSO UUID, UTC date, former/current country and ADIF
entity, including unresolved outcomes. It pages 20 rows, with a native maximum
of 25. Every nondeleted PJ contact with a stored `QSO.dxcc` (including 0 and 305)
is excluded from inferred changes and counted separately as protected. No field's
manual/imported provenance is guessed. Full contact fields, credentials, reference
paths and provider configuration are absent from the response.

`logbook_cty_preview` is available only to the main and Logbook surfaces. Its
strict parameters are `limit` and `offset`; there is no apply/correction operation.
The database owner streams one SELECT over a four-field JSON projection and
retains at most the requested result page. It bypasses persisted aggregate caches
and never saves a QSO, queues synchronization or enrolls provider delivery.

Each page is a fresh local read, not a retained multipage snapshot. Concurrent
edits or reference replacements may change page counts/order; Refresh preview
returns to the first page. Very large logbooks still require a full projected
scan per page; million-contact latency/memory acceptance is outside this slice.

Validation:

- `XLOG_PORTABLE_ONLY=1 swift test --skip-update --filter CTYCorrectionPreviewTests`:
  2 tests passed. Disposable workspaces cover protected stored DXCC, inferred
  modern/portable/unresolved PJ calls, deletion, bounded pages, minimal response
  keys, invalid parameters, unchanged QSO/revision/outbox/pending-sync state,
  historical dates, exact exceptions and a source without Bangladesh.
- `cargo test --offline cty_preview_is_only_available_to_logbook_surfaces`:
  1 test passed; other detached surfaces reject the read route.
- `swift test --skip-update --filter CTYResolverTests`: 2 existing resolver
  authority tests passed.
- `npm test -- src/live/CTYCorrectionPreview.test.tsx src/live/LogbookPanel.test.tsx`:
  23 tests passed, including the explicit Logbook entry point, preview paging,
  empty/error/retry states and absence of mutation requests.
- `npx tsc --noEmit`: passed.

These are source and synthetic isolated-data checks. No installed application,
operator database, provider, remote server, network refresh, or packaged window
acceptance was exercised. The exact package still needs visual/keyboard/window
acceptance with a disposable copied logbook before the R01 package gate closes.
