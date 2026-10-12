# CW macro and WinKeyer stage

User-authorized feature, recorded as CW-01/02/03 in the operator feedback tracker.
Radio is intentionally off: no actual keying, PTT, tuning, or serial-device probes
are part of overnight acceptance.

## Current state

The source now wires Settings → CW, native preferences persistence, optional desk
buttons and main-window shortcuts into the guarded output controller. This is not
yet installed or hardware-accepted. Twenty slots support six named colours,
F1–F12 / Shift+F1–F12, enable/desk visibility and strict ASCII previews. Tokens are
`{MYCALL}`, `{CALL}`, `{RST}`, `{NAME}`, `{GRID}` and `{SERIAL}`; SERIAL reads the
QSO's preserved ADIF `extraFields.STX`, never an invented counter.

Saving and previewing never send. Connecting WinKeyer is a separate explicit
action with saved port and control-line consent; changing that port clears consent.
The desk row keeps Arm/Stop visible and puts excess selected macros into a More
menu. Arming is memory-only, foreground-only and expires after 60 seconds. Focus,
view/QSO identity, output or saved profile changes disarm. Typing, dialogs, IME,
OS-modified keys and repeat events cannot trigger macro shortcuts.

The controller retains the original provider/generation before any send attempt
or WinKeyer lease request. Lost acknowledgements retain Stop, never retry text.
Stop runs immediately and again after an already-in-flight Arm/Send settles;
failure retains the recovery guard. Old/out-of-order idle polls cannot clear a
new macro's ownership. Native Hamlib/FLEX/remote-agent controls check the expected
connection generation before writes. Radio readback, CW mode, TX opt-in and both
send/stop capabilities are required. Editor/tooltip/controller share the actual
80-character Hamlib or 128-character station/WinKeyer limit.

### Source-stage verification — 13 October 2026

- Shared frontend: **344/344 tests**, TypeScript and production Vite build pass.
  Includes 19 injected-I/O controller tests, nine preview boundary cases, settings
  Save/validation/20-slot/port-consent tests, and actual hook focus/shortcut tests.
- Rust: **73 unit + 18 Hamlib integration tests**, all pass. Generation-fence tests
  include a fake TCP peer proving stale CW Send/Stop write no bytes. Clippy passes
  with the pre-existing eight-argument `Session::new` warning only.
- Native Swift core: **72 tests** pass, including legacy-settings migration,
  macro round-trip, rejection of invalid fields and stripping of transient fields.
- Mac portable-worker suite: **138 XCTest + 40 Swift Testing cases**, all pass.
  FLEX fake-radio tests prove stale/malformed generations send no commands, and
  matching Send/Stop generation succeeds. Remote generation rejection is tested
  without connecting; this does not replace connected-agent acceptance.
- Six synthetic component captures at 1000/1440 CSS pixels and 1920 at 2x device
  scale are under `.impeccable/review/cw/`. They are not installed Tauri captures.
  The independent finish reviewer found a preview-limit mismatch; source and nine
  boundary tests address it. The verdict pass scored that single fix **resolved**,
  disposition **ship** at that scope. Documentation handoff is complete in
  `CW_UI_DOCUMENTATION_2026-10-13.md`; the incumbent design is unchanged.

Full build retains the existing >500 kB bundle warning; this stage does not close
app-wide performance acceptance. No serial device was enumerated/opened, no
radio/PA/rotor commands were sent, and installed alpha.6 remains unchanged.

The Rust desktop now routes main-window-only `winkeyer_*` requests to an independent
serial actor in `prototype/src-tauri/src/winkeyer.rs`. This source stage is not
installed. It uses `serialport` 4.10.1 (locked dependency; no system libudev feature),
1200 baud / 8N2, explicit Connect with control-line consent, an echo/Host Open/status
handshake, and continuously serviced status/flow control. Accepted firmware replies
are the documented WK2 revision 23 and WK3 revisions 30/31. Original WK1, older WK2
firmware, other revisions and compatible/OEM clones are not assumed supported.

The 19 WinKeyer tests include threaded fake-serial execution, not just source
inspection. At the transport checkpoint, 71 unit + 16 integration tests passed;
the current larger suite is recorded above.
The 19 focused tests also pass serially. `cargo clippy --all-targets` passes with
only the existing `hamlib::Session::new` argument-count warning; no WinKeyer lint
warnings. Distribution metadata already inventories locked Cargo dependencies and
copies their supplied notices, so the next package will include serialport's
resolved dependency/licence records (the new package itself has not been built).
No physical serial port was opened, no keyer was enumerated/probed, and no RF or
station configuration changes were made. Windows/Linux build and hardware tests
remain separate gates. The installed alpha.6 is unchanged.

### Backend contract enforced by the UI/controller

- Requests use the existing `{id, method, params}` envelope and return
  `{id, ok, result}` or `{id, ok:false, error:{code:"WINKEYER", message}}`.
