# OM0RX-xLog — Contest Recorder & Instant Replay
## Executable project-management and implementation brief for Codex

**Owner:** Oliver Bross / OM0RX  
**Prepared:** 25 October 2026  
**Repository:** `oliverbross/OM0RX-xLog`  
**Reviewed source:** `ec981e72a896ddb0a26e48f43ecd6822f9d7bf9d` on `main`  
**Observed source version:** `1.3.16`; this is not a claim about the installed binary.  
**Target:** the existing native macOS application, Apple Silicon, macOS 14+; preserve portable builds.  
**Status:** implementation specification. Nothing in this document means the recorder is implemented or tested.

> Deliver a working continuous contest-audio recorder with safe instant replay, durable QSO bookmarks, Log Display playback and integration with the existing Contest Analytics. Preserve the current contest engine and station services. Do not replace the voice keyer, add another logger, or turn this into a general audio workstation.

## 0. Instructions to the implementing agent

Read this file, current `AGENTS.md`, `docs/DEVELOPMENT_WORKFLOW.md`, and the current implementation before editing. The source above is a review anchor, not a checkout to reset to. Preserve newer work and unrelated modifications. Record the source actually used.

Implement **M0–M4** in section 15 as one coherent v1 feature, using logical commits and focused checks. M5 is an explicitly deferred extension, not an automatic next assignment. Maintain the small status table in section 19 or an equivalent section in the existing project record. Do not produce another large planning document instead of implementation.

Choose the smallest native implementation that satisfies the behavioral contract. Reuse existing identity, window, settings, mutation-receipt and authorization mechanisms. A genuine missing native capture component may be added; speculative registries, generic event buses and parallel service frameworks may not.

**Completion means:** the signed candidate demonstrably captures a selected input continuously, replays without any transmit action, links real committed contacts from `not1mm-python`, survives the specified failures and opens audio from Log Display and Analytics. A mocked React indicator or an old Swift contest rehearsal is insufficient.

**Do not replace an application being used for an active contest, activate microphones/recording, change radio/audio-system settings or perform RF/PTT/rotor tests without explicit operator authorization.** Implement and test with disposable logs and controlled input first. Absence of hardware access is not a reason to stop independent software work or to claim hardware acceptance.

## 1. Evidence, references and design authority

### 1.1 What was verified in xLog

Selected source was inspected, not the entire repository or a running Mac. Reconcile renamed/moved components at current HEAD.

| Existing source | Verified role | Required use / boundary |
|---|---|---|
| `prototype/src/contesting/contestVoiceOutput.ts` | Prepares short WAV messages, creates webview audio playback and explicitly acquires/releases PTT. | **Do not call this for replay.** It is a transmit path, not a neutral audio player. |
| `prototype/src-tauri/src/contest_voice.rs` | Previously inspected bounded WAV profile/admission code; verify current contents in M0. | Reuse compatible file-validation ideas where useful; do not inherit its message duration limits or PTT admission. |
| `prototype/src/contesting/Not1MMContestWorkspace.tsx` | Current Python-backed contest workspace, command identities and existing owners. | Identify the authoritative post-commit integration point here and in its native/worker path. |
| `python/contest_host/store.py` | Unique QSO IDs, operation receipts and ordered QSO audit records. | Keep scoring/log mutation here. Recorder consumes confirmed metadata and does not become a second writer. |
| `prototype/src/contesting/ContestAnalyticsDetails.tsx` | Read-only QSO drilldown with durable contact IDs and snapshot provenance. | Add a read-only audio action scoped to the selected dataset/log; never retune or select the active contest implicitly. |
| `prototype/src/contesting/ContestAnalyticsWindow.tsx` | Existing analytics workspace, listed in current source. | Reuse for time-selection playback; inspect its current filtering contract before wiring it. |
| `prototype/src-tauri/Cargo.toml` | Tauri 2 native application; inspected manifest has no general native audio-capture dependency. | Do not assume a capture engine already exists. Add at most the necessary maintained audio/file dependency or thin platform bridge. |
| `prototype/src-tauri/tauri.conf.json` | macOS 14.0 minimum, existing app identifier, restrictive CSP, bundled worker. | Preserve minimum OS and security boundaries; validate permissions in the actual signed application. |
| `AGENTS.md` | Logical commits, proportionate tests, push completed work, canonical packaging, new version for each different packaged candidate. | Follow current repository policy. No version bump per small code change; advance it for the combined candidate. |

Existing QSO receipts and analytics IDs are useful starting points, but audio association and physical radio attribution must be traced rather than guessed. Search for any recorder already added after this review and extend it instead of duplicating it. An incomplete GitHub code search is not proof that a capability is absent everywhere.

### 1.2 What the supplied N1MM manual supports

Use `N1MMPlus.pdf`, printed **3 October 2026**, as the reference provided by Oliver:

- **Pages 790–791, “QSOrder (by Vasily, K3IT)”** describe per-contact recordings, contact-logging events and configurable audio before/after logging. Use this for operator-facing QSO playback behavior, not as a requirement to communicate internally by UDP.
- **Pages 201–204, Audio Setup Window** distinguish transmit-message playback/recording from other listening outputs. Its Windows controls and voice-keyer implementation are not a native macOS recorder design.
- **Page 60, post-contest logging changes** cautions against using recordings and external data for post-contest log cleaning. Retain this distinction in the recorder's review workflow.

The continuous archive, stable-ID links, native service, crash recovery, Analytics integration and workflow below are **proposed xLog requirements**, not claims that N1MM specifies those exact designs.

### 1.3 Other references and verification limits

The QSOrder and QSOCapture repositories document relevant recording patterns. They are references, not permission to copy code without a license review or to embed their servers/UI. Do not adopt an automatic oldest-recording deletion policy that could erase the beginning of the current event.

