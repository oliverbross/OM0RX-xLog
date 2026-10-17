# ARRL RTTY Roundup station-resolved serial preview

Status: inactive rule and durable-core preview. It is not in the rule catalog and has no worker, UI, or export activation. Passing these fixtures does not establish category, contest-date, operating-time, power, assistance, mobile-location, packaged-app, or sponsor-submission acceptance.

## Frozen authority

The preview identity is `arrl-rtty-roundup`, version `1.0.0-3.0b-preview`, edition `rules-3.0b-preview`. Its `sourceRevision` is the SHA-256 digest of the primary [ARRL RTTY Roundup Rules v3.0b](https://contests.arrl.org/ContestRules/RTTY-RU-Rules.pdf), retrieved 18 October 2026: `87c9f0032e6ce502b4ae94d47b397a9a34c49a3eafdb5a50fc226694696fe1ce`.

Multiplier authority is separately pinned to the ARRL [Canadian list](https://contests.arrl.org/contestmultipliers.php?a=ve), [United States list](https://contests.arrl.org/contestmultipliers.php?a=usa), and [January 2026 DXCC list](https://www.arrl.org/files/file/DXCC/DXCC_Current.pdf). Exact URLs, retrieval-local cache paths, and SHA-256 digests are recorded in `Tests/XContestCoreTests/SourceFixtures/arrl-rtty-roundup-authority.json`. The PDF is cached at `/tmp/arrl-dxcc-current-2026.pdf`; its independently extracted text is cached at `/tmp/arrl-dxcc-current-2026.txt` with SHA-256 `9f5e3635790438ab77fcc6621a8dbd6c836d38c62683aad279471ba1e3015387`. The reproducible fixture extractor reads the pinned PDF, anchors one three-digit entity code at each table-row end, and requires exactly 340 rows, 340 unique codes, and no duplicates. Tests compare that independently recorded set exactly with the production authority set. The read-only comparison source is Oliver Bross's `contest-sw` fork at `7c8b499225a73f7f8f792246881bd7aefc05452f`, file `not1mm/plugins/arrl_rtty_ru.py`, derived from Not1MM by Michael Bridak under GPL-3.0-or-later. Comparator behavior is evidence, not sponsor authority.

## Station-resolved exchange

`ContestStationResolvedSerialDescriptor` is an optional version-two entry descriptor. Absence maps exactly to the established static `ContestSerialDescriptor`; version-one descriptors reject the new key even when it is JSON `null`. The only admitted policy in this slice is `arrlRTTYRoundupWVEOrDX`. Rule metadata declares one optional `location` subdivision field, one optional `serial` numeric field, and session serial scope. Metadata coherence rejects duplicate or ambiguous fields, static/conditional contradictions, unsupported scope sets, and unknown policies.

The throwing `ContestRule.resolvedSerialRequirement(in:)` resolves only after the immutable rule identity, descriptor, and frozen station snapshot agree:

- ADIF 291 United States and ADIF 1 Canada require an immutable two-letter station subdivision and forbid a serial field or reservation.
- Every other resolved DXCC entity forbids a station subdivision or preseeded serial and requires a durable session-scoped serial. The session scope value is the empty string.

Drafts may keep an incomplete received exchange while editing. A W/VE draft must retain the station subdivision and cannot reserve a serial. A DX reservation atomically allocates `001`, binds it into the typed raw and normalized serial field and both sent aggregates, and survives restart. Commit verifies all four text projections against the durable reservation. A failed, forged, foreign, or exhausted reservation attempt changes no session revision, draft, counter, reservation, QSO, or receipt. Successful commit consumes the reservation and reset clears the allocated serial while preserving nonserial station fields. Existing correction paths continue to retain immutable sent fields.

No SQLite schema change is required: station policy belongs to immutable rule metadata; sessions, drafts, reservations, QSOs, operations, and canonical request bytes keep their existing shapes. Existing contest identities and version-one encodings remain unchanged.

## Inactive scoring preview

The rule admits RTTY/`RY` on 80, 40, 20, 15, and 10 metres. Both the entrant and every worked station must resolve to one of the 340 current entity codes in the pinned January 2026 DXCC authority; fabricated, deleted, and non-DXCC numeric IDs fail closed before scoring or durable mutation. Each accepted QSO is one point; duplicates are canonical call plus band; multipliers count once for the whole contest. Continental US states plus DC and the published Canadian provinces/territories, including separate `LB` and `NF`, use received subdivision tokens. Alaska, Hawaii, CY0, CY9, and all other non-US/non-Canada entities use their frozen DXCC entity identity. Six contacts with CA, QC, LB, KL7, KH6, and France therefore score `6 × 6 = 36`; a seventh CA contact on another band scores `7 × 6 = 42`.

Suffix normalization is deliberately bounded: `W1AW` and `W1AW/7` share a duplicate identity, while `K7/W1AW` remains distinct. Self contacts reject after this normalization. `/MM` and `/AM` contacts and entrants fail closed because the current immutable snapshot cannot prove their physical endpoint; the rules allow contact credit only for mobile endpoints outside the US and Canada. This boundary is explicit rather than inferred from a home prefix.

The rule remains outside `ContestRuleRegistry.pilots`. Export column/category semantics and full mobile support require later reviewed slices.
