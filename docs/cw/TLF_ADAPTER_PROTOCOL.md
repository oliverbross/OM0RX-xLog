# Contest CW adapter contract — 4 November 2026

The native CW session consumes the Python compiler's schema-1 `cwSequence`;
text is already formatted, and only typed `text`, `speed` and `restore`
segments become adapter operations. Preview and output use the same compiled
payload. A directive is never silently flattened on an unsupported adapter.

| Production adapter | Complete message | Buffered speed | Owned append | Evidence |
| --- | --- | --- | --- | --- |
| K1EL WK2/WK3 | Existing path retained | `0x1c,wpm`, `0x1e` restore | Cumulative plain calls, monotonic revisions, one captured stream | Native queue admission plus fresh device status; no RF/completed-call claim |
| Flex CWX | Existing path retained | Unavailable in this implementation | Unavailable in this implementation | Existing command replies; physical qualification pending |
| Direct TCI | No new transmit capability | Unavailable | Unavailable | Connection alone establishes no CW transmit capability |
| Hamlib / other existing whole-message routes | Existing admission retained | Unavailable | Unavailable | Existing provider contract retained |

The selected initial advanced production path is WinKeyer. Its single serial
actor submits FIFO speed commands atomically, honours XOFF, and admits an
append only to its original stream and connection. Idle gaps retain stream
ownership. Duplicate/stale intents, edited submitted prefixes, expiry, break-in,
Stop and reconnect cannot replay a tail. Stop discards queued data; if a buffered
speed change was written, it also requests the documented restore. A partial
command write retires the parser boundary and retains uncertainty instead of
injecting release/retry bytes. `restoration_requested` is a request fact, not
observed speed or RF proof. A native outcome-journal failure cannot prevent the
physical Stop attempt.

The existing handshake admits only firmware replies 23, 30 and 31 after Echo
Test, Host Open and a parsed status reply; unknown/WK1 firmware cannot reach the
ready state. Advanced target publication also requires fresh device status.
This is protocol admission evidence, not verification of a clone's physical
conformance. Buffered speed/restore commands also appear in K1EL's original
WinKey v10 protocol; the admitted v23 path does not assume a WK3-only command.

Completing a callsign grants one native continuation to the matching next ESM
exchange on the same captured draft/target. The adapter adds the callsign word
boundary, appends the exchange in FIFO order while the call drains, and consumes
that continuation. It does not reopen generic append admission or suppress a
deliberate repeat. Setup Entry/QTC arms explicitly select `controlSurface=setup`;
their polling retains that actual focus surface. Detached Entry keeps its
existing focus scope, and an unrelated window cannot borrow either arm.

The Host's fresh durable operation carries `earlyCallSuppressed=true` separately
from its text actions. A default `{CALL}` HISCALL action compiles empty after
suppression and is omitted; the decision still reaches native dispatch. Only a
fresh, identity-checked, non-replayed Host result together with the same live
one-use native admission selects `continue_sequence`. It appends the exchange
and its word boundary even while WinKeyer still owns the queued callsign.
Persisted `esmConsumed`, a renderer flag or an old continuation alone grants no
permission. A replay cannot consume the continuation or append again.

Call suppression additionally requires native-authored live continuation
admission matching the unique native owner, lease epoch, provider/generation,
draft, stream and finish operation, plus the current Host process epoch. A
persisted queue receipt or matching generation alone cannot suppress a call.
Restart/Stop/lost continuation recovers with a deliberate full-call operation;
the native boundary refuses exchange-only output without its live continuation.
Drafts and historical receipts remain retained. Nothing automatically replays or
arms on restart. Ordinary provider-accepted full-call receipts still support
the conservative partial-correction policy; WinKeyer queue acceptance alone does
not establish complete-call RF delivery.

Source inspection: Flex documents appending text and indexed sent telemetry,
but an immediate WPM command alone gives no buffered speed boundary. This
change deliberately does not advertise that unimplemented telemetry/sequence
path. The WinKeyer manual documents buffered speed commands and restoration
of the original speed, avoiding host Morse-duration sleeps.

Primary sources retrieved 2026-11-04:

- [K1EL WK3 IC Interface & Operation Manual](https://www.k1elsystems.com/files/WK3_Datasheet_v1.pdf),
  version V30 (2013). Retained at [the original PDF](sources/WK3_Datasheet_v1.pdf),
  SHA-256 `d0146e344fabf4be2098bdca6949ecf5bda1ff0dc50e5111cc1d528876bf7c21`.
- [K1EL WKUSB manual](https://www.k1elsystems.com/files/WKUSB_Manual_v1.3.pdf),
  rev 1.3 (2019), FIFO/echo and speed explanation.
- [FlexRadio CWX API](https://github.com/flexradio/smartsdr-api-docs/wiki/TCPIP-cwx),
  revision displayed 2024-07-17; and the
  [manufacturer CWX status explanation](https://community.flexradio.com/discussion/6316639/cwx-tcp-ip-api-details).

Software tests use deterministic serial/protocol doubles and never key a
transmitter. Hardware acceptance remains **NOT_RUN**, separately for K1EL and
Oliver's Flex path. For K1EL qualification, use the exact connected device and
firmware, isolated/dummy output, deliberate arm, a two-speed compiled message,
slow cumulative typing, XOFF/break-in/Stop and reconnect. Observe actual speed,
restoration and stopped output; retain device-specific results. Flex advanced
operation needs its own indexed progress/ordering implementation and tests
before a physical qualification can be claimed. No installation is implied.

QTC recorder integration uses the existing capture/archive owner. Explicit
series/item markers carry schema-1 session, series, item, operation and event
references at the actual sample watermark. A repeated operation returns the
original marker; it cannot move it forward or start recording. Old bookmarks
remain readable, and QTC metadata survives journal reopen and archive export.
Review selects the captured interval in Recorder without starting playback;
pending/missing coverage remains visible. An inactive recorder gives a clear
unavailable result and does not block QTC accounting.
