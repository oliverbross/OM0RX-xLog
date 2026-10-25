# Protocol source register

Rechecked 26 October 2026 during CW implementation. These are protocol references,
not redistributed manufacturer implementations or hardware acceptance evidence.

| Source | Exact identity | Relevant facts |
| --- | --- | --- |
| ExpertSDR3/TCI | HEAD `6cbccdd7004858152b4b5b463f9b087432d81a21`; `TCI Protocol 2.1.pdf`, SHA-256 `e60833985619ca6a1c7b5c4c48bdbff59e694924589c238d06557e011e18c074` | Modern 64-byte IQ header; scalar count / channels; DDS; per-client IQ rate; RX1/RX2 starts |
| Official FlexLib | 4.3.16.42034; ZIP SHA-256 `60978db51dac6ea781899dd80832ad4e7876ce96ed72532b57106376fc26463f` | Big-endian VITA metadata; little-endian wide floats scaled 1/32768; 24/48/96/192 ksample/s classes |

TCI 2.1 was published after the handoff's inspected 2.0 repository. Its header
adds `count` at byte 32 and reduces reserved words from eight to seven while
retaining 64-byte layout. The text explains counter semantics for RX audio and
TX_CHRONO; it does **not** establish verified IQ sample continuity. The IQ parser
retains this field as telemetry only when the negotiated version is 2.1. It must
not reject legitimate 2.1 IQ solely because byte 32 is nonzero, and must not use
that field as an unproven IQ sequence guarantee. Remaining reserved words are
strictly zero in the supported contract. Unknown future versions need explicit
qualification.

IQ_SAMPLERATE 2.1 permits reading and reports the current rate on an unsupported
request. Actual binary headers still determine delivered rate. Each connection
has one rate shared by its selected IQ receivers. DDS is a separate centre from
VFO A/B; VFO changes alone must not relabel the whole span. IF_LIMITS bounds the
available panorama; output resampling never creates extra RF coverage.

Links: [TCI source](https://github.com/ExpertSDR3/TCI/tree/6cbccdd7004858152b4b5b463f9b087432d81a21),
[Flex official distribution](https://www.flexradio.com/software/smartsdr-v4-x-api-flexlib/),
[Flex stream API](https://github.com/flexradio/smartsdr-api-docs/wiki/TCPIP-stream).
Manufacturer source was inspected as a wire-format reference; no FlexLib code,
binaries or assets are incorporated into xLog.
