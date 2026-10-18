# Main 1.2.20 compatibility checkpoint

The isolated `codex/contest-main-1-2-20-integration` branch merges contest source
`7839324ee7dd0801f0a043999919ff77ed9eb469` with accepted main source
`e9ef0c564323cf5a79be3d48f5b7389d8b0b1e66`. Root confirmed the canonical checkout
was clean at that main commit and `/Applications/OM0RX-xLog.app` reported 1.2.20.
The main task supplied the signed-package and live previous-QSO layout evidence.
No installed app, canonical source, normal database or station configuration was
changed by this integration.

Two merge conflicts were resolved and reviewed. `LiveApp.tsx` retains contest
navigation and visibility while preserving the incoming radio connection label.
`LiveStationMethodsTests.swift` retains both the malformed station-connect
regression and the independent rotor snapshot test. The remaining incoming
changes preserve the complete main source, including observed-radio/spot
activation behavior, cluster filtering and the previous-QSO layout.

Validation passed on the resolved union:

- 143 contest core and 73 contest store tests.
- 72 XCTest support tests: history worker 3, contest lane 22, station methods 30,
  and remote observed snapshots 17.
- 30 Swift Testing cases for operator drafts, Follow Radio and opportunities.
- 250 frontend tests across 23 files, including all contesting tests, workspace
  menus, previous-QSO/Desk views and the live-app spot barrier.
- TypeScript, the production frontend build and window bundle checks.

| Evidence | SHA-256 |
| --- | --- |
| `/tmp/xlog-main-1-2-20-integration-swift.log` | `1ff11d0b64202d620ed7e73829ffe9a40f12701edf4fbb8bca7406eda58ed6c2` |
| `/tmp/xlog-main-1-2-20-integration-frontend.log` | `ea3c40eefd46322ee3d29e0f1058ab1461606aaf426cb0b320cb9dbaad5eafc6` |
| `/tmp/xlog-main-1-2-20-integration-build.log` | `c016c22814214f180f2bcbf1d21957b724c5ec970c7cc1b535294f8afc7ecbc8` |

Swift used `XLOG_PORTABLE_ONLY=1`, two jobs, and the absolute scratch path
`/Users/oliver/.codex/worktrees/xlog-contesting/OM0RX-xLog/.build/arrl-dx-core-integration-portable`.
The exact filter was `XContestCoreTests|XContestStoreTests|ContestingLaneTests|ContestCallHistoryWorkerTests|LiveStationMethodsTests|RemoteAgentObservedSnapshotTests|OperatorDraftTests|OperatorDraftRadioFollowTests|LiveOpportunitiesMethodsTests`.
Frontend validation used `npm --prefix prototype run test -- src/contesting src/workspaceMenuAcceptance.test.tsx src/live/DeskMapLogbook.test.tsx src/live/DeskPreviousQSOs.test.tsx src/deskMapLogbookAcceptance.test.tsx tests/live-app-spot-barrier.test.tsx`, followed by `npm --prefix prototype run build`.

This is a source compatibility checkpoint, not final integration or release
acceptance. Definition persistence `363062e` is not yet included. Exact-source
platform CI, fresh combined operator simulation, exclusive module ownership and
packaged runtime acceptance remain open. The main task continues versions
1.2.21–1.2.23; root notified it of this branch, conflict resolutions and scope.
Final integration must reconcile its latest accepted release again. No RF,
PTT, keying or actual station commands were part of this validation.
