# Supplemental independent fldigi Stop review

Verdict: **confirmed Medium / P2 frontend recovery/presentation defect** (root candidate FA-017; local F6-FE-002), separately bounded from the backend filesystem-before-RX Stop issue. Sources are canonical `0375a8e1` / app source `f3f6e3de`. No canonical files changed, no real fldigi/RPC/provider/native UI/station/RF used.

## Trigger and call chain

1. A supported RTTY contest has fldigi macro transmit enabled. Open Productivity desk → Entry & stack, which is reachable even with production `setupOnly` owner (`DetachedContestSetupSurface.tsx:233`; `Not1MMContestWorkspace.tsx:3876-3878,3914-3917`). `fldigiPanelReady:3775` depends only on support and saved transmit configuration.
2. Press its Stop. `Not1MMContestWorkspace.tsx:3797` awaits a successful service promise but **ignores the returned snapshot**, instead forcing local configuration false, receive_running false and status Off.
3. Backend `LiveFldigiBridge.swift:205-210` disables configuration then calls `returnToReceive(emergency:true)`. The latter catches `main.rx` failure (`:315-325`), sets `releaseUncertain=true`, and returns a successful snapshot containing status `fldigi receive release is unconfirmed; use Stop to retry before transmitting.` plus `transmit_release_required` / `transmit_release_uncertain` (`:345-350`). A fulfilled response therefore does not establish confirmed receive release.
4. The UI now treats saved configuration false as unavailable; `cwPanel:3779-3781` returns an unavailable-macros panel without Stop or the release warning. Operator surface projection `:2861-2862,2927-2931` publishes disarmed, not uncertain. `boundedFldigiSnapshot:738-747` drops both release flags. Later bounded snapshots retain the status string but still cannot show it in the unavailable panel.
5. Main Logging surface Stop/Escape routes through `handleSurfaceAction:3162-3164` → `stopAutoCQ:2113-2120`, which stops CW/phone only. It does not retry fldigi receive release. This is true regardless of the removed Productivity Stop control.

## Independent current-component proof

`make-fldigi-proof.mjs` copies the repository's established Not1MM test file into scratch, resolves its imports back to canonical actual source, and appends two focused cases. `fldigi-stop.test.tsx` renders actual Not1MMContestWorkspace with `setupOnly`; existing native bridge, station and surface registration mocks are retained. Only the two appended tests execute (`--testNamePattern 'fresh fldigi uncertain Stop'`); 195 original tests are skipped, not claimed as rerun.

`fldigi-stop-r3.log` is the final proof and shows **one expected requirement failure and one confirmed-Off passing control**. The final fixture starts in the source-valid state after an earlier admitted macro completed: transmit_enabled=true, status=`Sent 1 fldigi macro.`, transmit_release_required=true and transmit_release_uncertain=false. Native send sets duty before TX (`LiveFldigiBridge.swift:224-227`), retains it after the successful macro and clears sendInFlight with defer; snapshot projects that retained duty at `:350`. Failed RX retains required=true and sets uncertain=true; successful RX clears both. This models those actual native branches without executing a macro, RPC or RF. With its fulfilled uncertain Stop snapshot:

- Immediately after Productivity Stop, `hasStop=false`, `hasUncertainty=false`, operator.status=`disarmed`, operator.armed=false.
- Calling the actual setup owner's `saveDigital(action:'stop')` performs a second fldigi Stop and reads the current uncertain snapshot. Even after that fresh readback, the rendered warning/Stop remain absent and the operator projection remains disarmed.
- A subsequent actual surface-owner Escape action makes **zero additional fldigi_stop calls** (2 before and 2 after) while the mocked CW stop count becomes 1.
- With an otherwise identical confirmed-Off result and both flags false, the expected disarmed control passes.

The first `fldigi-stop.log` attempt lacked the fixture's wsjtx_stop response and failed before final assertions; it is retained as harness setup evidence, not counted as an application failure. `fldigi-stop-r2.log` established the rendered behavior but began without an explicitly retained duty; the final r3 fixture strengthens the exact backend precondition by starting after a completed macro. Native backend release behavior is independently source traced, not executed by this JS proof.

Exact final command, from `/Users/oliver/Documents/Projects/OM0RX-xLog` (exit 1 is expected because the regression requirement fails):

```sh
node /tmp/xlog-phase6-fresh-20261029-0375a8e1/agents/frontend/make-fldigi-proof.mjs && node prototype/node_modules/vitest/vitest.mjs run fldigi-stop --testNamePattern 'fresh fldigi uncertain Stop' --config /tmp/xlog-phase6-fresh-20261029-0375a8e1/agents/frontend/vitest.config.mjs --configLoader native --cache false > /tmp/xlog-phase6-fresh-20261029-0375a8e1/agents/frontend/fldigi-stop-r3.log 2>&1
```

Final result: uncertain=true FAIL (`expected 'disarmed' to be 'uncertain'`), uncertain=false PASS, 195 original cases skipped. These two scratch cases do not change the separate 1442 existing-suite pass count.

## Safeguards and limits

The backend retains its transmit duty and `releaseUncertain`; `fldigi_send` rejects subsequent sends while release is uncertain (`LiveFldigiBridge.swift:220-223`). No evidence here proves actual RF remains on, bypasses that guard or shows all possible recovery paths are impossible. The actual defect is reporting disarmed/hiding the dedicated retry despite explicit unresolved engine evidence, and routing Main Logging Stop to a different output owner.

Digital Setup can invoke another Stop when its UI permits it; the proof deliberately exercises its real owner callback as a recovery control. Its visible `Stop listening` enablement (`DetachedContestDigitalDialog.tsx:66`) uses only WSJT-X running/configuration, so a fldigi-only configuration can disable that alternate button. Its fldigi heading also derives `Stopped` from receive/configuration (`:54`) rather than release evidence. Other native retirement paths or operating fldigi directly may still release the engine. Do not claim complete recovery impossibility.

## Origin, coverage and repair direction

`git diff 530de4c4..HEAD` is empty for Not1MMContestWorkspace, contestSetupDialogs and DetachedContestDigitalDialog. Before CR-003, the same UI hardcoded Off and removed Stop; the old backend `returnToReceive:289-292` swallowed `main.rx` errors with try?. The later backend ownership repair (`3d832cdf`) adds meaningful retained release uncertainty, while all these UI callers remain unchanged. This is a **pre-existing UI weakness / incomplete CR-003 cross-boundary integration**, not a demonstrated newly introduced regression.

Existing Not1MM RTTY fixture cases at `Not1MMContestWorkspace.test.tsx:2751-2784` check enabled/disabled output availability and prevention of unsupported sends; the digital dialog owner fixture at `:215-249` returns ordinary successful Off. Neither injects fulfilled uncertain Stop results. The new proof specifically distinguishes actual Off from unconfirmed RX.

Repair by preserving returned release state through bounded schemas and operator projections, showing uncertainty independently of transmit configuration, retaining an enabled dedicated fldigi Stop/retry while unresolved, and routing relevant Escape/Stop through the retained output owner. Do not solve this by clearing backend uncertainty or by re-enabling macro transmit. Keep confirmed-Off behavior, stale context fences, backend send rejection, and alternate recovery paths.
