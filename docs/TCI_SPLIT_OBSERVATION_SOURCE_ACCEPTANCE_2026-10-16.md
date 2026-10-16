# TCI split observation source acceptance — 2026-10-16

Bounded continuation after `f1c9292`: passive split and TX-VFO observation in the
main and detached Station Control surfaces.

Normative source: [ExpertSDR3 TCI protocol at b081213ff97150fd29f669c633f060f93c81a286](https://github.com/ExpertSDR3/TCI/blob/b081213ff97150fd29f669c633f060f93c81a286/TCI%20Protocol.pdf).
The pinned PDF was downloaded and its text inspected with Apple PDFKit.

- Page 18 defines `SPLIT_ENABLE:trx,bool;` as a TRX-wide split report; its read form
  has only the TRX argument. The existing reducer already validates that report.
- Page 15 defines `VFO:trx,channel,hz;` as receiver/channel tuning. Page 19 identifies
  A/B as receive channels. These are not authoritative TX-VFO or transmit-frequency
  reports. No `TX_VFO` command exists in this pinned specification.
- Accordingly, TX VFO and transmit frequency stay unavailable. Neither the saved
  receive channel nor split status is used to infer them.

The native session now carries a separate producer receipt timestamp for accepted
configured-TRX split reports. Repeated valid reports refresh it; unrelated TRX,
invalid reports, polling, RX/global traffic, and delivery time do not. Existing
connection/generation fences apply, and protocol reset clears the receipt.
The UI requires both existing observation/selection freshness and the split's own
receipt within the existing five-second window. Old or untimed values are labeled
retained/stale or unverified, and absent reports are unknown. Both surfaces share
the passive split renderer; the detached surface retains its selection fences.

Focused reducer, fixture-session/projection, and frontend tests cover valid,
malformed, foreign-TRX, selected-channel-B, repeated, stale, unknown, reconnect-reset,
and detached-selection behavior. Session fixtures assert observation sends no wire
commands. Existing receive-control authority is unchanged; this stage adds no
setter, PTT, carrier Tune, transmit, reconnect, retry, or replay operation.

Verification: 43 focused Swift tests passed with `XLOG_PORTABLE_ONLY=1 swift test
--scratch-path /tmp/xlog-tci-split-build --filter
'TCIProtocolTests|TCIWebSocketSessionTests|LiveTCISessionTests'`; 41 frontend tests
passed across `TCIObservation.test.tsx` and `DetachedStationControlSurface.test.tsx`;
`npx tsc --noEmit` and `git diff --check` passed.

Acceptance is source and fixture based only. No packaged/installed application,
live network/device/RF, or physical split/TX behavior was exercised.
