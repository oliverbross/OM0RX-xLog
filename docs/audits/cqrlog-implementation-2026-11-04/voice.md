# C06 execution evidence — 4 November 2026

Integrator follow-up: the broad frontend run exposed that an unavailable native
snapshot could crash the newly mounted VoiceDesk and unmount the operator desk.
The component now rejects a malformed reply, retains the desk and disables audio
preparation. No test adapter was made permissive. The two existing full Desk/rotor
files passed **77/77** after correction (`/tmp/xlog-cqrlog-live-desk-recovery.log`).
VoiceDesk and EP-15 command checks passed **11/11** together
(`/tmp/xlog-cqrlog-voice-command-recovery.log`), including duplicate/repeat/IME
suppression and exactly one native Stop fallback when the panel is unmounted.
Scoped route-label layout now keeps device names readable in the compact fixture.

Owner: bounded `/root/voice` lane; integrator owns commits, shared registration,
normal command actions, candidate/package and final acceptance. Canonical starting
source: `db4a9ce2739fc8b96371cd432d3b8787e950a45e` on clean `main` after fast-forward
update. No physical output, production-app launch, production-store mutation or
package/installation was performed by this lane.

## Reconciliation and contract

The live source uses F1–F12 WAV profile files, not the planning document's
VOICE1–VOICE10 storage description. Normal Voice 1–10 deliberately map to shared
`f1.wav`–`f10.wav`; remaining contest files and mappings are retained. The library
stays in its existing selected external folder. New `voiceProfile` settings carry
ten labels, nondestructive edits and explicit native device/rate/channel intent.
No browser device ID is converted to a native route and no migration selects a
transmit device or restores an action/lease.

Normal action authority comes from actual worker settings/new-QSO draft and
native operating-module context, with native-issued, expiring one-use tokens.
Each token freezes prepared PCM, the settings/draft revisions and original PTT
target/intent. No fake contest session or renderer-supplied send path is admitted.
The token, Prepare/Analyze response and preview/send receipt include source WAV
SHA-256, edited mono PCM SHA-256 at source rate and output PCM SHA-256 at the
explicit route rate, plus source slot, edit values, rate/frame count and transform
policy. The edited identity stays equal across monitor/TX resampling; output-rate
identities distinguish the actual prepared samples. A changed source/edited
digest refreshes the desk review and prevents that click from issuing Send.
Native contest playback checks its prepared manifest and the canonical Host
library, then obtains and validates the Host's complete one-use output claim.
Durable replay receipts intentionally contain no output actions; they supply only
the revision for the subsequent fresh native claim, never output authority.

Existing Rust/renderer identity serialization differed (`sessionId` versus
`sessionID`, similarly action/draft and SHA256 fields). Explicit canonical names
now match the actual TypeScript contract, with legacy decode aliases retained.
A native JSON regression covers this boundary.

The existing `ptt_session` remains the sole transmitter authority. Device-lane
`Target` changes are additive, and release obtains its exact retained target.
Voice also checks the retained operation owner ID, so its failure/Stop cannot
release an unrelated GUI PTT owner. Priority Stop and final cleanup share one
release operation UUID; PTT receipt idempotency prevents duplicate dispatch.
The device lane owns the On/Off overtaking tombstone and provider transport fence.

The native audio layer reuses the recorder's exact device/format helpers and
enumeration, preserving its separate listening/archive policy. macOS CPAL 0.18.2
output starts with gated silence. First audio requires stream-clock readiness and
PTT TX confirmation. The final-sample presentation deadline derives from the
actual callback/playback timestamps and frame position; callback enqueue is not
completion. A three-second readiness bound, backend latency limit of two seconds,
and duration-plus-three-second playback/drain watchdog fail closed. Stop cancels
without waiting for normal drain. Wall-clock continuity additionally retires audio
before another callback sample after sleep, clock reversal or excessive callback
gaps (four callback periods plus 50 ms, bounded to 250 ms–2 s).

PCM preparation is outside the callback and owner lock. Conversion is integer
PCM to averaged mono, bounded trim/gain with clipping counts, then defined offline
linear interpolation when rates differ. The callback performs no file/worker/PTT
I/O, allocation or mutex operation. Microphone capture uses fixed SPSC blocks and
the existing PCM WAV bounds. Missing/changing device identities never reroute.

