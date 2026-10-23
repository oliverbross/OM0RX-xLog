# CQ WW SSB — 0369a44a final pre-contest review

Date: 24 October 2026. User reports contest start is imminent. This is a short finishing/acceptance instruction, NOT a request to restart implementation or the full parity audit.

## Decision

Keep the current candidate and rollback. The requested DUPE display, local feedback, action buttons, Space-to-zone routing, SCP layout improvements, and configured-band/CQ-zone views have real implementation changes. Exact-source regular and macOS integrated CI are green. No new confirmed contact-loss defect was established in this focused review.

However, one substantial acceptance-evidence gap and two bounded UI defects remain. Do not equate the reported browser rehearsal with an end-to-end test of the installed Python/Not1MM desk. Complete the finite actual-path check below before declaring the intended station workflow ready. Freeze feature work; do not introduce new audio, radio, scoring or layout infrastructure.

## Identity and scope

- Implementation reviewed: `0369a44a0404076815492f888e4fead312b1747b`.
- Current documentation/main checkpoint: `be7b1ca284715299fe4966916e5af785f2ca7451`.
- Compare confirms the latter adds only acceptance documentation and three evidence files. It does not change the installed executable source.
- Read-only source review covered changed Entry/status/action handlers, shared projections, SCP and multiplier rendering, acceptance runner/fixture/worker selection, reported package evidence and exact-source CI. It was not a complete application/hardware certification.
- The reviewer's remote Mac connector is offline. Signing, receipt matching, installed inspection, local large-suite counts and rollback existence remain Codex-reported evidence, not independently rerun Mac results.
- One independent Node probe reproduced the Matrix filtering defect using extracted logic and synthetic rows. It was not a React or installed-app test.
- Existing reported rollback: `/Applications/OM0RX-xLog-previous-20261023T170228Z-44586.app`. Do not remove it or repeat cleanup.

## What is demonstrably improved

1. `DetachedContestSurface.tsx` now actually renders `DUPE — ... already worked on ...` and a clear/checking state. Previously the backend/projection data was not displayed.
2. The Entry renderer now has Log It, Wipe, Edit last and Stop controls; `Surface` presents rejected-operation feedback and only presents `QSO saved` after an applied commit-like action with an advanced draft identity.
3. `Not1MMContestWorkspace.tsx` supplies `spaceNext: { callsign: "other_2" }` for `cq_ww_ssb`.
4. Check now wraps candidate characters as a whole callsign and avoids adding empty Telnet/Call History panes. Do not reimplement its search backend.
5. Matrix projections expose configured/current band scope; CQ zone rows are seeded 1–40 and repeated blocks are rendered. The old fixed-only display problem is partly addressed; the country filter defect below is distinct.
6. Exact `0369a44a` GitHub checks: `test-and-package` SUCCESS (run `39989817887`, job `120538374661`); `prototype (macos-14)` SUCCESS (run `39989817899`, job `120538377942`). Linux runtime-only and Windows fresh-runner checks are SKIPPED, not passed; they are outside the stated imminent macOS scope.

## R1 — acceptance rehearsal targets the retired lane (HIGH confidence; evidence gap, not proof of a broken app)

The committed `operator-rehearsal.json` selects:

`XLogPrototypeTests.ContestOperatorBrowserAcceptanceTests/testRealWorkspaceAndMutationOwnerAgainstIsolatedLiveWorker`

Trace at the exact source:

- `Tests/XLogPrototypeTests/ContestOperatorBrowserAcceptanceTests.swift`: `newWorker()` constructs `LiveWorker(logbook: ..., runtimeProfile: profile)`; its profile is `.contestingTest`. It does not supply `ownsProcessSessions: true` or `pythonContestConfiguration`.
- `Sources/XLogPrototypeSupport/LiveWorker.swift`, approximately 153–189: `ownsProcessSessions` defaults to false. `selectsPythonContestLane = runtimeProfile == .production || ownsProcessSessions || pythonContestConfiguration != nil`. Therefore this test worker selects the explicitly retained retired Swift `ContestLane`, not the bundled Python lane.
- `prototype/tests/acceptance/contest-operator-worker.tsx` mounts `ContestWorkspace`, not `Not1MMContestWorkspace` plus the detached `Entry` renderer.
- The JSON is an outer runner summary. Its detailed `acceptancePath` points to a local `/tmp/.../evidence/acceptance.json`; the committed summary does not itself contain all reported per-QSO observations.

The passed rehearsal is real useful legacy coverage. It does NOT prove end-to-end Run/S&P logging, dupe, scoring and export in the exact desk Oliver will use. The general native 35/35 checks also must not be relabeled as 35 CQ WW scenarios.

