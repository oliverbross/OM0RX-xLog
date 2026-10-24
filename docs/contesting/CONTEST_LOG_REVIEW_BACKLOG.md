# Backlog: Contest Log Review

Status: **planned only; not part of 1.3.12**.
Requested by the operator on 25 October 2026 after discussing post-contest
comparison against received Cluster reports. No implementation is authorized
by this backlog entry alone; scheduling and detailed design remain follow-up work.

## First version

Add **Contest → Log Review**, running only on demand against a consistent
read-only snapshot of the selected contest and the existing separate spot-history
database. Do not add scans or network lookups to the live entry/DUPE/save path.

- Compare normalized call, UTC time, band, mode and RX/TX frequency with nearby
  received reports. Make time/frequency tolerances visible and configurable.
- Offer **Possible typo**, **Frequency/time mismatch** and **Reviewed** filters.
- Present the original QSO alongside raw supporting reports, report/arrival
  times, spotter identity, comments and an explanation of the match.
- Keep, dismiss or open the existing contact editor. No automatic contact edits.
  Corrections must retain original values and use existing recalculation/audit
  services. Review state should invalidate or be marked stale after relevant edits.
- Export an optional review report without changing the log.

## Evidence rules

- Spots are supporting evidence, not proof: spotted calls can be incorrect,
  stations move, and unspotted contacts are valid. No match means insufficient
  evidence, not an invalid QSO.
- Distinguish independent spotters from repeated or redistributed reports;
  repeated copies must not inflate confidence.
- Exclude locally generated **Heard while tuning** / logged-contact overlays
  from independent corroboration, preventing a typo from validating itself.
- Preserve portable suffix distinctions and avoid silently equating different
  on-air calls. Flag uncertainty for operator review.
- Retain raw received data and provenance; use a derived index for comparisons.
  Review existing spot-history retention before promising complete-contest coverage.

## Acceptance outline for the future task

Use disposable fixtures for exact matches, near-call typos, multiple stations on
one frequency, station QSY, midnight boundaries, clock drift, mode/band mismatch,
portable calls, duplicated reports, bad spot calls and missing reports. Verify
that review does not modify QSOs, duplicate confirmations do not inflate confidence,
and explicit corrections recalculate scores through existing services. Measure
review workload separately from live logging; cancellation must leave no partial
QSO changes. This is a post-contest assistance tool, not contest adjudication.