CQ WW's published recording rule distinguishes continuous received/transmitted audio as heard by the operator from isolated QSO clips. Its FAQ prohibits correcting logged calls/exchanges from recordings after the contest. The exact applicability must follow the selected event's rules. **During this research the generic official rules URLs returned a 2025-labelled HTML/PDF while newer search results referenced 2026.** The 2025 PDF was visually inspected, but do not label it a verified 2026 rules snapshot, copy its dates, or hard-code deadlines. Recheck and record the applicable organizer rule/version before showing event-specific guidance. See sources in section 20.

The recorder must show capture facts and limitations, never a blanket “CQ WW compliant” badge. Policy guidance is not legal certification or organizer approval.

## 2. Product outcome and bounded release scope

### Mandatory v1, M0–M4

1. One explicitly chosen macOS native input device, **mono or stereo**, continuously captured to durable local segments. A stereo input may be an operator headphone mix or two receiver channels; these are different mappings and must be labelled.
2. Instant replay of the last **5, 10 or 30 seconds**, while capture continues.
3. Stable QSO audio bookmarks created after confirmed contest commits, plus manual bookmarks.
4. Play a contact from the current detached Log Display and “Listen” from existing Analytics contact/time drilldowns.
5. Playback-only panel with seeking, channel selection, adjustable pre/post context and safe explicit output routing.
6. Recording-health, storage forecasting, gap reporting, recovery and archive/export facilities.
7. Opt-in start, explicit stop/pause, source-loss handling, user data protection and actual signed-app acceptance.

**Two configured radios are supported as metadata and, where one stereo device supplies them, as an explicit channel map. This does not imply two independent audio devices are already captured synchronously.**

### Later extension, M5

Two independent input devices, direct ExpertSDR TCI audio, direct Flex/DAX/network audio, synchronized remote audio and more advanced codecs may be added after v1. M0 must identify whether existing xLog services already expose usable streams. A compatible existing stream can be reused without inventing another radio client; a missing transport is recorded as a separate dependency, not hidden behind an enabled dropdown.

For Oliver's Flex/SunSDR setup, the v1 acceptance record must name the actual audio source available on his Mac. “CAT connected” and “a virtual device probably exists” are not sufficient. A local or virtual Core Audio input is acceptable only if it is genuinely installed, selected, permitted and producing the intended samples.

### Explicit non-goals

No transcription, AI callsign extraction, automatic corrections, transmitter-message synthesis, extra CW decoding, IQ/wideband recording, cloud upload, public web server, third-party logger import service, full DAW, global keyboard remapper, replacement radio settings or all-platform audio rollout. Do not add UDP between xLog's own components merely because QSOrder uses it externally.

## 3. Operating contract and safety invariants

| ID | Invariant |
|---|---|
| INV-01 | Recording/replay cannot acquire PTT, key CW, change frequency/mode, operate the rotor or submit a QSO. Test with rejecting station-command fakes. |
| INV-02 | Recorder failure cannot roll back or reject a valid contest QSO. Contact persistence remains the existing authority. |
| INV-03 | A missing input/output device never falls back silently to the default microphone or speaker. |
| INV-04 | Replay uses a separately selected listening output; never the transmit-message output. |
| INV-05 | Finalized original audio is immutable. Exports and playback processing are derived products. |
| INV-06 | No automatic pruning of active/current-event original audio. Low disk stops recording safely; it does not delete earlier evidence. |
| INV-07 | “Recording” reflects advancing samples and writer health, not merely a running timer or an open file. |
| INV-08 | Session/QSO identity, receiver source, sample-time mapping and gaps remain truthful after edits, restarts and device changes. |
| INV-09 | No capture or playback starts just because a window is opened, restored or a contest is selected. |
| INV-10 | Audio never travels through the Python scoring process, JSON/base64 event stream or React state at capture rate. |
| INV-11 | Reference-log Analytics cannot play the active log's similarly named contact. Resolve full log/QSO identity or say unavailable. |
| INV-12 | Replaying audio does not provide a new post-contest log-correction or scoring path. |

**Physical routing warning:** software can reject known TX outputs, but cannot prove how an external mixer, virtual cable, acoustic speaker path or radio VOX is wired. Require an explicit headset/listening-output choice and route confirmation. Do not promise software alone makes RF impossible. Never disable or change station VOX/PTT settings automatically.

Pause/stop replay if the existing station observation indicates transmit/output activity; do not issue a new RX/PTT-off command and do not interrupt capture. When state is unknown, label it and require the listening route to be verified rather than fabricating a safe hardware state.

Global Esc must preserve the existing emergency stop behavior. Add replay cancellation alongside it; do not consume the event in a way that prevents the existing stop/release handlers. A replay-only Stop button stops replay, not the recording or another service's owned transmission.

## 4. Operator experience

### 4.1 First-use setup

Menu: **Contest → Recorder**. Reuse existing settings and native-window conventions.

The setup screen should show:

- Input device by stable identity plus readable name; channel count and observed format.
- Mapping: `Receiver audio only`, `Operator headphone mix`, or `Custom channel mapping`.
- Source labels and radio/receiver identity. Example: left = Radio 1 receiver; right = Radio 2 receiver. Do not relabel that as left/right operator-ear audio unless verified.
- Listening output, explicitly selected and distinct from known TX routes; output channel selection.
- Storage root, free space, estimated usage for the configured duration, archive format and current retention setting.
- Permission state, input meters, last sample/written time, and a **Record test** action.
- **Save**, **Start recording**, **Cancel**. Saving settings does not activate capture.

Request input permission only during a clear user action. A denied/restricted permission state must explain how to grant access and leave normal contest operation working. Do not ask for system-wide screen/audio capture permission unless a separately scoped feature actually uses it.

A short operator-authorized test captures only the selected source to a disposable location and plays only to the confirmed listening device. It must not change device gain, default-device settings, radio settings or transmit routes. Restore any test-local configuration afterward.

### 4.2 Main Logging strip

When enabled, add one compact line, not another permanent large panel:

