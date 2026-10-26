# Flex companion IQ acquisition

Source implementation and loopback fixtures, 26 October 2026. This document is
not evidence of received FLEX-8400 samples or qualified RF mapping.

The existing `FlexRadioClient` control connection owns one UDP IQ destination
and at most two panadapter flows. `LiveFlexSession` and the per-radio registry
delegate leases to that owner. Stopping a lease does not stop CAT, alter a slice,
create a panadapter, or send a transmit command. Internal consumers share a flow;
the last consumer removes only the stream created by this owner. A known changed
stream owner prevents removal.

Passive subscriptions observe panadapter, DAX and stream metadata. Companion
admission requires an acknowledged binding to exactly one selected Station,
explicit panadapter ownership, distinct assigned IQ channels, a centre and a
receive antenna. Known active competing streams block admission. Absence of a
competitor does not prove a channel free: the operator must release other DAX
consumers and explicitly grant a 30-second handoff in CW Decode. The grant is
bound to the shown panadapter, channel, Station, connection and foreign-stream
metadata. Stop revokes outstanding grants. Handoff never creates a stream.

Physical identity comes from a bounded manufacturer discovery datagram on UDP
4992, matching the actual numeric TCP peer and control port. A hostname or slice
label is not used as a serial number. Missing discovery leaves handoff blocked.
This is the direct local connection implementation; SmartLink IQ and a VPN
without matching local discovery have no acceptance claim.

The owned UDP destination accepts only the connected radio's numeric peer and
LAN source port 4991. Unrelated peers are rejected before Task allocation; one
receive and eight queued datagrams bound delivery. Each flow checks the create
reply, matching owner/channel/panadapter/rate/active status, VITA class and actual
sample arrival. A successful command alone cannot establish Running. Startup,
stall, malformed packets, overflow and sequence discontinuities fail or withdraw
capture evidence. Retunes, antenna/front-end changes and rig-wide TX/unknown
state retire the capture token before asynchronous decoding can publish. Clean
IQ after a 500-ms quarantine starts a new epoch. RF orientation and usable RF
coverage remain unqualified.

Fixtures exercise real loopback TCP/UDP with a simulated radio: explicit handoff,
metadata changes, competitors, pending-create Stop, two distinct panadapters,
shared consumers, retune/TX quarantine and independent cleanup. Physical identity
discovery parsing also has bounded malformed-packet tests. These fixtures do not
substitute for real golden VITA packets, the actual 8400's status/UDP behavior,
packet-loss and RF mapping measurements, or two-band hardware acceptance.

Protocol reference: [official FlexLib 4.3.16 distribution](https://www.flexradio.com/software/smartsdr-v4-x-api-flexlib/),
ZIP SHA-256 `60978db51dac6ea781899dd80832ad4e7876ce96ed72532b57106376fc26463f`.
Reviewed `Discovery.cs`, `DAXIQStream.cs`, `Radio.cs`, `Panadapter.cs` and the VITA
packet definitions as wire-format references only. No manufacturer implementation
is copied, linked or redistributed. See [protocol source register](PROTOCOL_SOURCES.md).

## Passive receive-state refusal diagnostics

The coordinated hardware inventory found a normal control RX observation while
the separate IQ receive gate remained false. No acquisition followed that
discrepancy. `interlockEvidence` now exposes the latest IQ parser's state-field
shape (`none`, `single`, `multiple`), a single ASCII alphanumeric/underscore
token of at most 32 bytes when valid, and the existing acceptance result.
Missing/duplicate/unknown states retain their existing refusal behavior. This
diagnostic does not grant receive state, repair malformed evidence, add radio
commands or change the acquisition predicate.

The [manufacturer's interlock status specification](https://github.com/flexradio/smartsdr-api-docs/wiki/SmartSDR-Status-Responses#interlock--ptt-status)
describes the state as always present. A missing field will therefore not be
treated as an implicit receive confirmation. Eleven loopback IQ subscription
tests pass, including bounded diagnostics, missing/duplicate/lowercase/transitional
state refusal, lifecycle reset and the passive command allowlist. The developer
inspector rebuilt and passed its no-network parser self-test. This is source and
fixture evidence; the new diagnostic still awaits a coordinated hardware read.
