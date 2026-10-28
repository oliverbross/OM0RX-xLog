# Frontend review evidence — 28 October 2026

Reviewed source: canonical `main` at `4bd554a25951ddc995b4bef1715d3df12918a07b` (read-only application source).
This is a bounded frontend subreview, **incomplete as a full semantic review of all assigned source**. Per-file coverage is in `coverage.json` and `coverage.tsv`; exact inspected ranges are recorded there.

## FE-001 — Switching QSO editor surfaces loses the explicit manual UTC display mode

- Severity: **Medium**. Operators entering delayed/historical contacts can see their explicitly selected UTC replaced by the current clock merely by switching editor modes. The main editor also submits the new current UTC in its save argument; the backend's separate date bug must be fixed independently.
- Confidence: **High**. Reproduced with the actual React components and existing isolated fake backend; no production application, personal logbook, provider or hardware was used.
- Locations: `/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src/live/OperatorDesk.tsx:43` and `:46` (`DeskQSO`), `/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src/live/QSOEditorCore.tsx:123` and `:159` (`QSOEditor`), `/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src/live/DetachedQSOSurface.tsx:173` (`switchMode`). `OperatorDraftSnapshot` already has canonical `automaticStart` metadata in `/Users/oliver/Documents/Projects/OM0RX-xLog/Sources/XLogCore/OperatorDraft.swift:12`, but `DraftSnapshot` in `prototype/src/live/operatorDraftSession.ts:20` and the editor props omit it.
- Trigger: Open detached Log QSO in Full mode; enter a valid explicit historical UTC date and time; allow its normal draft replacement to be acknowledged; switch to Simple.
- Observed: Canonical retained `start` remained `2026-10-20T10:15:30Z` with acknowledged canonical `automaticStart:false`; the new Simple editor displayed `2026-10-28` / `12:34:56` (the injected current time). The switch was allowed because the manually entered fields were valid and acknowledged. Reopening the same Full editor has the same initialization problem by static inspection.
- Mechanism: Both editor components initialize `automaticStart` as `!isEditing`; a shared *new* QSO remains `isEditing=false` even when its time was deliberately changed. A mode switch mounts a new component, discarding the local manual-mode flag. The reset effect repeats this on draft/reset identity changes. The canonical draft metadata is not passed into either component. Each editor then renders the live clock; `DeskQSO.saveCurrent` and `QSOEditor.submit` can submit that live time.
- Evidence: `manual-time-mode-repro.log`; retained generator `prepare_repro.py` creates `detached-time.test.tsx` by copying the existing test fixture and appending an isolated test. Command from the repository's `prototype` directory:

  `node node_modules/vitest/vitest.mjs run --config /tmp/xlog-review-20261028-4bd554a/frontend/vitest-review.config.ts -t 'REVIEW retains manual'`

  Result: 1 expected regression assertion failed; 47 copied existing tests skipped. The assertion expected displayed manual date `2026-10-20`, received `2026-10-28`.
- Safeguards checked: `switchMode` blocks unfinished local buffers and pending operations, but a valid acknowledged manual timestamp no longer counts as an unfinished buffer. `OperatorDraftSession` preserves the canonical QSO, so the display-mode loss occurs after successful draft persistence. Existing QSOEditor timestamp test verifies manual time only within one component mount and historical *contact editing* (`isEditing=true`), not remounting a new-QSO editor with a canonical manual time.
- Focused recommendation: Carry the canonical `automaticStart` state through the typed snapshot/session/editor contract and update it when the operator changes date/time. Reuse that state on mount and cross-window/mode navigation, keeping contact identity/revision guards. Do not infer timestamp intent from QSO presence or `isEditing`.
- Regression: Enter explicit time, await acknowledged draft replacement, then exercise Full→Simple→Full, main Desk→full editor, detached close/reopen, and process restart against disposable storage. Assert both rendered date/time and final stored timestamp, including a live automatic draft as a control.

## FE-002 — Radio power capture is described as KPA500 amplifier output