```text
● REC · R1 receiver · 01:24:36 · Input present · Saved through 12:34:56Z
[Replay 10 s] [Bookmark] [Recorder…]
```

Use text and icons, not color alone. Distinguish `Starting`, `Recording`, `Input silent`, `Interrupted`, `Disk low`, `Stopped` and `Recovery required`. Silence with valid callbacks is not a disconnect; never turn low level into fabricated packet loss.

Do not steal focus, change the active draft, scroll the log or reopen a window every time a meter updates. Optional disclosure gives detailed source/write/gap status. Let the operator hide the strip while retaining an accessible recording indicator in the existing menu/status location.

### 4.3 Recorder/playback window

One resizable xLog-styled panel with:

- Capture status, elapsed time, source/channel mapping and explicit Start/Pause/Resume/Stop.
- UTC-labelled timeline, recording coverage and visible gap markers.
- Play/Pause/Stop, seek, Replay 5/10/30, channel selection and independent listening volume.
- Current QSO/bookmark metadata, selected source, original recorded interval, adjustable context.
- Bookmark list/filter and archive export.

Support compact and expanded sizes with one intentional timeline/list scrolling area. Reuse existing window identity and geometry persistence. Opening a second view attaches to the **same recorder**, not a second capture. Closing the panel does not stop an already active recording; closing the app finalizes it and stops capture.

A waveform is useful only if inexpensive: derive bounded peak summaries off the capture thread and load just the visible range. It is not a prerequisite for the first vertical slice. Do not decode a 48-hour recording into browser memory.

### 4.4 Keyboard behavior

Use the current binding registry. Provide commands `Replay 5s`, `Replay 10s`, `Replay 30s`, `Stop replay`, `Bookmark now`, `Open Recorder`. Choose conflict-free defaults after inspecting existing bindings; do not repurpose F1–F12, Enter, Space, Tab or the emergency-stop semantics. Make bindings configurable and app-scoped. No global hooks/Accessibility permission merely to implement replay.

Replay is an immutable interval ending at the last captured sample **when the key is pressed**. New samples do not move its endpoint. Another replay request replaces/cancels the current playback; it does not build an unlimited queue. If less audio exists, offer the available amount and label it. Never replay another session to fill a missing interval.

### 4.5 Log Display and Analytics

Add a compact `▶`/Audio action beside each contact and a context-menu entry. States must distinguish available, partially covered, recorder off at that time, source unknown and file missing/corrupt.

Analytics gets **Listen to contact** and **Listen to interval** using its existing stable IDs, log identity and time filters. This is read-only: no focus transfer to Entry, no active-session switch, no tune, no QSO edit. Imported comparison logs without recordings show “No linked audio”; matching a callsign and approximate UTC is not sufficient evidence.

Manual bookmark categories can begin with `Uncertain copy`, `Interference`, `Good run`, `Technical issue`, and free text. They are timestamps/notes, not draft mutations or a new classification engine. A bookmark without a QSO is valid.

## 5. Capture implementation and ownership

### 5.1 Choose one native implementation in M0

Default to an application-lifetime native service controlled through Tauri commands. Use a mature macOS Core Audio implementation or a thin platform bridge already compatible with the project. A maintained native audio library is acceptable if it supports stable device identity, explicit device selection, device-change events and bounded buffers. Pin/review its license and packaging implications.

Do not force a new Rust-versus-Swift framework decision onto the entire app. The service may use the native language best supported by existing packaging, but the audio callback must not live in the Swift JSON logging worker or in the Python contest process. Record the small choice once and proceed.

Webview microphone capture/message recording may inform device UX, but it is not adequate ownership for an archive that must survive closing or reloading its panel. Ordinary `HTMLAudioElement` playback is not automatically a safe selected-output implementation on every WebKit runtime; prove explicit routing in the shipped app or use the native playback backend.

### 5.2 Data path

```text
Explicit input UID / channel map
          ↓
Native capture callback — timestamp/frame metadata, preallocated blocks
          ↓
Bounded queue → native writer → immutable consecutive audio segments
          └── bounded replay history / active-segment reader

Confirmed QSO events → recorder metadata journal → QSO interval bookmarks
React controls/status ← low-rate native events → safe listening-only playback
Analytics / Log Display → IDs + interval → existing recorder, never the radio
```

The callback performs no filesystem access, Python/JSON round trip, unbounded allocation, network call, UI work, blocking lock or compression. Timestamp and queue samples; let a bounded writer handle file I/O and hashing. A second consumer must not cause capture to wait on replay.

Meters can update at at most 10 Hz while visible; ordinary status at about 1 Hz or on state change. Suspended/hidden UI does not alter capture. These are proposed limits, not measurements of current performance.

### 5.3 Capture format and rotation

V1 defaults: preserve the actual selected channel count, use a negotiated supported sample rate, archive as PCM WAV (normally 16-bit), and rotate approximately every **60 seconds**. Use the actual source format in metadata. A 44.1 kHz device must not be silently described as 48 kHz. Float-to-PCM conversion must clamp correctly; do not normalize, silence-trim, denoise or apply voice activation to original recordings.

Rotation is a storage boundary, **not a pause in capture**. One monotonically increasing frame sequence per source/epoch continues across segments. Test that boundary samples are neither lost nor duplicated. Build an ordered archive/manifest so continuous content can be played across segments and exported in common formats. Physical segmentation alone does not certify organizer acceptance.

Do not use the voice-keyer's per-message file-size or duration limits. Avoid a single 48-hour RIFF file with a 32-bit length limit. If later exporting very large WAV files, use supported RF64 or bounded common-format parts and state the format; never emit an invalid WAV header.

### 5.4 Device lifecycle

Persist stable device IDs, not device-array positions or names alone. Show a missing saved device explicitly. On reconnect, resume only the exact source/mapping under an existing user-approved resume policy, start a new source epoch and record the interruption. Never substitute the laptop microphone.

