# Flex CWX literal append milestone — 5 November 2026

Scope: TLF CW-06/CW-18, extending the existing shared CW workbench, native CW
owner and direct Flex LAN adapter from canonical `main` at
`8f68222a` (installation records; preceding source baseline `faf8e0e8`). This is
source development only. Installed 1.5.15 remains the signed build of
`1873dc1d1c4d1aa95b44d07f7af0482417680f5f`; no new package, installation, version
bump or GitHub Release is part of this milestone. The verified 1.5.9 rollback
and all logs/settings/voice preservation are recorded in
[the 1.5.15 installation receipt](../cqrlog-implementation-2026-11-04/installation-1.5.15.json).

## Implemented boundary

Native macOS direct Flex LAN can append immutable literal deltas through the
same selected-radio arm lease and output guard. Each delta has a job UUID,
append ordinal, TCP generation and unique CWX block. The successful reply must
echo its block and allocate a new non-overlapping character-index range. Only
status carrying the current connection's own H handle and an index inside an
allocated range advances the displayed **Radio reported** prefix. Progress is
monotonic and is not RF delivery evidence. At most 128 pre-reply indices are held
until exact allocation; overflow fails closed. Limits are 128 literal characters
per append, 2,048 per job and 4,096 append ordinals. Job retirement is bounded;
after 128 retired IDs on a TCP connection, reconnect before another live job.

Stop retires the captured job ID before asynchronous release, including when
the first append has not reached the adapter. A late first command, reply or
tail cannot revive it. An unresolved allocation at Stop disables live typing
until reconnect. Release is pinned to the original TCP generation; an old Stop
cannot clear a replacement connection. Reconnect retires state and never
replays text. The shared UI preserves an editable old tail as staged text,
requiring explicit Send after Stop/rearm.

Unknown/zero progress handles, malformed or missing indexed block replies,
erasure, reused ranges and lost replies disable live typing with a reason. The
retained unindexed whole-message Send also disables live typing on that TCP
connection, so its late status cannot be credited to a later live job. Ordinary
whole-message Send remains available after Stop/review. Remote Agent Flex stays
whole-message only. No manufacturer-name inference enables advanced output.

WinKeyer, TCI and contest early-call/exact-lane behavior use their existing
routes. Flex buffered speed/prosign segments and contest streaming are outside
this first milestone. No automatic arming, output retry, Morse-duration timer or
new parallel CW queue was added.

## Protocol evidence

Primary sources refreshed 5 November 2026:

- [FlexRadio CWX API](https://github.com/flexradio/smartsdr-api-docs/wiki/TCPIP-CWX):
  literal SEND appends, DEL-encoded spaces, optional block echoed with the
  allocated starting index; clear and erase are separate operations.
- [SmartSDR TCP/IP API](https://github.com/flexradio/smartsdr-api-docs/wiki/SmartSDR-TCPIP-API):
  unique H connection handle, S triggering-client handle (zero is system/command
  line), and sequence-correlated R replies.
- [Flex staff CWX explanation](https://community.flexradio.com/discussion/6316639/cwx-tcp-ip-api-details):
  `sub cwx all`, indexed `cwx sent` and erase status.

The software contract deliberately requires all available attribution evidence.
Real firmware that reports only S0 progress cannot qualify live typing; it keeps
whole-message Send. An immediate WPM command does not establish a buffered speed
boundary.

## Software verification

The retained final results and exact source/CI references are added below after
the gates finish. Test strata remain distinct:

- `FlexCWXTests`: portable deterministic ownership/allocation fixtures, including
  `OM0` then `RX`, duplicate replies/status, foreign/out-of-range/old-generation
  progress, pre-reply ordering, early Stop, malformed allocation and injection.
- `FlexCWXTransportTests`: actual Network.framework FlexRadioClient TCP framing,
  command continuations and protocol fixture; exact once `OM0`/`RX`, held reply
  during Stop, Stop before first dispatch, reconnect without replay, generation
  pinned release and whole-message fallback for unattributable/missing-index
  cases. No hardware or packaged runtime is exercised.
- `LiveFlexSessionTests`: selected direct owner admission, append while its own
  output drains, refusal of another job and refusal to redirect stale release.
- Rust shared-owner/backend contracts: immutable deltas once, captured Stop job,
  exact job/count progress projection, capability withdrawal and staged fallback;
  existing WinKeyer/TCI/contest tests remain required.
- React/Vitest: accepted versus radio-reported prefix, disabled ambiguous live
  route, deliberate staged Send, and no old-tail drain after global Stop/rearm.

Pre-push checks: final focused Swift selection passed 70 tests (32 direct-owner,
8 portable CWX, 6 actual TCP CWX and 24 IQ regression cases). Focused Rust passed
52 CW session/backend tests after the Stop-ID and exact-generation corrections.
The earlier complete Rust run passed 1,117 native plus 31 integration contracts;
the final complete rerun also passed 1,117 + 31. Focused frontend
passed 31 tests and TypeScript/Vite/window-bundle checks passed.

The first broad Swift run failed the passive IQ command allowlist because it did
not yet admit the new read-only `sub cwx all`; the exact subscription was added,
without allowing output/resource commands. The final focused IQ rerun passed
all 24 cases. Optional CWX subscription is after CAT readiness, so an older
firmware's timeout cannot delay ordinary readiness. The complete corrected Swift
run is required below. The initial broad frontend run used the system Python
for a fixture selecting `XLOG_TEST_PYTHON`; that host case needs the supported
3.12 interpreter explicitly. Retain the failure and corrected result separately.
The broad Vitest result was 5,210 passed / 1 failed; the sole failed real-Host
stack case passed with `XLOG_TEST_PYTHON=/opt/homebrew/bin/python3.12` (no source
change). Required remote frontend CI runs with setup-python 3.12.4 and must pass
the complete suite; this split local result is not labelled a single green run.

## Qualification still open

Physical FLEX-8400 **NOT_RUN**. With a separately authorised controlled station
setup, retain firmware/model, exact connection/station/slice identity, actual H/S
handles and SEND index/block replies. Verify `OM0` then `RX` key exactly once,
actual radio-reported progression, Stop during queued and pending output,
foreign-client traffic and disconnect/reconnect without replay. Unknown/zero
handles must leave live typing disabled. Measure real stopped output separately
from command ACKs. No station command was sent by this development pass.

Buffered Flex speed changes, Flex typed prosigns and advanced contest early-call
or exact-lane qualification remain outside this milestone. Windows/Linux packaged
runtime acceptance, notarization and physical WinKeyer/TCI/station qualification
remain separately open. For SunSDR record its real advertised TRX count before
claiming native TCI CW. TCI PTT requires ExpertSDR3/TCI 2.1; native TCI CW requires
exactly one advertised TRX, a whole literal message of at most 128 characters,
and has no append or typed segments. WinKeyer preferences retain their documented
finite subset. Normal native voice remains macOS-only; external WAV libraries
need their own folder backup.
