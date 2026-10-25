# Contest Recorder

Open **Contest → Recorder**. Opening or restoring this window never starts an input or sound. Closing it leaves an explicitly started recording running; quitting xLog finalizes capture. The recorder is independent of scoring and the transmit voice keyer.

## Choose and verify the route

1. Open the intended Python contest session. Expand **Source, listening route & storage**.
2. Choose the exact installed input, its current native sample rate, and mono or stereo. The recorder preserves the selected channels as PCM16 WAV; it does not change Audio MIDI settings, device gain, defaults, or radio settings. A missing source never falls back to another microphone.
3. Name each channel truthfully. Choose receiver audio, operator headphone mix, or custom mapping. Two receiver tracks do not establish operator-ear or transmitted-monitor coverage. RX-only recordings must remain labelled RX only; TX coverage is unverified until checked on the actual route.
4. Choose a **separate listening output** and verify the complete headset/mixer/virtual-cable/VOX route. The system output (a possible voice-keyer transmit route) and recognizable TX outputs are excluded. Opaque WebKit sink IDs cannot be automatically correlated to every physical route: operator verification is still required. The listening output must currently use the archive's sample rate; xLog does not change that rate or silently substitute another output.
5. Choose an existing local recording folder if the default displayed folder is unsuitable. Confirm free space and reserve. At 48 kHz stereo, PCM16 uses 691.2 MB/hour, about 30.90 GiB/48 hours, plus metadata. Retention is user managed; **no originals are automatically deleted**.
6. Check the route-confirmation box and **Save settings**. Save does not start recording. **Cancel edits** restores the saved setup.

**Start / Resume** is the explicit input-permission action. If macOS denies/restricts access, normal logging continues. Grant access through System Settings → Privacy & Security → Microphone when ready, then retry. No screen/system-audio permission or virtual-driver installation is involved.

**Record test · 10 s** explicitly captures the selected source into the separate `Tests` folder and stops automatically. It creates no QSO links and does not start playback. Select that test archive and explicitly replay it only after verifying the listening route. Keep or remove test material manually; the recorder does not prune it.

## Record, replay and bookmark

- The Main Logging strip shows actual input/writer state and a synced watermark. Input silence with advancing callbacks is distinct from interruption. A busy/unreachable writer is not reported as healthy recording.
- **Pause capture** / **Stop capture** finalize the current run. Resume starts a new capture/source epoch. A successful active log change stops the old recording; the new log remains stopped until Start.
- **Replay 5/10/30 s** freezes an interval ending at the captured watermark when native replay is requested. Incoming samples do not move the endpoint. If less history exists, only the available prefix is used. Capture continues during replay.
- **Stop replay** stops listening only. Escape also cancels replay without consuming the existing emergency-stop key. Observed transmit/output activity cancels replay; the recorder never sends RX/PTT-off or changes station ownership.
- **Bookmark now** stores the current captured point and optional note without creating a contact. The full bookmark index can be searched and paged after restart.
- Confirmed local `not1mm-python` commits get durable bookmarks after persistence, including receipt retry/reconciliation. Initial context is 45 seconds before and 10 seconds after the local admission marker. This is listening context, not an inferred exact QSO duration. The tail is `Pending` until recorded. Missing admission markers use an explicitly labelled recorded-QSO-time estimate. Imported/remote contacts do not inherit local audio.
- Corrections update labels/revision, preserving original contact metadata and sample anchors. Deletion tombstones the link and preserves original audio. The same call/time in another log cannot borrow the active log's recording.

Use **Audio** beside a Log Display contact, its context-menu listening action, or **Listen** in Analytics. These prepare the exact log/contact or UTC interval in Recorder. They never retune, switch the active contest, focus Entry, or change a QSO. Ambiguous clock/capture mappings and unmatched reference data say unavailable.

Select a bookmark/UTC point, adjust pre/post context, then **Play selection**. Playback supports seeking, recorded-channel selection, explicit listening output channels, and conservative independent gain (0–50%). Preparation is bounded to twelve minutes; longer Analytics selections can be explicitly shortened with **Use available audio**, or navigated in smaller intervals. Pending/partial tails require that explicit available-audio choice. Missing/corrupt media stops playback.

Default bindings: **Ctrl+Alt+1** replays 10 seconds; **Alt+A** opens Recorder. Replay 5/30, Stop replay and Bookmark now are available in **Edit Keys** for optional assignments. Existing custom/N1MM profiles remain intact. The existing 512-byte key-preference limit is preserved; replace unused assignments if a custom table is full. No F1–F12 or global keyboard hooks are repurposed.

## Files, recovery and export

The displayed recording root contains `<log UUID>/<capture UUID>/manifest.json`, `events.jsonl`, numbered `.wav` originals and, while active, a `.partial` WAV. IDs are diagnostic identities, not editable filenames. Manifests record format, source/channel labels, app/source identity, frame counts, UTC anchors, gaps, segment inventory and SHA-256 hashes. No PCM passes through Python, JSON/base64 or React state.

Source loss, source-format changes, clock steps, queue overrun, low disk or disappearing volumes stop/degrade recording explicitly. There is no default-device fallback or alternate destination. Restore the exact source, verify settings, and explicitly Start a new epoch. Unrecorded intervals remain gaps.

On recorder startup, known incomplete archives are checked without arming capture. **Recover archive** repairs a valid partial tail into a new WAV, retaining the partial original and reporting discarded incomplete-frame bytes/uncertainty. It cannot repair an actively recording run. Missing/corrupt completed segments remain holes. A torn final metadata line is retained in an `events.torn-original-…` copy before the valid journal prefix is reused. Recorder errors never roll back a committed QSO.

**Export finalized archive…** chooses a separate parent folder and writes an ordered directory bundle: WAV parts, `continuous.m3u`, bookmark metadata, gaps/source mapping and hashes. It streams files and verifies copies; originals remain unchanged. The completion `manifest.json` is written last. Cancelled/failed exports have no completion manifest. Active exports freeze finalized segments; the current partial tail is excluded. Private notes are omitted unless explicitly included. Very large events remain valid bounded WAV parts, not an overflowing single RIFF file.

Sync/checkpoint calls improve recoverability, but do not prove hardware power-loss durability. Hashes detect accidental changes; they are not a trusted-clock, tamper-proof or organizer-compliance certificate. Recordings remain local; there is no upload or automatic retention policy.

Post-contest listening is read-only. Check the selected event's applicable current rules; do not use recordings to correct logged calls/exchanges after the contest. The application makes no blanket “CQ WW compliant” claim.

## This delivery's boundary

Oliver confirmed that audio is disconnected. Actual signed-app permission, input content, listening routing, RF/VOX separation and the bounded real-time source soak remain pending. The candidate is not installed over the active contest application. Direct Flex/DAX/TCI/remote PCM and independent dual-input synchronization are deferred M5 work.