On sample-rate/channel change, finish the old epoch, describe the new format and require confirmation where mapping changes. Do not silently downmix a two-ear or two-radio recording to mono. Mode/frequency/operator transitions are metadata from existing telemetry, not triggers to reopen the input or mutate CAT.

V1 may reconnect an exact input within the same running, explicitly started session. After app restart, default to recovery plus an explicit Resume action; any future auto-start option must be separately consented, visibly indicated and still unable to arm transmit/output.

On a successful **active contest/log change**, finalize the old capture under its original durable identity and leave the new session stopped until explicitly started. Do not silently redirect an existing recording to a different log or let recorder finalization turn a successful navigation/log operation into a failure. A short finalization timeout leaves recoverable metadata and a clear recorder warning. Closing a read-only Analytics/Recorder view is not an active log change. A genuine application sleep, device interruption or explicit Pause creates a recorded gap; do not erase silence or infer off-time from the absence of QSOs.

## 6. Audio timing and QSO association

### 6.1 Required identifiers

Separate:

- **Durable log identity:** the persistent database/contest identity already used by xLog; verify its exact representation. Never use a row number or a mutable display name.
- **QSO ID and committed revision:** the host's existing stable identifier and result/audit revision.
- **Workspace generation:** short-lived command fence, not the durable archive key.
- **Capture ID:** unique recording run within the durable contest identity.
- **Source ID / epoch:** physical input, channel map and format lifecycle.
- **Segment ID and sample/frame interval:** exact stored media position.

A deleted contact does not automatically delete original audio. Its link can be tombstoned in the recorder index. Restoring the same QSO ID restores association. Importing an identical callsign in another log does not inherit that audio.

### 6.2 Timing model

Use sample/frame counts and a monotonic host-clock reference for capture order. Store UTC anchors separately for navigation and correlation. Record input latency if available; explicitly mark whether timestamps represent hardware capture, callback arrival or an estimated compensated time. Do not represent “received on this laptop” as “occurred at the distant radio” without a supported timing model.

On a wall-clock step, new stream or unknown discontinuity, start a new mapping epoch. Preserve prior anchors and emit a clock/gap event. Do not reorder or stretch the original audio to make it look continuous. UTC searches that overlap two clock epochs must expose ambiguity rather than arbitrarily choose one.

Without changing a contact, an annotation may provide a reviewed alignment offset for navigation. Label it as an annotation; retain original timestamps, sample indices and uncertainty. Future independent-device capture needs drift measurements, not just equal nominal sample rates.

### 6.3 Commit integration

Listen to the **authoritative successful mutation/receipt path** of `not1mm-python` and its existing audit sequence. Do not create a QSO audio link on Enter-key press, before validation, from a selected spot, or from a log-row redraw.

For precise correlation, take a lightweight local sample/monotonic marker when an existing log operation is admitted, keyed by that operation ID. The already-existing confirmed result attaches that marker to the durable QSO. An admission marker is not proof of a committed contact. Late acknowledgements must use the marker's original time rather than the callback time when the acknowledgement finally arrives.

A default QSO playback interval may be **45 seconds before the locally observed logging marker and 10 seconds after it**. This is configurable context, not an inferred exact QSO start/end. Operators can widen the interval without changing the source or contact. If no admission marker exists, use a clearly labelled recorded-QSO-time estimate; do not pretend it has the same accuracy.

Post-roll has a visible `Pending` state until the samples exist. Overlapping intervals share the same archive. Do not spawn a new capture or duplicate full audio per QSO.

Receipt replay/retry must not create duplicate links. Deduplicate using durable log/QSO identity and original commit receipt/sequence; a later correction updates the displayed metadata/revision but does not make a second QSO bookmark or silently move the recorded interval.

### 6.4 Recovery and reconciliation

Recorder indexing is asynchronous and subordinate to logging. If a recorder metadata write fails after a QSO commits, the QSO remains successful and the recorder shows degraded linking. Use a narrow read-only query of the existing ordered audit/receipt stream to catch up from its saved cursor. Do not add a synchronous distributed transaction between the contest database and audio files.

Backfilled links must be labelled estimated when their exact local marker was unavailable. Handle late replayed receipts, correction/deletion events, pagination and restarts idempotently. Do not hold long read transactions against the live contest database while building an index or exporting recordings.

For network/multi-op contacts not captured by this local source, do not imply local audio coverage. Preserve the remote origin and show unlinked unless a matching, verified capture exists. Audio replication and cross-machine synchronization are M5, not an excuse to misattribute local audio now.

## 7. Local storage and recovery

### 7.1 Layout and minimum schema

Use an operator-selected local recording root under existing user-data conventions, for example:

```text
Contesting/Recordings/<durable-log-id>/<capture-id>/
    manifest.json
    events.jsonl
    audio/<source-epoch-id>/000001.wav
    audio/<source-epoch-id>/000002.wav
    audio/<source-epoch-id>/000003.partial
    exports/                         # derived only, optional
```

This is a proposed layout. Adapt names to existing conventions; do not store audio blobs in the QSO database or create a second authoritative log.

A compact native append-only metadata journal plus an atomically replaced manifest is sufficient for v1. Reuse an existing suitable metadata store if present; do not introduce a database framework merely to store bookmarks.

| Record | Minimum information |
|---|---|
| Manifest | schema, durable log/capture IDs, creating app/source version, status, consent/start policy, UTC anchors, source maps, archive format, finalized segment inventory, recovery state |
| Source epoch | stable device UID, friendly label, radio/receiver mapping or Unknown, channel roles, sample rate, bit depth, clock/time basis, start/end |
| Segment | ID, source epoch, relative path, first frame, frame count, actual bytes, UTC/monotonic anchors, finalized status and hash |
| QSO link | log/QSO IDs, original commit operation/sequence, captured local marker, original timestamp, current metadata revision, source/time interval, basis/confidence, coverage and pending tail |
| Manual bookmark | ID, capture/source scope, immutable captured time/frame, note/category, creation time and optional QSO link |
| Gap/health event | source, reason, known start/end/frame loss or unknown bounds, detection time, recovery action |

