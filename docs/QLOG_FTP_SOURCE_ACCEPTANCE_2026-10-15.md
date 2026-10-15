# QLog comment filter and FTP correction source-package acceptance — 15 October 2026

## Outcome

Exact source `0da511d68ff06169d537b16d5d72f07e7b9c659f` packages the
QLog-inspired literal DX-alert comment condition from `6d238e6` together with
the FTP oversized-download result correction and disposable-server coverage
from `e325a3f`. This is an uninstalled macOS source-package checkpoint. It is
not installed-app, live-cluster, notification/sound, real-server, radio or RF
acceptance.

## Package evidence

- Bundle: `prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app`.
- Embedded distribution metadata reports exact source
  `0da511d68ff06169d537b16d5d72f07e7b9c659f` and 290 resolved components.
- Strict deep signature verification passes.
- Host binary is arm64, SHA-256
  `97c054ec5ef0f1624f2d8a729d4a818849ac3be046b6811006c26eb5dfd6304e`.
- Swift worker is universal x86_64/arm64, SHA-256
  `6f5a54c2e6bf0dc63b342eb3ec742136239da98c7c60ecf997dc84a28836e7f3`.
- Isolated report `prototype/dist/qlog-ftp-0da511d-native-acceptance.json`
  passes **33/33** with `status: passed`, `scope: integrated-local-ui`,
  `embeddedUi: true`, `worker: true` and `station_io: false`.
- The report SHA-256 is
  `c2cd5c586e049d38c8f1b02926d3662f7bcb09adec42981ee6f4c0b1e614397b`.
- The candidate exited. The installed alpha application was not stopped,
  replaced or modified, and the intentionally offline Windows Remote Agent was
  not contacted or started.

## Source gates carried into this checkpoint

- DX-alert comment condition: focused Rust **12/12**, renderer **13/13** and
  production build pass. The condition is bounded, literal, control-free,
  case-insensitive and AND-combined with existing filters; it creates no
  poller, network source or station action.
- FTP correction: the warning-clean native suite passes **232 tests across 31
  suites**. Disposable loopback acceptance passes **7 tests / 8 invocations**,
  including advertised and streamed oversize, post-verification growth and the
  unchanged production control-handshake timeout.

## Remaining gates

- Operator and live-cluster observation of the comment filter plus actual
  default-off macOS popup/sound behavior.
- Trusted-certificate implicit FTPS without changing the operator trust store,
  then installed-app acceptance after explicit approval. Later harness sources
  `1080e6e` and `0dfefc5` close stalled/slow download and upload production-limit
  injection with synthetic loopback evidence.
- Windows and Linux packaging remains deferred until macOS operator acceptance.
- Physical station, transmit, amplifier, tuner, rotor and RF acceptance remains
  separately authorized work.
