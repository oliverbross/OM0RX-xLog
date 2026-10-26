# Passive Flex inventory instrument

Developer-only Mac executable, excluded from application staging. It uses the
existing Flex client and IQ inventory owner. Its explicit `--inspect` mode reads
Station binding, panadapter/channel/antenna and receive-state metadata for 2–30
seconds, then closes only its own transport with `stopTransportOnly()`.

It never grants a DAX handoff, creates an IQ stream, creates a panadapter, tunes,
sends/releases PTT or CW, changes power, operates a rotor or accesses xLog data.
It accepts numeric private/loopback IPv4 only; port is fixed at 4992. It does not
load radio credentials or modify installed configuration. Connection retries and
metadata reads stop with the bounded inspection. Its JSON is historical evidence
collected before transport closure, not an active connection or IQ acceptance.
Version 2 also reports the existing control owner's optional transmit observation
with its own read timestamp and lossless revision. It is read after the IQ
capabilities, so the two observations are not atomic. An omitted observation is
unknown, not receive confirmation. This diagnostic does not weaken acquisition
checks or issue additional commands. `readAt` is the inspector's read time,
not the timestamp of the radio's interlock status or proof of its age.
IQ capabilities can also include `interlockEvidence`: whether the latest IQ
parser saw no state field, one field or multiple fields, a single bounded ASCII
state token when valid, and that parser's existing receive acceptance result.
This is refusal attribution, not an additional receive-state authority.

Offline preparation:

```sh
XLOG_PORTABLE_ONLY=1 swift build --jobs 2 --product xlog-cw-flex-inspect
XLOG_PORTABLE_ONLY=1 swift run --skip-build xlog-cw-flex-inspect --self-test
XLOG_PORTABLE_ONLY=1 swift test --jobs 2 \
  --filter testPassiveInventoryAndTransportCloseNeverAcquireOrReleaseRadioOutput
```

The parser self-test opens no network. The loopback fixture checks the actual
client command set, including transport-only shutdown: metadata subscriptions,
slice listing, ping/keepalive and observed Station binding only. It rejects any
IQ acquisition/UDP destination or RF-release command. Its fixture identity is
synthetic and does not establish discovery through a real VPN.

Only after coordinating with the installed-app acceptance owner and receiving
the human's VPN-ready indication:

```sh
XLOG_PORTABLE_ONLY=1 swift run --skip-build xlog-cw-flex-inspect \
  --inspect --host 192.168.0.199 --station OM0RX-WIN10 --seconds 12
```

The human corrected the Station name to **OM0RX-WIN10**, and its owned DAX IQ 1
inventory was observed in the second passive run. See the historical receipt in
`docs/cw/FLEX_PASSIVE_INSPECTION_2026-10-26.md`. Its transmit-known-off flag was
false, and no physical discovery identity was established. The human confirmed
channel 1 was released, but the later mode-recovery live hold must settle before
further network actions. Keep future inspections coordinated with the live owner.
Avoid live inspection or a VPN change during installed two-direction operating
module acceptance. The existing Remote Station Agent/Tailscale route is separate
and must be assessed independently, without changing it for this instrument.

This first-stage instrument cannot qualify sample arrival, physical discovery,
RF orientation, usable bandwidth, decoding quality, capacity or soak time. Real
IQ acquisition still requires observed resource identity and an explicit current
handoff after other consumers release the exact channel.