Use typed statuses, bounded strings/arrays and explicit units. Keep credentials, full unrelated environment data and arbitrary executable paths out of manifests. Large frame counters crossing the JS boundary should use safe exact representations such as decimal strings where needed.

### 7.2 Finalization and crash handling

Write active media to a controlled partial file; finalize valid headers/lengths, flush using the supported platform durability path, close, then atomically rename and publish it as finalized. Do not announce a final segment before it is recoverable. A bounded progress checkpoint, e.g. every second outside the callback, permits repair of the valid partial tail. State the measured power-loss limits honestly; `flush` alone is not a universal power-failure guarantee.

On startup, scan only this recorder's known incomplete sessions and repair/recover to a new valid file where possible. Preserve the partial original until recovery is verified. Truncate only incomplete frames beyond a verified valid boundary; never create samples that were not captured. Keep an event describing discarded/unrecoverable bytes. Completed original segments must remain unchanged.

A corrupt/missing segment is an explicit coverage hole. Hashes detect accidental changes against the stored manifest; they do not constitute tamper-proof evidence, a trusted clock or legal chain of custody.

### 7.3 Low disk and exports

Storage estimate is calculated from the actual format:

`bytes = sample_rate × channels × bytes_per_sample × seconds`.

For 48 kHz, 16-bit stereo PCM: **691,200,000 bytes/hour**, **33,177,600,000 bytes/48 hours**, about **30.90 GiB** excluding headers/metadata. Two such streams approximately double this. These are arithmetic estimates, not measured codec compression ratios.

Provide configurable warning/reserve thresholds; suggested initial warnings are less than 60 minutes' estimated capacity or 5 GiB free, with a protected stop reserve of the greater of 1 GiB and roughly ten minutes' capture capacity. Evaluate against the actual destination volume and shared log-storage volume. Operator overrides must remain explicit. On storage exhaustion or hard errors, finalize what is safe, mark the gap/stopped state and preserve capacity for QSO logging.

Do not delete old chunks automatically, silently switch destination volumes, write to another directory after a removable disk disappears, or include huge unbounded media in routine log backups. Any active recording backup uses a frozen high-water mark of finalized segments plus a metadata snapshot, without pausing capture. State which active tail is not covered.

Export can create an ordered audio bundle/playlist with manifest, channel map, gap report and hashes; optional QSO clips are derived extracts. Validate every member under the selected root. A multi-GB bundle needs streaming/ZIP64 or a directory export, not one giant in-memory blob. Cancelled export leaves no falsely complete result. Never overwrite original files, log records or the only existing archive.

A 90-day automatic deletion default is inappropriate: organizer requests can arrive near a rule-specific limit and need further retention. Default to user-managed retention; deletion must show scope, size and affected recordings and require confirmation. Deleting a bookmark/contact is not deleting the archive.

## 8. Playback and transmit isolation

The listening player is a separate capability with no station-write dependency. It may share decoding/device-enumeration utilities but never `ContestVoiceOutput.play()`, `contest_voice_ptt` or message admission objects.

Select output by explicit device identity and channel mapping. Reject a known transmitter output or indistinguishable unsafe route; do not infer safety from a friendly name containing “speaker”. Missing/disconnected/changed output stops replay, retains recording and requires re-selection. No silent fallback to the system default. Start at a conservative remembered listening volume and avoid feedback/automatic live monitoring.

Read only the requested interval from the memory history, finalized files or a consistent active-segment snapshot. Capture must not wait for a replay/export reader. Pending requests carry capture/source/playback generations; after Stop, session switch or newer playback, old callbacks cannot begin sound.

Gaps are visible and preserved on the timeline. Do not join surrounding audio without indicating the missing interval. At a gap boundary, stop with an explanation or use an explicitly labelled derived playback representation; a fabricated silent sample interval must never be written back as original audio.

On Return to live, stop replay promptly. If xLog is not responsible for the operator's live headphone mix, the button means “stop replay”, not “restore a radio route we never owned”. Do not touch external monitor volume or audio-routing defaults.

## 9. Permissions, privacy and security

For the actual macOS capture owner, implement/check the applicable input permission and purpose text. Apple's documented audio-input entitlement concerns Core Audio input under Hardened Runtime. Verify the shipped app/helper's signing identity, effective entitlements and permission attribution—not merely a successful `npm` or Terminal test. See official Apple sources in section 20; do not cargo-cult entitlements from forum snippets.

Do not raise the minimum OS above 14.0 to use a newer process-audio tap API unless separately authorized. The v1 explicit input-device approach must work on the declared minimum. No broad screen recording or system audio tap feature is necessary for v1.

Record only the selected input after explicit opt-in. Display capture activity in the application. Do not capture unrelated microphones/system sound, install a virtual driver automatically, reset the user's TCC database, disable Hardened Runtime/library validation, or grant broad filesystem/network permissions.

Validate recording roots, relative file references, symlinks and export destinations. UI commands use IDs or native-approved destination handles, never arbitrary file-read paths. Do not relax CSP globally to make playback work; prefer native playback or a tightly scoped existing asset mechanism.

All content stays local by default. Public sharing, telemetry uploads of audio and automatic organizer submissions are out of scope. Annotations may contain personal data; include them in export only with an explicit choice.

## 10. Contest rules and review behavior

During the contest, replay may assist the operator's own listening subject to the selected rules. Do not make a universal claim that every contest/category permits every future processing feature. V1 provides listening and bookmarks only: no ASR, automated callsign suggestions or external confirmation sources.

For CQ WW, distinguish continuous archive coverage and the actual captured audio roles. Receiver-only capture is useful but must be labelled **RX only / transmitted audio not verified**. Two independent receiver tracks are not automatically the as-heard stereo mix. PTT metadata or saved outgoing WAV content is not a measurement of transmitted monitor audio. Confirmed headphone/TX coverage requires an operator-controlled real-route check, not an automated flag.

