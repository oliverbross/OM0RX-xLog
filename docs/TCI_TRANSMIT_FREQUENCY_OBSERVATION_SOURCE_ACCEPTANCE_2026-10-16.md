# TCI global transmit-frequency observation source acceptance — 2026-10-16

Commit `b6bf7c1` corrects the prior assumption that the pinned TCI protocol has no
transmit-frequency report. This is a passive protocol/session slice only.

Normative source: [ExpertSDR3 TCI protocol at b081213ff97150fd29f669c633f060f93c81a286](https://github.com/ExpertSDR3/TCI/blob/b081213ff97150fd29f669c633f060f93c81a286/TCI%20Protocol.pdf),
page 37, section 4.4.

- `TX_FREQUENCY:arg1;` is sent only by the TCI server.
- `arg1` is the current transmission frequency in hertz.
- The command has no TRX, channel, VFO, source or server-time argument and no query form.
- The pinned document describes TCI 2.0 but does not state when this notification first appeared.

The reducer accepts exactly one bounded integer argument and retains one server-global
observation plus its optional local producer receipt time. Malformed or indexed forms are
rejected without destroying earlier evidence; repeated accepted reports refresh only that
observation; connection reset clears it. Receive `VFO_LIMITS` do not constrain this global
notification.

The read-only WebSocket session supplies its existing receipt clock and publishes the
observation separately. It is not associated with the selected TRX/channel, does not refresh
configured evidence, does not enter the authoritative receive snapshot, does not identify a
TX VFO and grants no control or transmit authority. No UI or wire command was added.

Focused verification: **35/35** Swift tests passed across `TCIProtocolTests` and
`TCIWebSocketSessionTests`; `git diff --check` passed. Tests cover fragmented decoding,
malformed/indexed forms, repeat and reset behavior, receipt isolation, bounds independence
and zero outbound messages.

The same audit confirmed that `SPOT`, `SPOT_DELETE` and `SPOT_CLEAR` are client-only
commands in the pinned protocol. Click notifications do not constitute retained spot
inventory. Native TCI spot inventory therefore remains unavailable instead of being inferred.

Acceptance is source/fixture based only. No package, live server, radio, RF or operator data
was exercised; installed alpha.31 is unchanged.