**Action now:** exercise the existing actual packaged Python-backed contest desk in a disposable isolated session/profile. Confirm the opened session identifies `engine: not1mm-python` and `pluginID: cq_ww_ssb`. Exercise its actual Main Logging and Log Display windows. No new harness architecture or rerun of all historical suites is required. Keep legacy evidence but correct its scope in the acceptance record.

## R2 — single-band DXCC Needed can never show unworked countries (reproduced isolated logic)

`DetachedContestSurface.tsx`, `Matrix`, approximately 828–839:

```ts
const source = projection.rows.filter(row =>
  !dxcc || visibleBands.some(band => (row.counts[band] ?? 0) > 0));
// Only afterwards does the code calculate rowFilter === "needed".
```

For one visible band, the first filter keeps only rows with count > 0; the Needed filter then requires count == 0. The result is always empty. All also means worked in the visible band rather than all countries. Moreover, the country projection currently supplies worked rows, not a complete eligible-country universe.

Independent synthetic probe:

- OM worked on 40 m; DL worked on 20 m but not 40 m; K unworked.
- Visible bands = [40m].
- Actual All = [OM]; Actual Needed = []; under those selector labels expected All = [OM, DL, K], Needed = [DL, K].
- The probe asserts the observed implementation result; it does not pretend the app passed the intended behavior.

**Impact:** display/needed-multiplier guidance, not proven database or score damage. Do not interpret an empty DXCC Needed view as all countries worked.

**Deadline action:** the operator can use DXCC as worked-only and use the existing contest Cluster opportunity classification plus CQ-zone view. Do not hold up the contest for a new entity catalogue. If making a narrowly accepted fix, remove the contradictory prefilter and use the already available eligible country/reference data; otherwise accurately label/disable unavailable All/Needed country functionality. Do not fabricate unworked entities or alter QSO scoring.

## R3 — Space focuses the zone but does not select it (source-confirmed)

`DetachedContestSurface.tsx` `onKeyDown`, approximately 638–647, follows `spaceNext` but calls only `.focus()`. `EntryIntentInput`'s onFocus only requests the shared focus; `ContestTextField` is a plain input and supplies no select-on-focus behavior.

The supplied N1MM manual page 53 requires smart-tab to highlight the existing zone so the next digit replaces it. Current xLog focus movement does not implement that selection. Depending on the retained caret/selection, typing a replacement can append to the prefilling rather than replace it. No installed-browser caret behavior was independently tested here.

**Safe workaround now:** after Space, press Cmd+A inside the zone field before typing the actual received zone. Confirm it visually. Never rely on CTY's guess over the received exchange.

**Small optional fix:** select the target exchange input's contents on the explicit smart-Space action only. Do not globally select every field on every asynchronous focus/refresh, or steal a user-positioned caret. One focused prefilled-zone replacement check is enough. No need for a full rebuild merely to remove this documented workaround if the candidate otherwise passes.

## R4 — real event log and radio checks (operational prerequisites, not new coding projects)

The newest installed acceptance still reports 4 retained QSOs, 6 multipliers and score 24 before the event, plus an active OM0A draft. Verify the actual log selected for the contest. Preserve the older log and create/select a clean actual-event session with the correct start UTC rather than carrying rehearsal/pre-contest entries into the contest counters/export. Never delete real historical QSOs or log a fake OM0A solely to unblock a transition.

Official event start: 24 October 2026 00:00 UTC (09:30 Darwin). Station information and sent zone refer to the transmitter location, not the remote laptop. Confirm the actual category, power and assistance choices; do not infer category from the visible 40 m display filter.

If OM0A is merely a test draft, the OPERATOR can Wipe it; this should clear the draft, not delete saved QSOs. If it is an unfinished real contact, retain/resolve it deliberately. The normal-window transition guard is not itself proof of failure. Avoid switching modules during the contest unless needed.

Live Flex/Maestro readback and one chosen receive tune remain unperformed. They matter more than a fresh QRZ lookup or further visual polish. With manual microphone operation and output unarmed, the operator should confirm a manually changed frequency is reflected accurately in Entry and Band Map, and that the correct radio/slice receives a deliberately selected spot. Do not issue hardware actions automatically. If that check fails, do not rely on automatic radio-frequency logging or spot tuning until a known-good manual path is confirmed.

For an OM station in ITU Region 1, do not transmit above 7200 kHz in CQ WW SSB. A 40 m band display extending to 7.3 MHz is not transmit permission. This is an official contest rule, not a request for a last-minute regulatory framework.

## Finite final actual-path check

Use the actual candidate's existing isolated Python contest route with transports disabled, or an explicitly disposable non-production session. No synthetic rows in the real event log, no provider writes, no public spots, no PTT/audio/RF/rotor actions.

