# OM0RX-xLog macOS 1.2.2 release acceptance — 2026-10-17

## Outcome

Version 1.2.2 is installed in `/Applications/OM0RX-xLog.app` and restores the saved Radio 1 Remote Agent connection. A live cluster spot activation changed the observed receive frequency and mode from 14.343000 MHz USB to 7.095000 MHz LSB.

No transmit, CW, QSO logging, amplifier transition, or manual rotor command was exercised during acceptance.

## Regression and repair

- 1.2.0 could append an automatic reconnect receipt after the journal had migrated to schema v2 but before that reconnect descriptor carried `radio_id`.
- 1.2.1 correctly required exact slot identity and therefore rejected that transitional receipt during startup.
- 1.2.2 migrates only an absent `radio_id` in a slot-owned v2 journal. Explicit null, malformed, and cross-slot identities remain rejected without overwriting the journal.
- The installed journal was repaired in place. Its latest reconnect is acknowledged for `radio1`, and no non-rotor receipt remains without a slot identity.

## Verification

- Station-session regression tests: 38 passed.
- Full Rust suites: 600 unit tests and 25 Hamlib integration tests passed.
- Spot-barrier and rotor frontend suites: 61 tests passed when run serially.
- TypeScript compile and production Vite bundle: passed.
- macOS packaging checks: 3 passed.
- Worker self-test: passed with file, network, and station I/O disabled.
- Packaged and installed bundle: strict deep code-sign verification passed.
- Installed version: 1.2.2.
- Live startup: Connected at 14.343000 MHz USB, one cluster connected, 68,184 contacts loaded.
- Live spot activation: selected ON4JOTA at 7.095000 MHz; the connected header changed to 7.095000 MHz LSB and the QSO editor changed to ON4JOTA / 7.095000 MHz.

## Installed hashes

- `xlog-prototype`: `0985854680f691a03a5bf625ea3583338d6d2efa851c05763af31765050061f2`
- `xlog-prototype-worker`: `e59e731a74927debe9c8b087a77013e8e953ae83cafdf87bd19203f6672bec5b`
- `rigctld`: `523195f518ad650aea3670fc0301cd5e7e4628d8f82f692b8d9500aed5cb3d9e`
- `rotctld`: `fa1d56e91f490edc59d01fa88c8161c8b7542e0b7c65722f0b01cd6aa1fca6e0`

## Source and rollback

- Repair commit: `b805e51fabf438447ec44aaaa60e63114d6ce2ae`
- Version commit: `537557a927c59b3a8e1378ea24d3a7ac59b5f524`
- Rollback bundle: `/Users/oliver/Documents/Projects/OM0RX-xLog/dist/installation-backups/1.2.1-before-1.2.2-20261017-211128/OM0RX-xLog.app`
- Notarization was not performed or claimed.