- `winkeyer_ports` is inventory only. `winkeyer_connect` requires `port` and
  `confirm_serial_control:true`. It returns a generation immediately in connecting
  phase; poll `winkeyer_snapshot`. Connecting/closing never queue CW operations.
- Every action other than inventory/connect/snapshot requires that exact
  `generation`. No reconnect or alternate-device fallback is implicit.
- `winkeyer_arm` additionally requires `confirm_transmit:true`, fresh idle status,
  and no owned output. Arming lasts 60 seconds, is memory-only, and expires into
  cancellation/Stop, not replay. The frontend must also disarm on focus loss,
  profile/output changes and context changes; backend arming alone does not meet
  the foreground-only shortcut requirement.
- `winkeyer_send` takes an increasing positive integer `intent` plus validated
  uppercase ASCII `text` (1–128 bytes). Rejected send intents are consumed. The
  response means accepted, never transmitted. UI timeout must never retry text.
  One macro is active at a time, with bounded single-character writes and XOFF.
- `winkeyer_speed` takes integer `wpm` (5–99), only when fresh and idle. No mode,
  pin, key/PTT routing, EEPROM, factory reset or manual key-down controls exist.
- `winkeyer_stop` bypasses the command queue, discards queued Arm/Send operations,
  disarms and requests Clear Buffer only for xLog-owned output. Pending paddle
  break-in is read first; it cancels host ownership and never resumes host text.
  A Stop acknowledgement is only a request, not confirmation of physical idle.
- `winkeyer_disconnect` requests Stop, waits up to one second for settled idle,
  then Host Close. Poll the snapshot; call disconnect again when terminal to
  retire the session. If output remains uncertain, retirement additionally requires
  `confirm_output_stopped:true` after the operator checks the keyer physically.
  A failed/partial write closes the transport without further command bytes: its
  parser boundary is unknown. Never send a new macro or reconnect automatically.
- Snapshots expose phase, firmware, status flags/age, remaining arming time,
  ownership, pending count and last intent; they contain no macro text. Serial
  echo is ignored as proof. Neither BUSY/idle nor a successful write proves RF.

Tests cover status tagging, all WK1 status bits, handshake/unsupported firmware,
fresh arming, invalid text/repeated intents, XOFF, paddle cancellation, Stop,
expiry/stale status, partial writes, settle timing across status polls, generation
fencing, surface restriction, expired queued requests, port-open failure, EOF and
owned/unowned shutdown. Actual driver timeouts, device-buffer behavior, hotplug and
all three OS packages still need real-target acceptance.

## Implemented integration contract and remaining acceptance

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
4. The WinKeyer actor is integrated with that controller and editor in source.
   Preserve its generation/intent/uncertainty gates; do not bypass them through
   ad-hoc UI serial calls. Complete packaged and real-target acceptance separately.

Still required: exact signed/notarized Mac package, installed preference/shortcut
and error-state checks without RF, physical keyer/driver hotplug and serial
timing, supported-radio connected acceptance, and actual Windows/Linux packages.
No generic promise of all radios, firmware or operating systems follows from the
fake-device tests. The new profile defaults to no desk row and no assigned keys.

## Protocol references and constraints

Primary references:
- https://www.k1elsystems.com/files/WK3_Datasheet_v1.3.pdf
- https://k1elsystems.com/files/WinkeyInterfaceGuide.pdf

Exact serial settings, Host Open and WK1-compatible status table 14 were rechecked
against K1EL's primary WK2/WK3 manuals through web document/search tools. Additional
revision reference: https://www.k1elsystems.com/files/WK3_Datasheet_v1.pdf (page 42).
The local PDF extraction command was policy-blocked; do not repeat or bypass it.

Implemented protocol: 1200 baud, 8N2; Host Open `00 02` and a firmware revision
handshake; Host Close `00 03`; Clear Buffer `0A`; speed `02 nn` (5–99). Clear only
owned or uncertain xLog sends on release, never unowned paddle activity. Do not
implement manual PTT (`18`), immediate/timed key-down, EEPROM writes, factory reset
or automatic pin-configuration overrides in this stage. Connect asserts DTR and
clears RTS, as described in K1EL's interface guide. These changes (including an
OS/driver's brief DTR assertion on open) can have electrical effects: require
explicit connection and show the warning in settings;
do not claim all WinKeyer generations or OEM variants are verified.

The RD-Nexus `crates/tempo-audio/src/winkeyer.rs` module is useful reference only:
it silently filters unsupported text and writes an entire message; those patterns
do not satisfy this stage's explicit validation, flow control or uncertain-send
requirements. No code was copied from it. Existing ShackCQ macro UI patterns may
inform composition; do not infer a WinKeyer backend from its UI.

Acceptance must distinguish pure tests, fake-serial tests, Mac package behavior,
Windows/Linux build/runtime and real keyer/radio evidence. A device accepting text
or echoing characters does not prove RF transmission.
