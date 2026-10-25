# REC acceptance ledger

Delivered candidate **1.3.20** / source **`5e48489f6a1d2408920ed0a29d4d7da173a295d4`** passes its software/package checks. Verdict: **NOT READY for live audio acceptance**. The operator confirmed that the station audio route is disconnected. Fixture results below establish software behavior only; the final candidate receipt records exact version/source/signing separately.

Evidence sources: native `contest_recorder*` tests; real Python `test_recorder`, `test_analytics`, CQ WW SSB host tests; focused React/key/owner tests; explicit signed-bundle `--recorder-acceptance` fixture (**13/13 passed**, [exact candidate receipt](CANDIDATE_1_3_20.md)). The fixture opens no Core Audio device, station owner, production log/settings or app singleton. UI preview screenshots use labelled generated data and establish layout only.

| REC | Software evidence / boundary | Physical acceptance |
|---|---|---|
| 01 | Explicit source IDs, permission-state read, denied/start error leaves scoring independent; no fallback | Actual TCC deny/grant and missing-device start pending |
| 02 | Native callback PCM clamping and distinct stereo markers; mono/stereo archive sample equality | Real source format/channel content pending |
| 03 | Every sample/frame checked across shortened segment boundaries and frozen readers | Real capture rotation during logging pending |
| 04 | Frozen native prefix checked while writer advances; 5/10/30 commands scoped to one capture | Audible replay while Core Audio capture continues pending |
| 05 | Callback generation cancellation, delayed callbacks, pause/seek; Escape does not consume existing handlers | Signed-app cancellation/device latency pending |
| 06 | Exact IDs; system/known TX output rejection; no default fallback; native player has no station-write capability | Physical headset/mixer/VOX route unverified |
| 07 | Actual `not1mm-python` committed audit → native idempotent bookmark with admission marker | Packaged actual-path fixture passed; real source pending |
| 08 | Rejected commit emits no event; receipt retry/read-only pages; durable cursor/link replay | No new hardware dependency |
| 09 | Real correction/deletion audit updates current label/tombstone; original samples/anchor retained | No post-contest correction workflow added |
| 10 | Full durable log/QSO lookup; wrong log unavailable; overlapping captures ambiguous | No active-log fallback |
| 11 | Admission frame/UTC survives journal restart; configurable pre/post and pending tail | Actual WAN acknowledgement timing pending |
| 12 | Exact-device-only policy; format/device/watchdog failure closes run with gap | Unplug/replug on actual device pending |
| 13 | Monotonic frame order; UTC/callback discontinuity stops epoch; overlapping UTC mappings rejected | Actual OS sleep/clock-step source trial pending |
| 14 | Real partial bytes repaired into new WAV; partial retained; rename-before-manifest adopted; torn journal preserved | Forced termination/power-loss on actual capture pending |
| 15 | Reserve refusal preserves other files; replaced volume/directory rejected; blocked writer lacks fresh-health proof | Actual full-disk/blocked-device stress pending |
| 16 | Native lifetime owns capture; window opens do not arm input/output; explicit stop/app shutdown | Signed recorder window close/reopen during real capture pending |
| 17 | Manual sample/notes survive restart; full index search/paging | No contact mutation involved |
| 18 | Exact Analytics dataset ID/contact ID/UTC interval; read-only prepare action | Packaged exact-identity fixture passed; audible playback pending |
| 19 | Independent Python WAV decoding matches every sample; hashes/order/gaps; completion manifest last and cancellable | Multi-GB removable-volume export pending |
| 20 | Catalog IDs only, native folder chooser, bounded parameters, symlink/hardlink/path and scope checks | No arbitrary UI file-read API |
| 21 | Distinct deterministic L/R samples and explicit receiver labels preserved | Actual R1/R2/ear attribution pending |
| 22 | Accelerated 48-hour/2,880-segment index fixture, u64 frame/RIFF bounds; fixed callback queue and bounded playback/index cache | No 30-minute physical-source soak or measured live latency/memory claim |
| 23 | Developer ID Hardened Runtime, input entitlement/purpose, three matching source receipts and relocated bundle signature verified | Actual signed-app input permission/routing pending |
| 24 | Read-only rule reminder and listening preparation; no ASR/correction/scoring path | Applicable event/year rule not certified |
| 25 | Existing entry, owner/checking recovery, Analytics, Python scoring and packaging gates included | Current active app is not replaced by this task |

