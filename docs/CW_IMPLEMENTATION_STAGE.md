# CW macro and WinKeyer stage

User-authorized feature, recorded as CW-01/02/03 in the operator feedback tracker.
Radio is intentionally off: no actual keying, PTT, tuning, or serial-device probes
are part of overnight acceptance.

## Current state

`prototype/src/live/cwMacros.ts` implements pure profile validation (20 slots),
six named colours, optional F1–F12 / Shift+F1–F12 shortcuts, chosen desk buttons,
strict ASCII previews and `{MYCALL}`, `{CALL}`, `{RST}`, `{NAME}`, `{GRID}`,
`{SERIAL}` substitutions. All four tests pass. No editor, persistence, button row,
arming/controller or WinKeyer transport is wired yet. This is not a delivered CW
feature. Never portray the profile engine as hardware support.

## Next implementation boundary

1. Settings → CW: explicit Save, macro editor/preview, output choice (active radio
   or WinKeyer), selected one-row desk buttons. No reconnect or configuration edit
   sends CW. Preserve native settings conventions and the existing compact desk.
2. One main-window output controller: foreground-only shortcuts, typing/IME/dialog
   exclusion, no key-repeat, explicit time-bounded arming, visible Stop, no fan-out,
   no replay/retry after uncertain delivery. Arming and expanded text are never
   persisted. In-flight target identity must survive a failed send so Stop targets
   the same connection, never a new radio.
3. Radio route reuses existing backend TX ownership/opt-in and actual capability
   gates. Hamlib `hamlib_control` actions are `cw` and `cw_stop`; its actual text
   limit is **80**, not the existing UI's 160. Agent/FLEX route uses
   `station_radio_control` with `send_cw` / `clear_cw` and explicit provider. Do not
   silently fall back from an unsupported radio to another transmitter.
4. WinKeyer transport should own a serial port separately from radio/rotor,
   main-window only, with connection generation and consumed intent IDs. Use a
   continuously read, bounded worker so XOFF, paddle break-in and Stop can preempt
   pending text. No UI-thread serial I/O; no raw device commands from templates.
   Port collisions, partial writes, unplug/EOF, unsupported firmware, stale status,
   shutdown and reconnect must be tested with a fake transport before real hardware.

## Protocol references and constraints

Primary references:
- https://www.k1elsystems.com/files/WK3_Datasheet_v1.3.pdf
- https://k1elsystems.com/files/WinkeyInterfaceGuide.pdf

The initial WK3 manual fetch succeeded, but subsequent page-text retrieval failed;
re-read exact command/revision/status tables before implementing the byte parser.
The local PDF extraction command was policy-blocked; do not repeat it or bypass
that restriction. Web/approved document tools are alternatives.

Prior researched outline: 1200 baud, 8N2; Host Open `00 02` and a firmware revision
handshake; Host Close `00 03`; Clear Buffer `0A`; speed `02 nn` (5–99). Clear only
owned or uncertain xLog sends on release, never unowned paddle activity. Do not
implement manual PTT (`18`), immediate/timed key-down, EEPROM writes, factory reset
or automatic pin-configuration overrides in this stage. DTR/RTS changes on serial
open can have electrical effects: require explicit connection and document them;
do not claim all WinKeyer generations or OEM variants are verified.

The RD-Nexus `crates/tempo-audio/src/winkeyer.rs` module is useful reference only:
it silently filters unsupported text and writes an entire message; those patterns
do not satisfy this stage's explicit validation, flow control or uncertain-send
requirements. No code was copied from it. Existing ShackCQ macro UI patterns may
inform composition; do not infer a WinKeyer backend from its UI.

Acceptance must distinguish pure tests, fake-serial tests, Mac package behavior,
Windows/Linux build/runtime and real keyer/radio evidence. A device accepting text
or echoing characters does not prove RF transmission.
