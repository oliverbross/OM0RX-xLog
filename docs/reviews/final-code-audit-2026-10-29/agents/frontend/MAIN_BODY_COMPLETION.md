# MainLiveApp changed-function completion

Entire current function body `prototype/src/LiveApp.tsx:217-1477` has now been
read, and its direct `LiveApp:209-214` caller was checked. Exact numbered source
is preserved in `MainLiveApp-reviewed-source.txt`, tied to source-sha256.json.
The source revision remains clean0ce97a12. No source edits or additional broad
tests were performed.

Previously unread ranges completed with ctx_read bounded windows:

*217-249 and361-379: startup refs, journals, menu navigation/caller routing.
*466-520,521-567,568-619: layout-mode transition, recovery visibility, close/module
 barriers, radio seed identity, station-selection generations/subscriptions.
*712-753,754-794: request completion and current-provider guards, public opportunity
 selection, station preview role, native ReadRadio flush/journal/receipt path and
 browser fixture readback identity.
*834-879,880-925: provider retirement completion, workspace reload ordering,
 parallel state reads, revisioned band-map preference writes/invalidation.
*963-1012,1013-1064: historical-edit follow release, workspace conflict response,
 provider/radio telemetry lifecycle, fixture polling, cluster resume/errors,
 native rotor-generation ordering.
*1157-1205,1206-1253,1254-1301: latest-report queue, pending receipt reconciliation,
 editor-freeze reconciliation, retained read journal cleanup, explicit new-report
 draft preparation, debounce identity, post-configuration refresh and lookup map
 target identity.
*1346-1369,1391-1411,1412-1431,1432-1445,1446-1464,1465-1477: complete remaining JSX
 navigation/actions, legacy recovery buttons, workspace gate, panel content,
 canonical time/power props, Stop action, Undock, station preview selectors,
 Settings receipt/retry and data-management callbacks.

These windows plus the previously recorded ranges cover every line217-1477;
all emitted source windows were inspected without source truncation. The read
records in coverage.json preserve both the combined full range and completion
windows. Tests and previous two findings are unchanged.

Interaction challenges: layout-mode switching includes `!draftSession.dirty` and
configuration/journal barriers; Undock explicitly flushes before opening the
detached editor. Ordinary setView deliberately retains session state while
allowing a valid dirty draft, so the PH6-FE-001 pre-flush display mismatch remains.
Native ReadRadio journals before dispatch and rechecks draft/workspace identity
after flush. Station observations use provider/selection/disposal fences; stale
or uncertain control outcomes are passed to shared native owners. New report
selection can deliberately replace local unsaved text, but preserves pending
write/receipt/conflict fences and native report authority. Legacy recovery copies
text into the current blank draft ID, flushes before removing old storage, and
does not independently log it. No additional confirmed defect emerged from the
completed body read.

This is full changed-function source-read coverage, not exhaustive semantic,
provider/device, timing or runtime acceptance. Callee implementations outside the
recorded review ranges retain their stated depth limits.
