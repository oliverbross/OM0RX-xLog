# Editor input at first DOM commit

Status: **reproduced and fixed in source**; new packaged/Linux qualification remains separate. Source baseline is held 1.5.17, `6e3dc9746e4fe25df52c44d1ae1b365a4c89bce0`. No installed daily app or operator data was changed.

Linux job `127098114409` in run `41983234450` failed `retains invalid historical editor buffers across menu navigation and Close requests` after menu navigation could no longer find `Frequency MHz`. The raw failure did not capture the input value or effect ordering immediately before navigation, so the exact original Linux interleaving remains inferred. The file fully mocks `useSharedCW`; the polling changes do not execute in this fixture.

Independent reproduction found a concrete input-loss race. A MutationObserver types `14..` as soon as the historical full editor's input enters the DOM, using actual React hooks and the normal mocked worker boundary. Before the fix, the input is accepted and marks the editor's local buffer pending, then the passive identity/mount reset clears it back to `14.074000`. The owner reports no pending buffer and subsequent Settings navigation can remove the editor. No effect deferral, sleeps, timeout changes or retries are required by the committed regression.

The minimal fix changes the identity/reset effect in `QSOEditorCore` from `useEffect` to `useLayoutEffect`. The same identity/epoch/edit-mode changes still reset the same buffers, but finish before first-commit input can arrive. Input validation, navigation/Close guards and canonical draft ownership are unchanged. The separate Follow reset was checked through first-commit new-QSO input with initial Follow enabled: that route passed before and after, so its behavior was not changed without a demonstrated failure.

The existing historical-buffer test now verifies that `14..` was accepted and Close is blocked before requesting navigation. Two additional actual-hook cases cover historical and new-QSO first-commit input, preserved element/value, native menu veto, Close explanation and no spot activation. Before the source fix, the historical case failed deterministically while the new-QSO case passed. Both pass after the fix.

Verification: **245 tests passed in 10 affected files**, including full/historical editor, power/country fields, detached QSO surface, clock provenance, canonical contact session, Desk, presentation and workspace navigation. `npx tsc --noEmit` and `git diff --check` passed. Exact command:

```sh
npm run test:vitest -- tests/live-app-spot-barrier.test.tsx \
  src/live/QSOEditor.test.tsx src/live/QSOEditorCountry.test.tsx \
  src/live/QSOEditorPower.test.tsx src/live/DetachedQSOSurface.test.tsx \
  src/live/OperatorDraftTime.test.tsx src/live/logbookContactSession.test.ts \
  src/live/workspaceNavigation.test.ts src/live/OperatorDesk.test.tsx \
  tests/live-app-presentation.test.tsx
```

Ignored diagnostic probes remain under `.build/quality-ci/spot-barrier-probe/`; the original Linux raw log is `.build/quality-ci/run41983234450/job-127098114409.log`. The probes established the scheduling mechanism before tracked source changes; they are not a replacement for the release's full native/CI gates. The release owner will assign a unique next candidate version and record its exact source/artifacts.
