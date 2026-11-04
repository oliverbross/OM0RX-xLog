# WAE QTC desk

The QTC desk uses the existing WAE journal, source reservations, confirmation
policy and exports. Opening it does not send, tune, start recording, allocate a
normal QSO serial or replace ordinary Entry.

For receive operation, enter time (HHMM UTC), callsign and serial in individual
rows. Add up to ten rows; Optional bulk paste remains available. Incomplete rows
are saved as editor metadata, separately from pending/confirmed accounting.
The desk autosaves after a short pause; **Save unfinished QTC editor** and
**Return to Entry** flush the current editor before leaving. Unsaved status and
save errors remain visible. Reopening restores saved rows and the selected
series/item/field. A pending item correction also survives closing its editor;
save or explicitly discard it before acknowledging that item.
Saving a valid correction also clears its matching durable editor in the same
transaction, so immediate acknowledgement is available. An older autosave cannot
reopen that saved editor; a different genuinely unsaved correction stays guarded.

For send operation, choose eligible source contacts supplied by the contest
authority. Create the pending series and select **Operate series** or an item.
Review its saved time/callsign/serial and series header. These are historical
snapshots; changing the normal Entry call or serial does not change a QTC.

Use the explicit header, row or field output controls. Receive-side field/row
actions request a repeat; send-side actions send the captured historical content.
Each deliberate repeat creates a new output operation. An uncertain attempt is
retained, and reconnect/reopen does not replay it. The native owner performs
admission and captures the lane/provider binding. A disconnected or unavailable
route reports its limitation without borrowing another radio.

Native desk output currently requires the authoritative single-lane desk.
Exact multi-lane QTC output remains unavailable; manual transfer/accounting is
retained. SSB captures a native target before the host request and verifies that
same target during preparation and PTT. RTTY captures the admitted bridge
generation; an old request cannot cross Stop/re-enable into a replacement lease.
Scoped QTC Stop retains the original release obligation, while ordinary emergency
Stop remains available.

- CW uses the existing native keyer owner and whole-message dispatch.
- SSB uses the existing managed voice-fragment route when its actual configured
  fragments can express the message. Missing fragments are an admission error;
  manual spoken operation remains available.
- RTTY uses the existing admitted digital bridge where available. No modem is
  added, and existing release restrictions remain in force.

Output attempts and their provider/owner evidence appear separately from the
operator's acknowledgment. A successful local response does not confirm reception
or RF completion. **Acknowledge item** records the counterparty acknowledgment;
**Acknowledge and next** does so and advances only when deliberately invoked.
**Complete acknowledged series** requires all items acknowledged and records a
separate operator completion. **Send final QSL** is a separate output action and
never confirms or completes the series by itself.

The desk has scoped keys: Alt+Up/Down selects an item; Alt+Enter acknowledges and
advances; Alt+H requests/sends the header; Alt+R the row; Alt+T/C/S the selected
time/call/serial field. Ordinary input Enter does not run normal Entry ESM.
**Stop QTC output**, or Escape with a connected owner callback, requests the
original native owner's Stop. Stop is attempted even when editor persistence
fails and retains the entries and acknowledgments. Inspect the native release
outcome before another transmission. **Interrupt series** and **Resume same
series** change its journal lifecycle, never automatically restart output.

The local counterpart observation is Unknown, Available, Later or
Unavailable/refused with an observation time. It does not confirm an item,
deduct quota, reserve sources or publish a spot. Eligibility and remaining
capacity come from the WAE authority; a QSO duplicate can still have a QTC
opportunity.
RTTY displays sending and receiving separately: either legal direction with
capacity can be an opportunity. Both directions use the same combined ten-item
quota per counterpart. CW/SSB retain their one-way continent rules. Map display
does not allocate sources, reserve quota or send anything.

Bookmark controls mark series start/end/interruption or an item only against an
already captured recorder timeline. They never start a device. **Review captured
QTC audio** opens the existing Recorder at available coverage; missing files or
gaps remain unavailable. Recorder failure does not block QTC entry/confirmation.
Old bookmarks, originals and archive metadata retain their existing owners.

The software tests exercise field entry, optional paste, editor recovery,
deliberate repeats, keyboard isolation, separate acknowledgment/completion,
Stop during persistence failure and late replies, and truthful recorder failure.
Physical CW/voice/digital output and audio-device qualification require separate
station evidence; source tests do not establish them.