## Demonstrated software gates

Retained command output is in [evidence](evidence). This is targeted software acceptance, not physical audio acceptance.

- Native recorder: **21 passed**, including sample equality, rotation/frozen prefix, real Python audit integration, cancellation, both-radio transmit observations, delayed capture receipts/corrections/deletions, corrupt coverage, recovery retry, independent decode and accelerated 48-hour index.
- Retained telemetry: **17 passed**, including passive-read/no-owner-creation and command fencing.
- Frontend: **237 passed** across recorder, key bindings, detached Entry/Log Display, Analytics and owner suites. The owner retry test asserts cancellation ordering independently of elapsed retry count.
- Python: **38 passed** across recorder, Analytics and actual CQ WW SSB host.
- Swift: actual Python Analytics bridge test and the complete recorder commit/audit/Analytics fixture passed; the latter asserts that macOS `/var` symlink normalization cannot reappear. After reconciling 1.3.18, another **28 Swift spot-delivery tests passed** on the combined source.
- Packaging checks: **6 passed**. TypeScript/Vite and detached-window graph checks passed. Recorder remains lazy; the global Escape hook plus lazy route adds 208 measured shared-startup bytes. The tight Logbook allowance increased by 200 bytes, with a separate Recorder lazy-boundary assertion.
- Independent combined source/layout review: five findings fixed and rechecked (cancellation admission, both retained radio slots, historical reconciliation, integrity-aware availability, recovery publication retry). No remaining material finding at that review scope.
- Browser fixtures: 1280 px and 620 px, including full page, no horizontal overflow. Preview uses generated data and cannot start native capture/output. Screenshots are layout evidence only.

The first broad frontend run exposed a time-sensitive retry-count assertion; its ordering assertion was stabilized and the complete affected suite passed. A native regression caught missing live admission-map updates; journaled admissions now update the live map and all 21 recorder tests pass. No failed gate is counted as a pass.

Candidate 1.3.19 was rejected after signing because its disposable Swift fixture used a `/var` root rejected by the host. Foundation also removed `/private` when resolving that path. The fixture now uses `/private/tmp` on macOS and passes the actual Python regression. Host path validation is unchanged. A new version is required for the corrected candidate; 1.3.19 is not delivered as accepted.

Historical reconciliation checks the active and selected captures plus two catalog captures per turn, at most one bounded 200-event page per capture. Large catalogs or audit backlogs can delay historical labels; source media and original journal admissions remain durable. The native media safety monitor runs separately from audit catch-up. Integrity hashing on first access after restart can take disk time, outside the capture writer lock.

## Source reconciliation / rollback

Initial clean canonical source: `369703cd` / 1.3.16, newer than the supplied plan's `ec981e72`. Concurrent Checking recovery `362ee467` and installed 1.3.17 source `1f15a88d` / receipt `1516211e` were preserved. Work resumed on a managed development branch at `1516211e`; packaging remains canonical-only.

Before the urgent 1.3.17 install, all unfinished recorder work was preserved in stash `a7c3dfa7f36f67589a9f84fa87405ecbc91dfee3` plus `/Users/oliver/Documents/Backups/OM0RX-xLog-recorder-checkpoint-20261025/{tracked.patch,untracked.tar}`. Those backups remain. A final reconciliation also preserves 1.3.18 spot-delivery fix `2dc0e617` and release `78a29420`, installed by the separately authorized hotfix task. This recorder delivery does not replace that active app, mutate production logs/settings, or claim earlier hotfix data snapshots as a new live verification.

## Required operator follow-up

Connect and identify the actual input and separate listening output, verify channel content and physical route, grant/deny permission in the signed candidate, then run the named live REC cases and a measured bounded source soak using disposable contest data. Record device UIDs, actual format, source labels, RX/TX/ear coverage facts, elapsed duration, memory/latency and gap evidence. Do not infer completion from a timer, a CAT connection, a virtual-device name or these software fixtures.
