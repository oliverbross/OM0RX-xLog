# Phase 6 frontend / retained SwiftUI audit

Source: canonical clean `main`, `0ce97a12bb06f1fb7c501c3f1286ae9bb1aca450`.
Comparison: `530de4c4e4b23281ec60585cc7a2e5ca011476fb..HEAD`.
Source hashes: `source-sha256.json`. No repository source, tests, configuration,
documentation, dependency tree, or built app was changed. No app/native GUI,
production storage, credentials, or external station service was used.

## Findings

### PH6-FE-001 — Medium / high confidence — manual UTC display mode is still lost before the draft flush

**Origin:** pre-existing CR-008 edge left unresolved by the repair; the original
acknowledged-snapshot trigger is repaired. This is not a newly introduced regression.

**Locations:** `prototype/src/live/DetachedQSOSurface.tsx:193,198` supplies
`state.base.automaticStart` while supplying `state.draft` as the editable QSO.
`QSOEditorCore.tsx:128,166,206-208` and `OperatorDesk.tsx:43,47,71,82` initialize
the remounted form's mode from that acknowledged metadata. `DetachedQSOSurface.tsx:125-131`
debounces the replace for 350 ms; `173-176` permits a mode change with a valid
dirty draft while no request is pending. `OperatorDraftSession.edit:212-219`
updates only local `draft`, retaining `base` until acknowledgment.

**Reproduction:** start from an automatic native draft; in Full enter
`2026-10-20 10:15:30`; switch immediately to Simple before the replace dispatch.
The journal contains local manual `start=2026-10-20T10:15:30Z`, `base.automaticStart=true`,
`pending=null`, and no apply calls. Simple displays injected current
`2026-10-28 12:34:56`. Simple→Full and Full→Simple→Full reproduce the same mismatch.

**Impact:** direct Save retains the manual value: the real session flushes replace
before save. Do not describe direct Save as corrupting this timestamp. However,
a time-only edit after the remount uses the displayed current date
(`OperatorDesk.tsx:83-89`, or `QSOEditorCore.tsx:308-316`), replacing the previous
manual date. The rendered characterization logs a saved
`2026-10-28T11:11:11Z` after the operator changed only time. This is a misleading
display with a concrete follow-on data-entry consequence.

**Evidence:** `manual-remount-final.log`: five real rendered/component/session
cases, one intentionally failing preservation requirement and four passing
characterizations. `PHASE6_PRE_FLUSH`, `PHASE6_SAVED`, `PHASE6_NEXT_EDIT_SAVED`,
and `PHASE6_VARIANT` retain journal, displayed DOM input values and apply queue.
These are jsdom renderings, not native screenshots. `manual-remount-baseline.log`
repeats the first three cases against exact pre-remediation frontend bodies:
the display requirement fails identically. Baseline imports and source files
are retained. That origin comparison uses the current session/backend fake;
it establishes frontend display origin, not pre-remediation native Save behavior.

**Backend/caller challenge:** current `LogbookDatabase.swift:1912-1913` switches
to manual on an actual changed start/end; `1950` stamps only a current automatic
draft. `OperatorDraftSession.commit:393` flushes before save. Thus the fake's
relevant time contract agrees with current native source. The native durable
path is independently owned by the persistence auditor. Detached mode switching
is disabled once `pending` exists (`172,191`), so the dynamic claim is the
pre-dispatch interval, not arbitrary slow in-flight acknowledgment. Main's
`LiveApp.tsx:335-358` also permits valid dirty navigation, passes the same base
metadata (`1333,1436`), and uses the same 350-ms debounce (`941-952`); that
parallel trigger is statically traced, not independently rendered in this audit.

**Test gap/correction direction:** the new acknowledged-remount regressions at
`DetachedQSOSurface.test.tsx:85-102` explicitly wait for the replace before
switching. Preserve effective local manual time intent across remounts (or finish
the required flush before remount) and add the pre-flush variants. Retain the
new canonical boolean validator and native-owned automatic Save contract.