Native wrappers validate the initiating real window. The native job rechecks its
focus/visibility after slow preparation, before PTT, after TX confirmation before
opening the sample gate, and during playback. Normal/contest native output shares
one voice lifecycle and existing process-wide CW/Tune/PTT exclusion. The existing
Windows/Linux contest WebView workflow is retained; normal native routes are
advertised unavailable there. Platform choice comes from native capability,
not browser user-agent inference.

## Task state

| ID | State | Delivery / remaining gate |
|---|---|---|
| C06-T01 | Implemented | Reconciled contracts above; original PTT target interface coordinated with devices and root. |
| C06-T02 | Implemented | Existing library/manifest facade plus native normal actions; additive validated settings and external-asset backup semantics. |
| C06-T03 | Implemented | CPAL exact devices/routes, bounded capture, prepared output and platform capability. |
| C06-T04 | Implemented | Native job, stream/PTT readiness, presentation drain, priority cancellation, retained original-owner release and uncertainty. |
| C06-T05 | Implemented | VoiceDesk shared folder/label/record/import/monitor preview, nondestructive trim/gain and clipping feedback. |
| C06-T06 | Implemented | Normal Send/Stop and readiness; root integrates EP-15 actions and mount. Native focus checks preserved. |
| C06-T07 | In progress | Focused results below; final source gate, combined owner/UI, backup and packaged integration remain integrator gates. |
| C06-T08 | Blocked | No identified/operator-approved physical microphone/monitor/TX channel/PTT setup has been exercised. Qualify C06-A13 on the exact setup after the integrated candidate. |

## Actual verification

These runs exercised working-source changes. The integrator records the final
source commit and any subsequent required rerun; totals are not cumulative.

| Command / scenario | Observed result | Evidence / scope |
|---|---|---|
| `swift test --filter VoiceProfileTests` | 2 passed, 0 failures | lean-ctx archive `eda487fe142c3d91`; old settings, combined settings round-trip, unrelated preferences, invalid route/trim protection. No runtime state serialized. |
| `npm run test:vitest -- src/live/VoiceDesk.test.tsx src/contesting/contestVoiceOutput.test.ts src/contesting/contestVoiceProfile.test.ts` (cwd `prototype`) | 21 passed, exit 0 | [Raw frontend result](voice-frontend.txt); new desk no-output editing/preview dispatch, stale edit base, changed-memory no-Send, double-click admission and Stop; existing library/output cases. Final job `shell_7d0b82ee131070fb`. |
| `npx tsc --noEmit` (cwd `prototype`) | Exit 0 | Final job `shell_354b391fcda32dc7`; no diagnostics ([empty raw output](voice-typecheck.txt)). |
| `cargo test --manifest-path prototype/src-tauri/Cargo.toml --bin xlog-prototype voice` | 26 passed, exit 0 | [Raw Rust result](voice-rust.txt); existing WAV/manifest/queue/shutdown plus native JSON, complete canonical claim, original-owner release, stable release UUID, PCM/digest, fake presentation-clock drain, sleep/gap and no-substitution cases. Final job `shell_db784859bd7b7bf7`. |

The initial native JSON-schema test failed on `intentID` naming and was fixed by
an explicit serde name, rather than weakening the expected public contract.
The initial Swift run was interrupted by a concurrent country-lane compile error;
the actual later 2-case pass above supersedes that failed build. Root identified a
real legacy Contesting Test regression after two unchanged five-second timeouts:
the new default native-claim flag incorrectly skipped the existing simulation
claim. The condition now preserves the existing test path whenever production
phone output is unavailable; its exact rerun remains recorded by root. No timeout
or assertion was weakened and no new simulator was introduced.

The final 26-case Rust run supersedes the earlier 22-case intermediate gate;
the final 21-case frontend run supersedes the earlier 20-case gate. Source-file
hashes at this focused validation boundary (integrator records the final commit):

