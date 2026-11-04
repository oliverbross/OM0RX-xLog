# Voice memories

Open **Voice memories · normal SSB** below the normal operator controls. Choose
a memory, then use **Send memory** deliberately. Sending does not log a QSO,
change the held draft, reserve a contest serial or select another radio.
**Stop voice** remains available during preparation, playback and release.

Open **Library, recording and audio routes** to select the shared WAV folder.
Voice 1–10 use the existing `f1.wav`–`f10.wav` assets. Existing contest mappings,
spelling fragments and F11/F12 remain intact. Labels and trim/gain metadata are
saved separately from the source WAV, so changing an edit does not destroy its
original audio. Replacing/importing/recording a slot is an explicit library edit.

Choose concrete native devices, sample rates and channel numbers for the
**Microphone**, **Monitor only** and **Transmitter audio** routes. Displayed
channels start at 1. One multichannel interface can serve monitor and transmitter
only through distinct configured channels and appropriate physical connections.
A saved route does not validate that cabling; review the actual connection before
using it. Missing devices or changed native rates/channels block the operation.
The application never substitutes the OS default or guesses a native ID from an
old browser sound-device preference.

Save settings before using the new routes or edits. Save performs no recording,
playback or PTT. Another window's newer settings cause a conflict; your unsaved
text is retained until you reload/review it. Old workspaces start with no native
route selected, and restoring settings never restores a runnable voice action.
Edits made while Save is awaiting acknowledgement stay unsaved and visible;
the acknowledgement cannot clear newer text.

**Record microphone** uses the selected native input, with no automatic gain,
echo cancellation or noise suppression. **Finish recording** saves bounded PCM
audio; **Stop voice** cancels it and retains the existing slot. Recording is
limited to 60 seconds and 8 MiB, whichever is reached first. Select **Replace
selected slot** before replacing an existing file. **Import PCM WAV** uses the
same native WAV validation. Supported source WAVs are frame-aligned mono/stereo
integer PCM, 8–192 kHz, with 8/16/24/32-bit samples.
Cancellation is terminal for that recording: a delayed Finish for the same job
cannot reverse Stop or replace the retained slot. Start a new recording deliberately
when another take is wanted.

Set start/end trim and gain, then save. A blank end means the end of the source.
Duration, peak and clipped-sample feedback describe the derived audio. Lower gain
when clipping is shown. Stereo is averaged to mono; supported rate conversion is
offline linear interpolation, and the resulting mono signal maps only to the
selected output channels. Preview and transmit use this same interpretation.
If the underlying memory changes after review, Send refreshes its review and
requires a new deliberate action instead of sending the changed audio silently.

**Preview on monitor** uses only the saved monitor route and never acquires PTT.
It refuses overlapping transmitter channels and recognized transmitter devices.
**Send memory** requires a current normal workspace/draft, native-issued one-use
action, current live SSB/USB/LSB evidence, selected provider permission and the
existing exclusive PTT owner. A stale draft that says SSB cannot override a live
CW radio. CW, carrier Tune or an unresolved PTT obligation prevents conflicting
acquisition. Keep the initiating window visible and focused while sending.

Before PTT, every segment is decoded and the selected output stream must run
silence with a usable presentation clock. Samples begin only after authoritative
TX confirmation. Normal completion waits for the predicted presentation of the
last sample before releasing PTT; it does not treat callback enqueue as audible
completion. Stop, device failure, sleep/clock discontinuity, window retirement
and context changes cancel remaining samples and release the original PTT owner.
An uncertain release stays visible and prevents another acquisition. Reconnect
does not resume a memory.

**Normal native voice is currently macOS-only**, using CPAL/CoreAudio. Existing contest WAV
assets and Host action claims are shared; on macOS contest playback uses the same
native output path. The existing Windows/Linux contest WebView path is retained,
with native route capability explicitly unavailable. TCI PTT capability does not
provide TCI transmit audio; an independently reviewed OS audio route is required.

Voice configuration is included in the existing settings backup/restore owner.
The WAV folder remains external, as in the existing contest library. Back up that
folder separately and restore its path/assets with the workspace; a settings-only
backup does not embed those audio files. Keep the original source WAVs when moving
or restoring a library.

Native stream progress, file decoding, consumed samples, radio TX/RX observations
and physical/RF output are separate evidence. The software tests establish the
documented PCM, admission and lifecycle contracts; the exact microphone, monitor,
transmitter device/channel wiring, first/last audible audio and radio release
still require qualification on the operator's identified setup.

In the Traditional desk, scroll inside **Active QSO** to reach the expanded
library, routes and editing controls. Scroll back up for the contact fields and
Log QSO controls. Opening or closing the voice panel keeps the draft intact.
