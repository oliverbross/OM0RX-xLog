# TCI and WinKeyer operating controls

These controls extend the existing native CW/PTT owners. A command receipt,
device status or displayed character is not proof of radiated RF. Physical
qualification remains specific to the server, keyer firmware and station wiring.

## TCI

In the radio's connection setup, open **CW / PTT / audio routing**, review the
**Allow supported TCI PTT/CW** preference, then Save & Connect deliberately.
Older saved setups load with permission off. Saving alone does not connect,
arm, send CW or key PTT. Only the active radio can acquire output.

New output is supported for **ExpertSDR3 advertising TCI 2.1**, with a transmitter,
server TX_ENABLE and fresh addressed TRX observations. PTT is addressed to the
configured TRX. A global TX_FREQUENCY report never becomes a guessed per-TRX TX
frequency or VFO. The one-second read-only TRX/TX_ENABLE/MODULATION heartbeat
keeps actual observation evidence current; snapshot reads do not restamp it.

The active TCI panel shows permission, protocol/TRX/channel, capability reason,
PTT controls and device-reported macro speed. **TCI PTT on** uses canonical native
ownership. **Owned PTT off** releases the retained original owner, including
after focus or visible selection changes; it does not release somebody else's
CAT/CW/Tune transmitter. Old or replacement connections cannot receive a stale
owner's commands.

**Disable TCI transmit now** immediately retires native acquisition authority,
coordinates the existing CW Stop and durable PTT-off owner, and saves permission
off. Release runs independently of a delayed permission acknowledgement or a
failed settings write. An uncertain outcome is shown with the relevant retained
obligation; it must be inspected, not treated as a completed physical release.
Re-enable only through reviewed saved permission and an explicit replacement
connection. Restoring preferences never resumes output.

For CW, select **Active radio** in CW settings and use the existing CW desk's
Arm, message Send and Stop. TCI supplies **whole messages up to 128 supported
characters**. CW requires a server announcing exactly one TRX because the
official CW Stop and macro-speed commands are server-global. Character/word
live append and typed segmented-speed/prosign plans are unavailable on this
adapter. **Apply TCI CW macro speed** sets the global macro speed, 1–60 WPM,
only while idle; it is separate from the paddle-keyer speed. A reported value
and command acceptance remain distinct.

The new execution path does not provide native TCI transmit-audio injection,
carrier Tune, a new socket, reconnect retry or automatic replay. Receive tuning,
filters, spots and IQ retain their existing owner and connection.

## Independent WinKeyer

In **CW settings**, choose Independent WinKeyer, select the exact serial port,
review control-line consent, Save and Connect explicitly. A CAT connection is
not required. Existing local CW/PTT/Tune obligations still exclude conflicting
output. Recognized revisions remain WK2 23 and WK3 30/31 in the supported legacy
host mode; unknown firmware is rejected.

The new **Volatile keyer preferences** fields are optional. An unset field leaves
the device option untouched. Save stores desired preferences; **Apply saved
keyer preferences** sends the chosen finite bundle only with fresh idle status,
and disarms CW. Options are speed source, paired pot minimum/range, weighting,
dit/dah ratio setting and paired PTT lead/tail. No new device defaults, EEPROM,
pin configuration, manual PTT or raw-byte console are introduced.

Pot mode uses the documented zero-speed command. Saved software WPM remains a
separate requested value. The display reports either a pot offset or WPM when
this connection has applied a known compatible range; missing, stale or invalid
reports are not presented as a measured current speed. Temporary message-speed
segments are unavailable in pot mode. Software speed can be applied only while
idle, so a late message restoration cannot overwrite a newer admitted change.

The two-letter typed prosigns AR/AS/BT/SK/KN use the documented buffered merge
operation through the existing FIFO. Echo is bounded and labelled **uncorrelated
device report**: it cannot prove which native job or paddle supplied a character,
complete a new job, refresh stale idle status or establish RF. Paddle break-in
cancels the host tail and disarms without clearing the operator's paddles.

Stop remains the actor's priority path. Partial serial writes, stale status and
uncertain configuration disarm and retain honest recovery state. Reconnect does
not restore text or an armed job. Mode/paddle/sidetone register editing is not
exposed in this finite subset because the supported host contract cannot read
their original complete registers for safe preservation of unrelated bits.

Exact protocol sources, focused tests and outstanding packaged/hardware gates
are recorded in [device evidence](../audits/cqrlog-implementation-2026-11-04/devices.md).
