# Flex companion IQ acquisition

31 October transport follow-up: the operator confirms SmartSDR/Windows DAX on
192.168.0.117; Windows DAX is now stopped while panadapter 40000000 remains on
DAX IQ 1. One post-ready acquisition still fails manufacturer discovery before
stream creation. A separate successfully bound raw UDP 4992 socket receives
zero datagrams in 5.0426 seconds. No IQ is collected and no station-side stream
cleanup success is claimed.

The explicitly authorized Safari admin session identifies TP-Link EC120-F5 v1,
firmware 3.16.0 / Build 200311 Rel.38251n. Its inspected OpenVPN page exposes
UDP/TCP, port, subnet and client-access controls, with no bridge/discovery-relay
control. No Save, certificate generation, export, reboot or network change is
performed. Both router connections and the running OpenVPN Connect 3.8.1 client
verify the current Mac tunnel address as **10.8.0.10**, port/protocol 1194/UDP;
10.8.0.6 is historical. The saved client profile specifies `dev tun`.
Unicast ping/TCP readiness cannot establish discovery or native IQ UDP delivery.
An actual source-preserving LAN-side discovery path is still required; no peer
or discovery gate is weakened. [OpenVPN's macOS FAQ](https://openvpn.net/connect-docs/macos-faq/)
documents that Connect does not support Layer 2/TAP bridging.

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
fixture evidence at that stage; the coordinated hardware reads follow below.

A coordinated read subsequently confirmed `stateFields=none`, alongside the
normal owner's receive observation. The next diagnostic extension distinguishes
per-band configuration from the ordinary interlock message and captures at most
16 unique field names, each at most 32 ASCII alphanumeric/underscore bytes,
without values. Reviewing the pinned official FlexLib `Radio.cs` confirmed its
separate band-configuration dispatch; no manufacturer code was copied. The
receive predicate remained unchanged while the actual message kind was being
identified. The test also verifies bounded names and exclusion of values.

## Separate validated settings from RF-state messages

The next coordinated read observed a global transmitter-settings packet with
relay-enable/delay, timeout and `tune_tx_suppress` fields, without `state`. The
manufacturer reference processes configuration keys separately from its RF-state
property. Previously the IQ parser treated every such settings notification as
an incomplete state report and erased the earlier valid READY/RECEIVE evidence.
The normal control owner retained it, explaining the observed discrepancy.

The IQ parser now recognizes only the fifteen bounded configuration fields
observed/referenced for this form. Flag values must be 0/1/T/F; delay/timeout
values must be canonical nonnegative decimal integers within signed 32-bit range.
Unknown keys, duplicates, malformed values and an empty message are refused.
A validated settings-only message retains the preceding receive predicate,
including false/unknown/TX; it cannot establish receive evidence. Diagnostics
label this form `interlock_settings` with `stateRetained=true`.

Explicit state reports keep the original strict single-field READY/RECEIVE rule.
Missing state in other forms, duplicate state, unfamiliar/transitional/TX values
and malformed settings remain blocking. Transport reset clears prior proof.
No RF control, discovery, handoff, stream request or qualification override was
introduced. Per-band messages are not newly admitted by this correction.

The loopback radio now emits a synthetic-valued settings packet with the actual
observed field names after READY. The real TCP/UDP lifecycle test first failed
with `unavailable` before the correction; all **12 subscription tests** then
passed. Coverage includes settings retention without creation of RX, rejected
states followed by settings, malformed/duplicate/unknown settings, reset,
TX/quarantine, competing consumers and passive command scope. Inspector build
and the no-network parser self-test passed. Hardware validation remained pending
at that historical milestone.

## Current per-band correction — 30 October 2026

The live 8400 at the operator-selected endpoint 192.168.0.199 exposed the next
distinct configuration form: `interlock band <id> ...`. A bounded 32-entry
diagnostic history established a real READY report followed by per-band settings
that erased IQ receive evidence. The pinned official FlexLib 4.3.16 archive was
rehashed (same SHA-256 recorded above); its Radio dispatch explicitly separates
this form into TxBandSettings. No manufacturer implementation was copied.

The independent parser now preserves preceding state only for a canonical
0–255 band ID and a bounded set of unique, typed configuration fields. Boolean
flags accept 0/1/T/F, power settings 0–100 and band names bounded ASCII. Unknown,
duplicate, malformed or empty fields still invalidate receive evidence. A state
field inside a band-configuration message cannot manufacture READY. A valid
configuration message after TX/unknown/reset cannot establish RX.

The focused regression first failed three assertions (lost RX, absent retention,
and forged band-state admission). All 14 subscription cases pass after repair,
including bounded/redacted diagnostic history and transport reset. A fresh
12-second hardware read then observed Station OM0RX-WIN10, handle 624524688,
panadapter 40000000, DAX IQ 1, ANT1, centre 24.915 MHz, pre +16 dB, WIDE/loopa/loopb
0 and known-off IQ transmit state. This validates the settings correction on
actual messages. It does not yet prove discovery identity, native sample arrival,
RF orientation, usable width or one/two-span acceptance. No stream was created
by those passive inspections; each closed only its own transport.