Post-contest playback and Analytics remain read-only with a concise rule reminder. Do not add “correct from audio” actions, auto-fill exchanges, or route replay into the log editor. Preserve existing legitimate note/audit workflows without creating a blanket rule that all post-contest notes or metadata edits are forbidden.

Archive export reports observable coverage, gaps, channel meanings and rule-reference version. It never certifies eligibility, validity of contacts or organizer acceptance. Preserve originals even when a derived clip is normalized or converted later.

## 11. Source capabilities for Flex, SunSDR and conventional radios

| Source | v1 treatment | Never assume |
|---|---|---|
| USB/line input / existing virtual Core Audio input | Implement explicit selection and mono/stereo capture. Applicable to any radio actually feeding it. | CAT connectivity proves audio; a device named after a radio includes both RX and TX. |
| Operator headphone-mix input | Accept an explicitly wired/routed source and label its verified channels. | A receiver stream equals what the operator hears, including TX monitor and SO2R switching. |
| Flex 8400 | Use a verified available macOS input or existing approved receive stream. Inspect current xLog/remote-client audio availability. | Windows DAX drivers exist on macOS; a Flex TCP command connection is a PCM stream; SmartLink audio is already implemented. |
| SunSDR2 DX / ExpertSDR TCI | Use a verified existing input for v1. Direct TCI audio is M5 unless an approved current audio stream already exists. | TCI frequency/mode control alone delivers audio; arbitrary TRX/channel numbers identify valid simultaneous receivers. |
| Two separate physical devices | M5 synchronized multi-source extension. Design metadata for it now. | Equal sample rates imply shared clocks or zero drift. |
| macOS application/system audio tap | Not required for v1; separately scoped later if needed. | It exists on every supported OS or is covered by ordinary input permission. |

If Oliver's actual desired route requires a missing transport, state that concrete requirement. A fully tested Core Audio recorder can be released with an honest route limitation, but do not say “Flex/TCI integrated” without proving the specific advertised path.

## 12. Proposed commands and state model

Names below are design suggestions, not existing API claims. Match established naming and validation styles.

- `recorder_devices`: input/listening-output identities, channels and supported/observed format; no default selection side effect.
- `recorder_configure`: save a validated configuration; no start or output.
- `recorder_start` / `pause` / `resume` / `stop`: fenced, idempotent lifecycle commands for a known log/capture identity.
- `recorder_status`: capture state, sample/write watermarks, gaps, input levels and capacity.
- `recorder_replay`: last-N, durable QSO ID or explicit capture/source interval; safe output identity mandatory.
- `recorder_stop_replay`: cancel only replay, repeated calls harmless.
- `recorder_bookmark`: create/update a bounded annotation without touching a contact.
- `recorder_query_audio_links`: batch lookup for visible QSO IDs; do not make one filesystem scan per table cell.
- `recorder_archive_export`: bounded/cancellable export of a snapshot through a native destination selector.

Mutations must validate current scope and reject stale contexts. User-facing statuses should not expose internal UUIDs except diagnostics. Query/read-only playback of a historical capture must not become an active contest mutation.

Suggested independent state machines:

`Capture: unconfigured → ready → starting → recording → stopping → stopped` with `paused`, `interrupted`, `faulted` and `recoverable` states.

`Playback: idle → preparing → playing → stopping → idle`, independent of capture.

`QSO audio: unlinked | pending-tail | available | partial | unavailable | tombstoned`.

State transitions describe real outcomes. No `recording` state before the first samples and valid writer readiness; no `available` when a required segment is missing. A recorder error must not masquerade as a QSO error.

## 13. Performance requirements

Treat these as **proposed acceptance targets** to measure and report, not promises already established:

- Bounded capture queue and replay history; default 120 seconds history. 48 kHz stereo float32 history is about 43.95 MiB per source before other overhead. Do not retain the whole contest in RAM.
- Replay request dispatch and stop should feel immediate; target <300 ms to locally prepared replay and <150 ms for cancellation under the documented acceptance environment. Separate device-start latency from UI dispatch.
- Compare logging/typing/spot updates with recording off versus on using the same fixture. No lost keystrokes or contacts; no material latency regression (investigate a >10% or >20 ms p95 increase, whichever is larger).
- Native memory should plateau, not grow with every QSO/segment. Measure against existing application baseline; waveform caches are bounded and evictable.
- Logbook scrolling and Analytics playback queries operate on an index, not recursive whole-archive scans.
- Export/hashing/peak generation are background native work with bounded resources, lower priority than logging/capture. Do not spawn a task/process per incoming audio packet.
- A writer-overrun condition records exact known dropped frames or an explicitly unknown loss; it cannot silently report zero gaps.

## 14. Acceptance cases — finite and behavior-based

Use deterministic generated audio with distinguishable channel markers/sample counters and disposable contest data. Reuse the current test runners. Do not add thousands of source-string assertions. The actual Python-backed contest path is mandatory where contacts are involved.