- Severity: **Low**. The captured numeric value is retained, but the displayed hardware source is false for radio-output samples, undermining the operator's assessment of where the logged power came from.
- Confidence / status: **High; reproduced** by calling the current `draftPowerDescription` with a sample whose native source is `radio_output` and selected context meter source `radio_output`.
- Location: `/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src/live/QSOEditorCore.tsx:111`, `draftPowerDescription`; allowed source contract at `prototype/src/live/operatorDraftSession.ts:5` and `:55` includes both `kpa500_output` and `radio_output`.
- Trigger / mechanism: Any matching current contact with a `selectedSample` enters one hard-coded return string, regardless of `selectedSample.source`. Observed result: `Captured KPA500 output · retained for this contact.` for a radio-output sample. Both enabled and disabled branches have the same attribution error.
- Evidence: `power-source-label-repro.log`, command `node node_modules/vitest/vitest.mjs run --config /tmp/xlog-review-20261028-4bd554a/frontend/vitest-review.config.ts -t 'REVIEW describes captured'`; one expected assertion failure, 48 unrelated tests skipped.
- Focused fix / regression: Select the label from the captured sample's native source, retaining the source identity with its timestamp; test `radio_output` and `kpa500_output` in enabled/disabled states. Consolidate with any native source-attribution finding if the final review identifies a shared user-visible flow; do not infer numeric power corruption from this label issue.

## Backend finding forwarded to root for independent validation

`Sources/XLogCore/LogbookDatabase.swift:1945` sets local `automaticStart = true` while preparing the *next* draft, before `:1948` checks the same variable to stamp the *saved* QSO. This makes the save-time check unconditional and overwrites explicit manual timestamps. Static confidence is high; root owns real-SQLite reproduction and final finding ID. This is distinct from FE-001's UI metadata omission, though both affect manual UTC preservation and can be grouped in remediation.

## Withdrawn candidate / false-positive challenge

An earlier fake-backend reproduction (`detached-time-repro.log`, two tests) showed that detached save callbacks ignore the submitted current-UTC QSO supplied by `DeskQSO` / `QSOEditor`, unlike `MainLiveApp`. **Do not report that alone as stale production automatic UTC.** Real `LogbookDatabase.applyOperatorDraft` stamps automatic drafts at save time, whereas the existing frontend fake backend does not implement `automaticStart`. The two original assertions therefore demonstrate a mocked contract mismatch rather than sufficient proof of the original production claim. The subsequent real-code inspection found the manual-UTC backend bug above. The retained manual-*display* repro is unaffected by this fake backend limitation because it asserts rendered and retained draft values before save.

## Architecture and flows examined

- `main.tsx` mounts only the requested lazy `windowSurface` within React StrictMode. Native acceptance requires both a query and native CLI-enabled gate. Unknown window loads render an error rather than mounting the main station controller as a child fallback.
- `MainLiveApp` owns normal-logging view orchestration; detached windows have narrow participants. Frontend worker transport carries an operating context, UUID and allowlisted methods into Tauri. Durable operations use native Swift storage, not renderer-only logbooks.
- `OperatorDraftSession` and `LogbookContactSession` combine canonical revision/workspace generation with locally retained journals. Save/replace/retry paths correlate exact durable receipts. Historical contact edits can nonoverlapping-rebase but do not overwrite conflicting simultaneous changes. Delete/Undo uses `LogbookMutationSession` revision fencing.
- Spot activation freezes participants and reconciles canonical state. Native close/canvas/module preparation checks buffered local input as well as pending durable operations.
- ADIF import is previewed in bounded batches with generation and preview tokens; duplicate-update selections are explicit. Export reads a bounded native snapshot into a client export document. The deeper ADIF/ADX codec was only partly inspected.
- Sync UI records intent before native mutation and only reads receipts on uncertain outcomes. Conflict merge review fences the displayed revision. Credential widgets query presence metadata and clear entered values after successful secure save.
- Contest client mutations compute stable payload digests and operation timestamps. Master/replica contact journals bind local/authority workspace identities. Unfinished note recovery preserves exact malformed bytes and prevents overwriting changed records. Most contest UI implementation remains scan-only because the controller and tests together are large.

## Checks

All below were read-only checks except disposable files in this directory and normal ignored frontend build/test outputs. No dependency install, package installation, native GUI launch, radio, transmit or live account calls were performed.

