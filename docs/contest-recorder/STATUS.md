# Contest recorder implementation / acceptance

Source reconciled: initial canonical `369703cd` (1.3.16), then fast-forwarded to `1516211e` after the separately authorized 1.3.17 hotfix. The Checking fix `362ee467` and installed source `1f15a88d` are retained. The supplied plan reviewed `ec981e72`; newer and unrelated work is preserved. Final reconciliation also preserves the 1.3.18 nonblocking spot-delivery fix `2dc0e617` / release `78a29420` and its installed application. Development uses the managed recorder branch; packaging uses clean canonical `main` only.

| Milestone | State | Evidence / boundary |
|---|---|---|
| M0 | Done | Native Tauri owns PCM; CPAL 0.18.2 Core Audio stable device IDs, rtrb preallocated SPSC queue; no capture-rate Python/React traffic. |
| M1 | Implemented; physical acceptance pending | Native continuous one-device mono/stereo capture, fixed callback queue, segmented PCM16 originals; explicit separate native listening output and cancellation fence. |
| M2 | Implemented; software fixtures pass | Actual Python `xlog_qso_audit` after commit; persistent log/QSO IDs; durable operation admission markers, revision/tombstone reconciliation across capture epochs, recovery and independent export. |
| M3 | Implemented; software/UI fixtures pass | Existing detached Log Display, configurable binding registry and Analytics exact-dataset playback; no scoring or station-write dependency. |
| M4 | Hardening / candidate checks | Combined review findings fixed; physical REC cases externally blocked by disconnected audio. Unique canonical signed candidate and exact-source receipt follow. |
| M5 | Deferred | Independent inputs, direct TCI/Flex/DAX/remote audio require separate scope. |

## Integration map

- `worker::request_using` sees every current native/Python request, including receipt reconciliation. Recorder admission is metadata only and never changes a request/result.
- `contest_host.host.Host.dispatch` exposes a bounded read of committed audit rows; no PCM or scoring changes. `sessionID` is the existing durable database-directory identity; workspace generation is a command fence, not an archive key. Analytics' mutable snapshot hash is not a log ID.
- Existing Flex and TCI station integrations provide station control/observations; no approved PCM stream has been identified. V1 requires a verified local Core Audio input. Device discovery alone does not establish RX, TX monitor, or operator-ear coverage.
- Replay has no voice-keyer, PTT or station-write dependency. Retained transmit observations may cancel it, never issue RX/PTT-off.
- Original PCM segments are immutable after finalization. Retention is user managed; no pruning. New windows never arm recording; restart requires explicit Start/Resume.

## Acceptance policy

Real capture/output, OS permission prompts, station actions and replacing an active app require explicit operator authorization. Controlled software sample fixtures are independent evidence. Until actual signed-app source/routing acceptance is completed, verdict is **NOT READY**. Do not infer hardware acceptance from unit tests, device names or signing.

Operator update: a controlled test was authorized, then Oliver confirmed that the audio is **not connected**. No real capture or playback can be accepted in this session; implementation and isolated software/candidate checks continue. No station actions or installation were authorized.