```text
c0a89cbcc725f158586ef4e08c20bd8b2d5f6615ccf9b3d6e6d0396b44e0f43c  prototype/src-tauri/src/contest_voice.rs
b909f52b2df7077e94117484b0e79a04ccf801efef86b43a772af5e465187be5  prototype/src-tauri/src/native_voice.rs
0ffad2416919da3bf992eb60399bbbbbc9d6a02c0063e15cc916fb58e192a63c  prototype/src-tauri/src/voice_audio.rs
980c82009fae558ebe66ecde34d3a8a5b8a65daf05032d9343937f91ff3aa61d  prototype/src/live/VoiceDesk.tsx
b1e8cee421f63f2894321150991783767c4dd77bfbbdf402a3ecb5a36c71f17f  prototype/src/live/VoiceDesk.test.tsx
7a91b74c6862019ea532244c4fe6d00eea750f447da040bcdca6ffc6c6ee49aa  Sources/XLogCore/VoiceProfile.swift
c768e96eeb55fe3399ca8f720e8ed5705d4a287c44f8f4449ad150300dc58739  Sources/XLogCore/Settings.swift
```

## Acceptance boundaries

C06-A01/A02/A03/A04/A05/A08/A09/A10/A11 have focused software/renderer coverage
at the boundaries named above; that is not an unqualified acceptance Pass for
their complete native/operator scenarios. C06-A06/A07 require the integrated
native provider/lifecycle gate alongside C03. C06-A12 requires the final isolated
packaged workflow and exact applicable platform evidence; it is not established
by source inspection or these tests. C06-A13 is **Not run** for actual microphone,
monitor/TX channel separation, first/last audible audio, PTT/RX release, Stop and
selected-device loss. No test here is RF or physical-device evidence.

Root must link the final source commit, candidate/version/provenance, integrated
normal/contest operator path, combined backup/restore and any exact unrun cases.
No blanket operational or cross-platform qualification is asserted.

## Sources and operator controls

- [CPAL 0.18.2 OutputStreamTimestamp](https://docs.rs/cpal/0.18.2/cpal/struct.OutputStreamTimestamp.html)
  and [OutputCallbackInfo](https://docs.rs/cpal/0.18.2/cpal/struct.OutputCallbackInfo.html),
  checked 4 November 2026. The playback timestamp predicts device presentation;
  it is not measured RF or proof of external radio audio-chain latency.
- Exact local CPAL 0.18.2 `timestamp.rs`, existing `contest_recorder_audio.rs`
  device/format helpers and current native PTT/voice owners informed the independent
  implementation. No external audio library or CQRLOG source was copied.
- [Operator guide](../../help/voice-memories.md).

## Independent C06 review corrections

The devices lane reviewed the native audio/voice owner, main registration,
normal desk/shortcut dispatch, contest output/claim integration and saved route
schema. Two actionable defects were corrected before the final source gate:

- Phone admission previously preferred the general receive-mode projection. On
  split Flex/agent operation RX USB with TX CW could therefore authorize voice.
  It now requires the uniquely marked TX VFO matching `transmit_vfo` and uses that
  VFO's mode. Addressed TCI keeps its TRX modulation without inventing a VFO;
  unsupported Hamlib does not acquire native voice authority. Three regressions
  cover both split directions, missing/conflicting evidence and TCI addressing.
- Stop could clear the contest cache while a slow first preparation was reading,
  after which that read could reinstall its old admissions/PCM. Preparation now
  captures the native epoch before canonical library lookup and rejects changed
  epochs under the publication lock. The cache also retains its epoch, checked
  before native playback copies PCM and before legacy admission consumes it, so
  a new post-Stop request cannot adopt an old publication. A regression verifies
  no stale cache publication/admission, then a deliberate new one-use action.

The final CLI fallback gate `cargo test --manifest-path
prototype/src-tauri/Cargo.toml --bin xlog-prototype voice` passed **30 tests**, exit
0, with raw evidence in [voice-review-rust.txt](voice-review-rust.txt). Three old
manual admission fixtures were populated with their current cache epoch; their
manifest, replay and substitution assertions were retained. An initial run found
the last missing fixture epoch (29 pass/1 fail); the corrected complete repeat
above supersedes it. `git diff --check` for the two corrected Rust files passed.
Earlier MCP jobs were stalled and are not counted as verification.

No additional actionable regression was found in the reviewed normal one-use
token/immutable PCM path, original-owner release, native/legacy contest selection
or persisted route schema. This was a software/source review and focused native
test gate, with no physical audio/PTT or RF exercise. The acceptance boundaries
above remain applicable; the integrator records the final corrected commit.