| Command | Actual result | Evidence |
| --- | --- | --- |
| `npm test` in `prototype` | Node tests **2/2 pass**. Vitest **336 files pass / 1 fails**, **4705 tests pass / 2 fail**, 584.45s. Both failures are 5000ms timeouts in Not1MM contest voice-intent tests. | `npm-test.log` |
| `node node_modules/vitest/vitest.mjs run src/contesting/Not1MMContestWorkspace.test.tsx -t 'simulates only claimed.*voice-keyer intents' --maxWorkers=1` | **2 pass, 193 skipped** in 8.54s. This indicates timing sensitivity; it does not erase the full-suite failure or establish its cause. | `voice-intent-rerun.log` |
| `node node_modules/vitest/vitest.mjs run src/contesting/Not1MMContestWorkspace.test.tsx --maxWorkers=1` | **195/195 pass**, 31.87s. Full affected-file rerun after initial suite completed. Cause of original timing failures remains unproved. | `not1mm-file-rerun.log` |
| `npm run build` | **Pass**: `tsc --noEmit`, Vite 8.3.4 production frontend build (1971 modules), and window-bundle dependency checks. | `npm-build-cli.log` |
| `npm audit --json` | **Pass**, 0 published vulnerabilities returned for the resolved dependency graph (167 dependencies in audit metadata). This is registry evidence, not an independent security proof. | `npm-audit.json` |
| Isolated manual UTC mode test above | **Reproduces FE-001**; one expected failed regression assertion. | `manual-time-mode-repro.log` |
| Isolated radio power-source description test | **Reproduces FE-002**; one expected failed label assertion. | `power-source-label-repro.log` |
| Whole-file scanner for eval/unsafe HTML/navigation/console/fetch/storage | All inventoried text read by scanner. No unsafe DOM/eval/new Function production-source match; 1 browser-preview `window.open`; no broad security conclusion inferred. | `scan-hits.json`, `scan_frontend.py` |
| `git diff --name-only -- prototype/package-lock.json prototype/package.json` | Empty. Manifest and lockfile unchanged. | command output |

Exact timeout names: `simulates only claimed CQ WPX SSB voice-keyer intents in Contesting Test` and `simulates only claimed ARRL Sweepstakes Phone voice-keyer intents in Contesting Test`, both declared at `prototype/src/contesting/Not1MMContestWorkspace.test.tsx:2377`.

Initial MCP build job reported running without creating its log or a build process. The build was subsequently executed once successfully via lean-ctx CLI with explicit cwd. Intermittent long MCP reads similarly fell back to lean-ctx CLI. Several isolated-test setup attempts failed before collecting tests due to external-root Vite module resolution; those were harness setup errors, not application failures, and were corrected in the retained generator/config. The final manual-mode assertion executes application components.

## Coverage and remaining work

Inventory expanded to include `prototype/src`, `prototype/tests`, root HTML previews, Vite/TS config and package manifests: **814 files, 97,998 lines**. Coverage classification after this pass: **22 fully reviewed, 17 partially reviewed, 764 scanned only, 10 not reviewed, 1 excluded**. Test execution is recorded separately and is never counted as full manual review. The excluded item is a static bitmap asset; 10 unreviewed files are visual-test geometry scripts. Generated output, `node_modules`, `dist`, Rust target output and runtime bundles are excluded from routine source review.

Exact next work:

1. Complete semantic walkthroughs of the remaining `MainLiveApp` state transitions and `Not1MMContestWorkspace` (~4000L), especially voice/digital cancellation, per-lane operation ownership and master/replica changes.
2. Review the entire detached contest protocol/controller and remaining detached normal windows; inspect sender validation and lifecycle contracts with Rust, rather than treating React event typing as a trust boundary.
3. Review the unexamined ADIF/ADX codec, all custom export metadata types, all settings subsystem journals, maps/band-map classification, awards and propagation inputs.
4. Manually inspect error/cancellation/partial-failure assertions in critical tests; suite execution alone does not prove a complete oracle or native behavior.
5. Run native UI acceptance only under the exact isolation/process verification requirements in AGENTS.md; no installed/provider/RF proof is supplied here.
6. Evaluate the timing-sensitive contest voice tests under representative CI resources after checking whether their 5000ms bound is appropriate; preserve the original failure and repeated-result evidence.

No frontend application/test/configuration source was changed by this review. Root owns consolidating/committing reports.