| ID | Scenario | Required observable result |
|---|---|---|
| REC-01 | Permission denied/missing input | Clear setup state; no false recording and normal contest logging works. |
| REC-02 | Mono and stereo configured capture | Actual format/channel content correct; no silent downmix or source substitution. |
| REC-03 | Segment boundary during replay/logging | Frame-continuous originals; no duplicates/loss at rotation; logging unaffected. |
| REC-04 | Replay 5/10/30 while recording | Snapshot ends at keypress; capture continues; same expected samples heard/read. |
| REC-05 | Stop replay, then delayed completion | No late audio restart; emergency-stop behavior unchanged. |
| REC-06 | Missing/known TX listening output | Replay rejected/stopped; no default fallback, PTT/CAT/output calls zero. |
| REC-07 | Confirmed Python QSO commit | One correct durable bookmark with expected pre/post context; log stored once. |
| REC-08 | Invalid/uncertain commit and receipt retry | No false confirmed link; later reconciliation creates one link, no second QSO. |
| REC-09 | Correct call/time; delete/recover QSO | Original audio/link anchor preserved; labels/revision/tombstone correct. |
| REC-10 | Two logs share call and timestamp | Never cross-link audio; reference dataset without a matching archive says unavailable. |
| REC-11 | Long QSO and delayed log acknowledgement | Context can expand; late acknowledgement does not shift link to wrong audio. |
| REC-12 | Device unplug/replug or format change | Visible gap and source epoch; exact-device resume policy; no laptop-mic fallback. |
| REC-13 | Wall-clock jump / DST / timezone change | Sample order stable; UTC anchor discontinuity explicit; no silent retimestamping. |
| REC-14 | Forced crash during segment write | Finalized media preserved; valid partial tail recovered or uncertainty reported. |
| REC-15 | Full disk / blocked writer / disappearing volume | No archive pruning or accidental alternate path; recording stops/degrades honestly; QSO service remains usable. |
| REC-16 | Close/reopen recorder; app relaunch | Window closure does not stop recording; app close finalizes; relaunch recovers without silent capture/output start. |
| REC-17 | Manual bookmark without QSO | Exact captured point and note available after restart; no synthetic contact. |
| REC-18 | Analytics contact/time playback | Correct selected log/source/interval; read-only, no entry focus or radio effects. |
| REC-19 | Export across chunks and gaps | Ordered valid media + manifest/gaps; cancelled export not marked complete; originals unchanged. |
| REC-20 | Archive path/symlink/untrusted request | Controlled root/IDs only; no arbitrary file access or overwrite. |
| REC-21 | Declared stereo R1/R2 channel mapping | Distinct signals remain distinct; no false physical radio/ear attribution. |
| REC-22 | Bounded growth and long-duration index | Accelerated full-event fixture and bounded real-time soak pass without file-size overflow or increasing memory trend. |
| REC-23 | Actual signed application permission/routing | Capture and replay work in packaged app with the intended permission identity; dev-server success alone rejected. |
| REC-24 | Post-contest replay | Rule notice/read-only playback; no audio-driven callsign/exchange mutation path. |
| REC-25 | Feature disabled / recorder failure | Existing entry, scoring, exports, voice keyer and restore behavior remain usable; no unwanted recording. |

For long-duration validation, simulate a 48-hour timeline/index using short deterministic segments and controlled timestamps; do not sleep for 48 hours or write tens of gigabytes just to inflate a test count. Run one bounded real-time soak (for example 30 minutes with repeated rotation, replay and window closure) on a controlled source; report the duration actually completed. A longer operator burn-in can remain a stated external acceptance item.

Continuous RIFF/PCM content tests must inspect samples and frame counts, not just file existence. At least one export must be decoded independently and checked against the fixture. Use safe/headphone or disconnected test output; no station audio loopback or live RF required.

## 15. Work breakdown and execution order

| Milestone | Work and ownership | Exit condition |
|---|---|---|
| M0 — trace & choose | One owner inventories capture/playback paths, permission/signing, stable contest IDs and post-commit events; chooses native backend and minimal dependency. | Short integration map in existing record; no redesign. Actual unsupported source routes explicitly listed. |
| M1 — vertical capture slice | Native owner implements explicit device setup, continuous segments, status and listening-only replay from one mono/stereo source. | Real native input fixture captured/replayed, no station calls, bounded resources. |
| M2 — durable associations | Wire confirmed Python commits/corrections/deletions, metadata journal, recovery, gaps and idempotent catch-up. | REC-07–17 pass on the real authoritative path; recorder faults never break logging. |
| M3 — operator integration | UI owner adds compact strip, recorder panel, bindings, Log Display and existing Analytics actions; archive/export. | User journeys work at compact/expanded sizes; readonly historical scope correct. |
| M4 — harden & deliver | Combined targeted review, fault/performance checks, canonical candidate build, signed-app permission/routing and actual-path acceptance. | Version/provenance, evidence, limitations, rollback and finish verdict recorded. |
| M5 — deferred transport breadth | Independent dual devices, direct TCI/Flex streams, remote clocks, codecs/processing. | Separate authorization/scope after v1, not an endless continuation of M4. |

M1 can be developed before every optional metadata display is finished; do not build all UI screens against fake data and call the recorder complete. M2 and M3 may overlap only with agreed file ownership and a small settled command contract.

If delegating, use at most a native/storage owner and a UI/integration owner, with one independent combined review. Do not let multiple agents concurrently rewrite the large contest workspace. Re-review only the findings amended after that review.

Run focused tests during implementation; run relevant broader native/frontend/Python integration gates at the combined checkpoint. Build/sign once for a coherent candidate, not after every label. A failed check is diagnosed, not retried blindly. Documentation-only commits require no build; packaged source changes follow the repository's unique version/provenance rule.

## 16. Definition of done

A v1 release is complete only when:

- M0–M4 are implemented and all applicable REC cases have actual evidence or an explicit, owner-accepted external limitation.
- Real native continuous capture, instant replay, correct QSO links and Analytics playback are shown in the packaged current application, not only test doubles.
- The fixture uses `engine=not1mm-python`; it does not accidentally test retired `ContestWorkspace`/Swift compatibility paths.
- No recorder action or injected failure produces a radio command, PTT action, QSO mutation outside the existing flow, or destructive archive cleanup.
- Source mapping, RX/TX/ear coverage, permissions, gaps, storage and recovery are explained to the operator.
- Existing normal log, contest scoring/export, voice keyer and active user settings are preserved.
- Updated operator instructions say how to select the actual source, start, replay, locate/export files, recover interruptions and interpret limitations.
- The exact source commit, tested source, candidate version, installed status, signing/notarization status and retained rollback are recorded separately.