### PH6-FE-002 — Medium / high confidence — detached QSO duplicate advisories are rejected by the native role gate

**Origin:** pre-existing frontend/native integration defect; the same whitelist
omission exists at baseline `530de4c4`. This is not a repair regression.

**Locations/call chain:** Full `QSOEditorCore.tsx:230`, Simple
`OperatorDesk.tsx:40` → `useDuplicateContact.ts:24-32` issues
`logbook_duplicate` after 150 ms → `DetachedQSOSurface.tsx:22,24-28` explicitly
allows and forwards it → `worker.ts:95-109` invokes `worker_request` →
`main.rs:2440` calls `worker::validate_surface` for `log-qso` →
`worker.rs:110-115` omits `logbook_duplicate` from that role's allowed methods.
The query therefore fails before reaching Swift. The hook's catch at
`useDuplicateContact.ts:31` suppresses failure and returns no advisory.

**Trigger/impact:** a native detached Full or Simple QSO editor, valid call/band/mode,
and a matching prior contact. The expected `Dupe: Worked on ...` warning
(`OperatorDesk.tsx:123`, `QSOEditorCore.tsx:385`) never appears. Main is a positive
control: its general role accepts the method and the service exists at
`LiveLogbookMethods.swift:983-1000`. Logging duplicate contacts is deliberately
allowed; this defect removes the advisory, not a required deduplication block.

**Evidence boundary:** fully traced exact current production source and baseline
source comparison. `ipc-validator.rs` preserves complete exact production gate
bodies (ranges and source hashes in `ipc-validator-source.json`) with one explicit
literal-role identity stub. A combined compile/run command was rejected by
lean-ctx because the scratch executable name is not allowlisted; no segment ran.
There is no dynamic Rust or complete IPC execution claim. No allowlist was changed.

**Test gap:** `DetachedQSOSurface.test.tsx:237-238` asserts a fake worker received
the duplicate request and bypasses the native gate. Component positive tests
`OperatorDesk.test.tsx:60` and `QSOEditor.test.tsx:95` similarly supply successful
fake reads. The native `duplicate_history_query_is_main_only` test at
`worker.rs:1912-1917` omits `log-qso` from its deny/allow checks. Add a cross-boundary
authorized-editor case and align the role's narrowly scoped history authority.

## Original root-cause verdicts

| Item | Current verdict | Fresh basis and limit |
| --- | --- | --- |
| CR-001 frontend dependency | Repaired for current automatic/native Save wiring | Both actual callers now pass defined canonical mode, so QSOEditor/Desk submit existing draft unchanged; session flush/save ordering and current native `1950` preserve intent. Detached automatic-save tests pass with no replacement. Native persistence proof is separately owned. |
| CR-008 acknowledged manual mode | Repaired original trigger; incomplete broader time-intent repair | `automaticStart` flows through both main surfaces and both detached modes. Acknowledged manual remount tests pass. PH6-FE-001 remains for unsent valid edits. |
| CR-009 retained AppModel import | Root cause repaired in source | Guard prevents nil DB success before chooser; bounded strict UTF-8 file reader → fully validated document → existing atomic/deduplicated importBatch; actual imported/skipped counts; errors become error banners. Menu callers in WorkspaceViews30 and OM0RXXLogApp54 retained. No native chooser run. |
| CR-010 captured radio output label | Repaired | `draftPowerDescription:113-115` chooses label from source. Valid `radio_output` and `kpa500_output`, capture on/off fixtures pass through actual rendered TX power field; no numerical power corruption asserted. |
| CR-011 retained AppModel export | Root cause repaired in source | Captured DB guard; chooser explicitly explains whole logbook; `.adifExportSnapshot(.all)` uses single fetchAll then frozen records; `.document` and success count use that snapshot, bypassing display cap/search. Menu callers same. No native file chooser run. |
| CR-012 deprecated ADX tags | Repaired targeted schema defect | New pinned-XSD test passes. Independent Python ElementTree comparison finds exact179 standard renderer fields equal schema RECORD vocabulary minus APP/USERDEF, no missing/extra. Removed tags enter declared USERDEF branch, import retains legacy literal tags; ADI remains unchanged. Metadata roundtrip/replay tests pass. This is not full independent scalar XSD validation. |
| REG-P4-001 clean-lock repair | Static consistency verified; fresh clean build unverified here | Lock upgrades rolldown1.2.13→1.2.15, all15 optional bindings and oxc types0.153→0.155 together; unchanged Logbook405200 budget. No node_modules swap, npm install or app build authorized/performed. Existing dependency test pass cannot establish clean-lock emitted byte count. |