1. Record installed source identity and the active test session's engine/plugin. It must not be the retired Swift fixture.
2. Enter one domestic test QSO on 40 m and one different-continent QSO using fixed reference data, in Run and S&P respectively. Include a nondefault received report (57) and a changed prefilled zone using the current keyboard path. Confirm exact stored values.
3. Re-enter the first call on 40 m: visible DUPE before logging. Complete that deliberately repeated test contact and verify no additional points or multipliers. Change call/band rapidly and verify the result follows the current identity, not an old response.
4. Try an invalid zone (41): local error, no saved QSO, entry retained. Do not count a focus move or button click as a successful commit.
5. Correct a contact's received zone in the actual Log Display and confirm the new value and multiplier state. Exercise deletion only for a known disposable row, retaining normal audit behavior.
6. Export Cabrillo/ADIF through the actual candidate path, inspect counts, UTC, actual frequency, PH/SSB representation, calls and exchanges. Restart once and re-open the disposable session: no lost/doubled contacts or altered score.
7. Return to the correctly prepared real event session without moving test contacts. Preserve backup and rollback. Perform only the operator-controlled receive/tune check described above.

For a minimal synthetic station OM0RX/OM/EU/zone15, OM0A/OM/EU/15 on 40m gives 0 points and 2 multiplier instances; K1ABC/K/NA/5 on 40m adds 3 points, bringing the total to 4 multiplier instances and score 12. Logging a repeat OM0A should retain a third row while leaving score 12. These tuples are explicit fixture values, not live callbook assertions. Equivalent existing correct fixtures may be reused.

If existing installed Python-specific evidence already proves these same actions at this source, cite that evidence instead of rerunning. The legacy rehearsal identified in R1 is not that evidence.

## Execution cadence / release decision

- No new full project-management cycle, PDF parity audit, audio transport, scoring engine, radio-settings redesign, cleanup or cross-platform packaging.
- Keep the signed candidate frozen while doing acceptance. Fix only a reproduced show-stopper that prevents correct logging, persistence or export. The two identified UI gaps have explicit temporary workarounds.
- If a small production fix is genuinely required and feasible, make one bounded patch, its direct regression and one replacement candidate. Preserve rollback. Do not rebuild after each cosmetic adjustment.
- Do not weaken draft/mutation safety just to permit opening normal logging. Do not log a phantom contact to clear a retained draft.
- Final result: actual Python-backed desk PASS/FAIL; observed limitations; operator receive/tune check PASS/NOT TESTED; and exact source. Full suite counts and absence of findings from a previous reviewer are not substitutes.
- READY WITH LIMITATIONS is reasonable only for the demonstrably tested manual-microphone workflow with limitations accepted by Oliver. If the real path cannot save, warn on duplicates, recover or export, stop and use an already working logger rather than debug live contest QSOs.

## Source references

All code links below use the installed implementation SHA.

- [Entry renderer, Space handling and status/actions](https://github.com/oliverbross/OM0RX-xLog/blob/0369a44a0404076815492f888e4fead312b1747b/prototype/src/contesting/DetachedContestSurface.tsx#L620-L741)
- [DXCC filter / Matrix](https://github.com/oliverbross/OM0RX-xLog/blob/0369a44a0404076815492f888e4fead312b1747b/prototype/src/contesting/DetachedContestSurface.tsx#L815-L870)
- [Matrix projection helper](https://github.com/oliverbross/OM0RX-xLog/blob/0369a44a0404076815492f888e4fead312b1747b/prototype/src/contesting/Not1MMContestWorkspace.tsx#L573-L592)
- [Actual rehearsal UI target](https://github.com/oliverbross/OM0RX-xLog/blob/0369a44a0404076815492f888e4fead312b1747b/prototype/tests/acceptance/contest-operator-worker.tsx)
- [Rehearsal worker construction and test profile](https://github.com/oliverbross/OM0RX-xLog/blob/0369a44a0404076815492f888e4fead312b1747b/Tests/XLogPrototypeTests/ContestOperatorBrowserAcceptanceTests.swift#L24-L28)
- [Explicit retired/Python lane selection](https://github.com/oliverbross/OM0RX-xLog/blob/0369a44a0404076815492f888e4fead312b1747b/Sources/XLogPrototypeSupport/LiveWorker.swift#L153-L208)
- [Committed rehearsal runner summary](https://github.com/oliverbross/OM0RX-xLog/blob/be7b1ca284715299fe4966916e5af785f2ca7451/docs/contesting/evidence/cq-ww-ssb-0369a44a/operator-rehearsal.json)
- [Acceptance report](https://github.com/oliverbross/OM0RX-xLog/blob/be7b1ca284715299fe4966916e5af785f2ca7451/docs/contesting/NOT1MM_OPERATOR_ACCEPTANCE_2026-10-20.md)
- [macOS integrated CI](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39989817899/job/120538377942)
- [Regular CI](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39989817887/job/120538374661)
- [Official contest date](https://www.cqww.com/)
- [Official rules](https://www.cqww.com/rules/)

This document is on the review documentation branch only; no application source, main ref, installed app or production data was modified by this review.