Do not use `READY` for a release that only draws a recording strip or stores empty WAV files. Suitable verdicts: **READY FOR VERIFIED CORE AUDIO SOURCE**, **READY WITH NAMED INPUT/OUTPUT LIMITATIONS**, or **NOT READY**. Hardware-specific claims require hardware-specific evidence.

## 17. Risk register and decisions

| Risk | Mitigation / decision |
|---|---|
| Replay reaches TX or acoustic VOX | Separate capability/output, known-TX rejection, explicit headset verification, no PTT access; disclose external routing limits. |
| UI reload stops archive | Native application-lifetime ownership; views subscribe only. |
| Disk filling jeopardizes log | Early capacity warnings, protected reserve, recorder-first stop, no auto-pruning. |
| Audio/QSO timestamps drift | Sample/monotonic indexing, UTC epochs, latency provenance and explicit uncertain correlation. |
| Recording misleadingly called compliant | Coverage facts rather than compliance badges; event-year rule reference verified. |
| QSO edit breaks links | Stable durable IDs; immutable original anchors; display metadata updated separately. |
| Provider work becomes another large port | Core Audio v1 first, named unsupported routes, M5 separate. |
| Thousands of tests hide wrong integration path | REC-07/18/23 require current packaged native/Python routes and sample-level evidence. |
| Accidentally changing live contest | Candidate/install authorization boundary; disposable sessions; no auto-start or station writes. |

Dependencies that may require operator input are exact input/output selection and granting OS permission. These do not justify stalling storage, identity, fixture and UI work. Do not assume credentials, virtual drivers or network audio routes that have not been verified.

## 18. Final Codex report template

```text
Verdict:
Implemented scope (M0–M4):
Source commit / clean or dirty state:
Candidate version / receipt / packaged and installed identities:
Native capture backend and dependencies:
Verified source device(s), format and mapping:
Listening output verification and no-station-write evidence:
Actual Python contest event-path evidence:
Continuous capture / instant replay / QSO links / Analytics results:
Crash, gap, device-loss and low-disk results:
Memory/latency/soak measurements (environment and actual duration):
Archive format, location, export and integrity check:
REC acceptance results and exact evidence locations:
RX-only / TX / operator-ear coverage facts:
Remaining hardware/protocol limitations (M5):
Previous app / rollback and protected-data evidence:
Operator instructions:
Stopped scope: no further automatic feature expansion.
```

## 19. Live project checklist

Keep this concise and update it alongside logical commits. `Done` requires evidence, not only an implementation claim.

| Milestone | State | Implementing commit | Evidence / blocker |
|---|---|---|---|
| M0 | Not started | — | — |
| M1 | Not started | — | — |
| M2 | Not started | — | — |
| M3 | Not started | — | — |
| M4 | Not started | — | — |
| M5 | Deferred | — | Separate transport breadth |

## 20. Sources and traceability

**Repository sources — pinned review baseline, not installed acceptance:**

- [Repository workflow](https://github.com/oliverbross/OM0RX-xLog/blob/ec981e72a896ddb0a26e48f43ecd6822f9d7bf9d/AGENTS.md)
- [Transmit-oriented voice player](https://github.com/oliverbross/OM0RX-xLog/blob/ec981e72a896ddb0a26e48f43ecd6822f9d7bf9d/prototype/src/contesting/contestVoiceOutput.ts)
- [Python-backed contest workspace](https://github.com/oliverbross/OM0RX-xLog/blob/ec981e72a896ddb0a26e48f43ecd6822f9d7bf9d/prototype/src/contesting/Not1MMContestWorkspace.tsx)
- [QSO identities, receipts and audit store](https://github.com/oliverbross/OM0RX-xLog/blob/ec981e72a896ddb0a26e48f43ecd6822f9d7bf9d/python/contest_host/store.py)
- [Analytics contact drilldown](https://github.com/oliverbross/OM0RX-xLog/blob/ec981e72a896ddb0a26e48f43ecd6822f9d7bf9d/prototype/src/contesting/ContestAnalyticsDetails.tsx)
- [Native manifest](https://github.com/oliverbross/OM0RX-xLog/blob/ec981e72a896ddb0a26e48f43ecd6822f9d7bf9d/prototype/src-tauri/Cargo.toml)
- [Application configuration](https://github.com/oliverbross/OM0RX-xLog/blob/ec981e72a896ddb0a26e48f43ecd6822f9d7bf9d/prototype/src-tauri/tauri.conf.json)

**User-provided reference:** `N1MMPlus.pdf`, 823 pages, printed 2026-10-03. Relevant sections: pp. 790–791 QSOrder; pp. 201–204 Audio Setup; p. 60 post-contest logging changes. Cite these page references in implementation notes; do not publish the entire supplied manual into the repository.

**External primary references, checked during preparation:**

- [QSOrder project](https://github.com/k3it/qsorder): buffer, contact-event clipping, optional continuous recording. Reference behavior, not mandatory architecture.
- [QSOCapture project](https://github.com/sq3rx/QSOCapture): documented TCI/soundcard capture and per-receiver workflows. Verify source/license before borrowing; do not copy its entire service stack or deletion policy.
- [CQ WW rules](https://cqww.com/rules.htm), IX.9 and XII.B; [rules FAQ](https://cqww.com/rules_faq.htm), Logging Questions. Generic endpoint cache returned 2025-labelled content during this review; revalidate the selected event year before embedding policy details.
- [Visually inspected 2025 CQ WW PDF](https://cqww.com/rules/2025_rules_cqww.pdf), pp. 5–6. Historical supporting reference only, not proof of a newer rules version.
- [Apple: audio-input entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input)
- [Apple: microphone purpose string](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription)
- [Apple: media capture authorization on macOS](https://developer.apple.com/documentation/bundleresources/requesting-authorization-for-media-capture-on-macos)

The proposed defaults, storage structure, performance targets, milestones and acceptance matrix are engineering decisions in this brief. They are not quoted manufacturer guarantees or organizer certification.