## Actual checks and rejected leads

* 1,431 tests PASS across DetachedQSOSurface, operatorDraftSession, OperatorDesk,
  QSOEditorPower, adifTransfer and independent vocabulary schema test (24 s).
* Further 55 tests PASS across QSOEditor, operatorDraftPowerSession and
  operatorDraftTransport (8 s). Total 1,486 tests / 9 files.
* Current scratch pre-flush probe: 1 expected requirement FAIL / 4 characterization
  PASS. Baseline first-three probe: same 1 requirement FAIL / 2 PASS.
* Rejected: stale time is directly resubmitted by defined-mode shared forms.
  Current forms submit draft unchanged; direct Save control preserves manual time.
* Rejected: malformed local journals can silently cross a new workspace. Session
  scope, generation, exact mutation/receipt identity, revision and native guards
  retain recovery rather than treating an unknown acknowledgment as success.
  This is targeted static/test coverage, not exhaustive malicious storage fuzzing.
* Rejected: capture label repair changes attribution/value selection. The change
  only chooses display source text after existing matching-contact gate.
* Rejected: deprecated-tag repair drops ADI field values. Export declares USERDEF;
  legacy input, metadata replay and exact ADI preservation controls pass.
* Native trust review: production worker executable path derives from app sibling,
  no renderer shell command; bounded typed methods and surface checks precede
  native dispatch; operatingContext is removed and native operatingModule stamped.
  CSP has self-only scripts and no shell/filesystem plugins. No exploit proved.
* Extra partial review covered map retained-context/staleness activation gate,
  read-only detached awards, settings journal/reload and typed method boundary,
  contest pending mutation persistence/context/quarantine and exact retry IDs.
  No additional defensible issue was established in those ranges.

## Coverage limits

Every assigned changed production function/hunk is recorded in `coverage.json`
with callers and tests. The entire `MainLiveApp` body at217-1477 has now been read
in bounded windows, including all formerly unread ranges; its direct caller at
209-214 was checked. `MAIN_BODY_COMPLETION.md` records the final pass and scope.
Full source reading does not certify every asynchronous behavior or every callee.
The partial boundary remains for unchanged Not1MMContestWorkspace, native shell
owners, child settings/maps/awards implementations and complete Rust IPC/security
acceptance. No repository-wide function completeness is claimed.

Outside-root LEAN-CTX/skill reads were blocked by the tool root. The provided
AGENTS rules were followed using ctx_shell/ctx_read/ctx_search/compose; no configuration
or allowlist override was made. Initial config-loading test failure was harness
setup only; the final native-loader scratch config is retained. Commands and
artifact mapping are in `COMMANDS.md`.

## Bounded security follow-up

`SECURITY_FOLLOWUP.md` records the subsequent untrusted HTML/URL/native-action
and journal-recovery trace. No additional defensible finding was established.
The global renderer sink inventory, exact added ranges, rejected leads and
unreviewed security boundaries are retained in `security-sinks.txt` and the
`security_followup` object in `coverage.json`. Prior pre-flush evidence is unchanged.
