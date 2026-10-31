# HM Control and operating repairs — 1.3.69

## Scope and preceding qualification

Complete the requested HM Control integration and save/logbook, rapid band/QSY,
rotor and Maestro repairs. The preceding 1.3.68 review records all carried
changes and upstream provenance, private timing and native-window acceptance.
This candidate advances the installed version to repair the remaining live
Maestro delivery failure.

- Window → HM Control shares the station, selected radio/PTT, filtered cluster
  and entire local log; Billy NZ3C's original MIT source and attribution remain.
- Saves defer unused draft work and avoid repeating station/settings setup after
  each QSO. HM updates known changed contacts/cells incrementally and rebuilds
  for unknown/external/resolver changes. A signed private 69,556-contact run
  measured save → logbook page → HM at 112–381 ms across five samples.
- Rapid QSY coalesces toward the newest destination; superseded rotor targets
  lose their permits and receive correlated Stop before the next selection.
  An unknown Stop retains its explicit retry fence. Transport ACK does not prove
  physical cessation. Earlier operating-Scotland and foreground fixes remain.

## Live Maestro finding and repair

The installed 1.3.68 radio spot ledger had 256 pending attempts, no accepted
receipts, and only 51 distinct callsign/frequency pairs. Of those, 189 belonged
to contesting and 67 to normal logging. Every record lacked a confirmed radio
ID and any timestamp. The active admission count was full permanently; existing
cleanup could not safely choose a radio. No guessed remove or expiry was used.

Implementation source: 4229097b.

- Atomic startup recovery moves inactive/legacy intents into durable quarantine,
  preserving each legacy key and payload byte for byte. They remain visible to
  recovery/audit and are never reported as removed, acknowledged or expired.
- Only executing delivery/cleanup leases consume the bounded active capacity.
  Publisher file locks, SQLite identity leases and transactional state checks
  coordinate peer workers, crashes, replacement and late acknowledgement.
- Fresh UUIDs identify each wire attempt. Settled new uncertainties coalesce by
  owner/spot identity with attempt time, lifetime and observation count. A later
  successful retry cannot erase an earlier uncertain outcome.
- Cleanup holds a physical-identity lease and rechecks the exact retained entry
  and fresh receipts before an RPC. TCI's callsign-only removal identity is
  respected. Current peer publication and newer accepted markers remain fenced.
- Direct Agent and TCI have separately proven prewire rejection classifications.
  Only those rejections allow trying another radio or retiring that exact new
  intent. The first uncertain outcome stops fallback; prior radio preference
  never grants cleanup authority to a new unacknowledged attempt.

## Verification before packaging

Final v2: 61 tests passed — 39 existing spot bridge, 8 recovery and 14 Swift
Testing admission/selected forwarding cases. Includes the actual cross-process
file-lock boundary, atomic migration/fault rollback/reopen with 256 exact legacy
records, active capacity, unknown coalescing, no-send rejection, owner separation,
peer cleanup/publication and fresh-receipt races, and prior-ACK/unknown-retry
authority. Read-only cross-review found no remaining actionable defect.

No agent sent a real radio command or modified the production ledger during
implementation/testing. A review-only operational SQL plan was retained but not
applied. Installing this source must precede production migration so quarantine
remains part of the application's uncertainty model after restart.

## Release and final acceptance

Version 1.3.69. Package only from the clean canonical main checkout, with reduced
scheduling priority and one Cargo job. DistributionMetadata captures the exact
versioned source commit. Final checks must verify the signed source/hash match,
Apple acceptance/ticket, native workflows, complete contact IDs, absence of
private test markers, all 256 legacy key/payload pairs preserved, and fresh
normal-owner radio acknowledgements after this worker starts.

The final backup includes the complete Integration Services directory and spot
ledger as well as the log workspace, native state, WebKit and preferences. Keep
the paired prior app/data and all post-repair evidence for any supported rollback;
restoring an older app alone must not hide quarantined uncertainty. Exact source,
backup, rollback and live acceptance results follow after verification.
