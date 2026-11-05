# Contest CW adapter contract — 5 November 2026

The Flex extension is source-only at `24900034`. Installed 1.5.15 remains signed
source `1873dc1d`; this development pass produces no application package.

The native CW session consumes the Python compiler's schema-1 `cwSequence`;
text is already formatted, and only typed `text`, `speed` and `restore`
segments become adapter operations. Preview and output use the same compiled
payload. A directive is never silently flattened on an unsupported adapter.

| Production adapter | Complete message | Buffered speed | Owned append | Evidence |
| --- | --- | --- | --- | --- |
| K1EL WK2/WK3 | Existing path retained | `0x1c,wpm`, `0x1e` restore | Cumulative plain calls, monotonic revisions, one captured stream | Native queue admission plus fresh device status; no RF/completed-call claim |
| Flex CWX, native macOS direct LAN | Existing path retained | Unavailable in this milestone | Shared workbench literal deltas, indexed block replies and own-client sent status | Radio-reported characters, never RF proof; physical FLEX-8400 NOT_RUN |
| Direct TCI | Whole literal message, max 128 characters; exactly one advertised TRX | Unavailable | Unavailable | ExpertSDR3 / TCI 2.1; server's real advertised TRX count must be recorded for qualification |
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

Flex workbench append uses the existing selected-radio/native CW lease and
direct Flex owner, not the contest early-call stream. Each immutable delta is
`cwx send "<literal>" <block>` (spaces are DEL/0x7f). Its successful reply must
allocate a unique starting index and echo that block. Accepted ranges are bounded
to 128 characters per append and 2,048 per job. Only `S<our H handle>|cwx
sent=<index>` on the same TCP generation, inside one of those ranges, advances
the monotonic report. Duplicate replies/status, other clients and old generations
cannot advance it. Bounded pre-reply events wait for the exact range allocation.
Erasure, unknown/zero progress handles, malformed/index-reusing replies or lost
acknowledgements withdraw live admission without guessing completion. Stop
retires the job ID even before its first command reaches the adapter, and rejects
late replies/tails. Stop is pinned to the original CWX transport generation;
reconnect never replays or redirects an old release to a replacement connection.
Whole-message Send remains available after ordinary Stop/review, including when
live attribution is unavailable. Remote Agent Flex remains whole-message only.
An unresolved allocation at Stop, or use of the retained unindexed whole-message
path, disables live typing until reconnect, preventing late status from lending
unknown/reused indices to a later job on the same connection.
Exact-lane/early-call contest streaming remains unchanged. An immediate WPM
command gives no buffered speed boundary; Flex typed speed/prosign segments stay
unavailable. The WinKeyer manual documents buffered speed commands and restoration
of the original speed, avoiding host Morse-duration sleeps.

Primary sources retrieved 2026-11-04; Flex contract refreshed 2026-11-05:

- [K1EL WK3 IC Interface & Operation Manual](https://www.k1elsystems.com/files/WK3_Datasheet_v1.pdf),
  version V30 (2013). Retained at [the original PDF](sources/WK3_Datasheet_v1.pdf),
  SHA-256 `d0146e344fabf4be2098bdca6949ecf5bda1ff0dc50e5111cc1d528876bf7c21`.
- [K1EL WKUSB manual](https://www.k1elsystems.com/files/WKUSB_Manual_v1.3.pdf),
  rev 1.3 (2019), FIFO/echo and speed explanation.
- [FlexRadio CWX API](https://github.com/flexradio/smartsdr-api-docs/wiki/TCPIP-CWX),
  revision displayed 2024-07-17; and the
  [manufacturer CWX status explanation](https://community.flexradio.com/discussion/6316639/cwx-tcp-ip-api-details).
- [SmartSDR TCP/IP API](https://github.com/flexradio/smartsdr-api-docs/wiki/SmartSDR-TCPIP-API),
  revision displayed 2026-10-06: H connection handles, S triggering-client handles
  (zero means command-line/system) and sequence-correlated replies.

Software tests use deterministic serial/protocol doubles and never key a
transmitter. Hardware acceptance remains **NOT_RUN**, separately for K1EL and
Oliver's Flex path. For K1EL qualification, use the exact connected device and
firmware, isolated/dummy output, deliberate arm, a two-speed compiled message,
slow cumulative typing, XOFF/break-in/Stop and reconnect. Observe actual speed,
restoration and stopped output; retain device-specific results. Flex advanced
operation has separate pure ownership, real loopback TCP and shared-owner/UI
regressions in the [CWX milestone record](../audits/tlf-contesting-2026-11-05/flex-cwx-milestone.md).
Physical qualification must record the FLEX-8400 firmware, actual CWX block/index
replies and status handles before enabling a supported attributable case. Observe
real keying/Stop/reconnect separately. No development package or installation is implied.

QTC recorder integration uses the existing capture/archive owner. Explicit
series/item markers carry schema-1 session, series, item, operation and event
references at the actual sample watermark. A repeated operation returns the
original marker; it cannot move it forward or start recording. Old bookmarks
remain readable, and QTC metadata survives journal reopen and archive export.
Review selects the captured interval in Recorder without starting playback;
pending/missing coverage remains visible. An inactive recorder gives a clear
unavailable result and does not block QTC accounting.
