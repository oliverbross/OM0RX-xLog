# Structured exchange foundation

This slice adds storage and evaluation primitives for future contest rules. It does not register JIDX, NAQP, RTTY, or VHF contests and does not claim current sponsor approval.

## Compatibility boundary

All published rules remain version 1 entry descriptors. Their identities, rule results, stored session/QSO shapes, and canonical operation payloads are unchanged: empty `sentExchangeFields`, `sentFields`, and `receivedFields` decode as empty dictionaries and are omitted when encoded. Version 1 evaluation rejects nonempty structured fields with `structuredExchangeRequiresV2`, so a caller cannot attach unvalidated version 2 data to an existing contest.

A version 2 `ContestEntryDescriptor` explicitly declares:

- one or more `ContestModeProfile` values, including internal mode, ADIF mode/submode, Cabrillo QSO type, and report grammar;
- named sent and received fields with semantic kinds, UTF-8 byte bounds, requirement flags, and ADIF targets;
- `pointsOnly` or checked `pointsTimesMultipliers` final scoring;
- serial reservation requirements using the existing durable serial contract.

Version 2 coherence requires structured sent/received exchange formats, station-field defaults, unique field IDs, exact primary-field mirrors, and an exact match between declared profiles and supported modes. It supports optional per-field ADIF mappings. Profiles are capped at eight and each direction at sixteen fields. Mode tokens are bounded uppercase tokens without controls. Report bounds are fixed by grammar: zero bytes for no report, two for phone RS, and three for CW or digital RST. Unknown field diagnostics use sorted keys. Malformed metadata fails before evaluating even an empty log.

The existing `exchangeStrings` capability remains the aggregate ADIF capability marker; individual version 2 fields carry their exact ADIF targets. Draft persistence permits missing or semantically incomplete values while rejecting unknown and oversized fields. Its immutable projection runs the same descriptor-plus-rule validation used by scoring, reports missing or invalid fields, and leaves duplicate state indeterminate until valid. Commit and rescore require all fields, semantic values, an exact declared mode, and that mode profile's report grammar.

When a v2 rule requires a serial, exactly one required sent field must accept only `serialNumber`. It is excluded from station defaults. Reservation binds its raw and normalized value together with the legacy scalar exchange; commit atomically verifies all three against the durable reservation. Reset removes the allocation while preserving nonserial station fields. Forged or ambiguous serial fields fail without advancing the session, consuming the reservation, or writing a receipt.

The SQLite schema is unchanged. Sessions, drafts, QSOs, audit records, and idempotent operation results already persist Codable snapshots as blobs. Corrections may change received structured fields; sent structured fields remain immutable. Commit clears received fields and restores the pinned nonserial station fields. Reopen, correction, deletion, serial nonreuse, and original-result replay therefore retain the same transaction and revision rules as scalar exchanges.

`ContestBandPlan` centralizes deterministic frequency-to-band mapping for the existing HF bands and the VHF/UHF ranges directly needed by the audited source family. It is a contest normalization table, not a regional transmit-authority table.

## Why these primitives exist

The comparison source is the read-only tree at `7c8b499225a73f7f8f792246881bd7aefc05452f`:

- `not1mm/plugins/naqp_rtty.py:20,121-123,143,162,178,191` stores a name and location separately and multiplies contact points by location multipliers. That requires typed multi-field exchanges and the checked product case; NAQP is not a points-only contest.
- `not1mm/plugins/stew_perry_topband.py:152-155` returns the contact-points total directly. That is a source example for the explicit `pointsOnly` case; this foundation does not activate a Stew Perry rule.
- `not1mm/plugins/arrl_rtty_ru.py:13,137-138,158,167,206,217` has mode-specific RTTY entry plus a subdivision/country exchange and multiplier scoring. That requires a digital mode profile and the checked product case.
- `not1mm/plugins/jidx_cw.py:18,124-125,154,172,188,202` distinguishes a JARL prefecture exchange from the serial-like scalar used by the source UI. The `jarlPrefectureNumber` semantic kind prevents treating every numeric exchange as a serial reservation.
- `not1mm/plugins/arrl_vhf_jan.py:18,135-136,156,179,205,216` and `not1mm/plugins/cq_ww_vhf.py:13,126,174-175,215,227,256,264` require four-character Maidenhead fields, report-free mode profiles, and portable VHF/UHF band normalization.

The score policy intentionally has only two cases. It covers the cited points-only and points-times-multipliers formulas without introducing a generic scoring language. Contest-specific points, duplicate keys, multiplier candidates, geography, and eligibility remain in concrete rule implementations.

## Deliberate limits

No new contest identity is active. ADIF writers and transport adapters do not yet project mapped fields. Country-dependent exchange alternatives, richer grid lengths, mode-family aliases, time windows, category restrictions, and sponsor submission readiness remain rule-specific work for the first real family that needs them. The serial contract in this slice is deliberately unconditional: a rule that declares `requiredForCommit` has one allocated sent serial field for every committed QSO. It does not model future own-station-dependent exchanges such as the 2026 ARRL RTTY Roundup split between W/VE subdivision exchange and DX serial exchange; that family needs an explicit resolved-entry/session contract before activation.
