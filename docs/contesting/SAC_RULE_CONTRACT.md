# SAC CW and SSB 2026 rule contract

Status: practice and scoring preview checked against the published SAC 2026 rules and pinned source behavior. It is not sponsor certification, live-contest acceptance, packaged-app acceptance, cross-platform runtime acceptance, or a submission-ready logger/exporter.

## Versioned identities and authority

The bounded registry adds `sac-cw` and `sac-ssb`, each at version `1.0.0-2026-rules-preview`, edition `2026-rules-preview`, and source revision `7c8b499225a73f7f8f792246881bd7aefc05452f`. Operational scoring behavior follows the primary [SAC 2026 rules](https://www.sactest.net/blog/scandinavian-activity-contest-2026-rules/) retrieved and verified on 18 October 2026. The source revision is only the pinned comparison SHA; it does not imply sponsor authority or approval. The translation also records `not1mm/plugins/sac_cw.py`, `not1mm/plugins/sac_ssb.py`, `not1mm/lib/database.py`, and `not1mm/lib/ham_utility.py` from Oliver Bross's read-only `contest-sw` fork of Not1MM by Michael Bridak, GPL-3.0-or-later.

The existing CQ WW, CQ WPX, and Oceania identities, stored sessions/QSOs, receipts, canonical mutation bytes, and formatter admission remain unchanged. SAC CW uses the existing `pilot-1` and `pilot-2` formatter policies; SAC SSB uses `ssb-pilot-1` and `ssb-pilot-2`. No SAC identity in this branch has shipped or persisted production sessions.

## Entry and eligibility

Both modes use RST/RS plus positive sent and received serial numbers on 80m, 40m, 20m, 15m, and 10m. A durable serial reservation is required for every commit and may use session, band, or transmitter scope. ADIF capability is `exchangeStrings`, matching the pinned generic exporter’s `STX_STRING` and `SRX_STRING` output. A callsign is a duplicate only after an earlier accepted QSO on the same band.

The published 2026 periods are 19–20 September for CW and 10–11 October for SSB, from 12:00 UTC Saturday through 11:59 UTC Sunday. This core preview does not validate those date windows. It also does not enforce category-specific power, operator, band, assistance, overlay, transmitter-count, simultaneous-signal, or ten-minute band-change requirements. Those omissions make the rules suitable for isolated practice and score preview only.

The evaluator enforces the published operating segments: CW 3510–3560, 7000–7040, 14000–14060, 21000–21070, and 28000–28070 kHz; SSB 3600–3650 or 3700–3800, 7060–7100 or 7130–7200, 14125–14300, 21151–21450, and 28320–29000 kHz. The SAC 2026 exclusion of Russian and Belarusian entrants is enforced from the station entity snapshot using the bundled ADIF identities for Asiatic Russia, Belarus, European Russia, and Kaliningrad. The published wording excludes their participation; it does not say that other entrants lose credit for working those entities, so worked contacts are not rejected on that basis.

Scandinavian eligibility uses the sponsor prefix list plus the canonical entity mapping pinned in the bundled CTY snapshot. In particular, Aland and Market Reef resolve to `OH0` and `OJ0`; both work on the station and worked-contact sides. The pinned Python list uses typographic `OHØ`/`OJØ` strings and therefore misses those canonical values. The corrected candidate does not preserve that operational defect.

## Scoring and multipliers

For a Scandinavian station, a non-Scandinavian European QSO earns 2 points and a non-European QSO earns 3. For a non-Scandinavian European station, a Scandinavian QSO earns 1 point on every supported band. For a non-European station, a Scandinavian QSO earns 3 points on 80m/40m and 1 point on 20m/15m/10m. Same-side contacts are accepted log rows with zero points.

For a Scandinavian station, §8.1 says each worked DXCC entity is a multiplier once per band and states no positive-point restriction. The evaluator therefore lets an accepted same-side zero-point row add its DXCC multiplier, preserving the independently checked 11 points × 4 multipliers = 44 fixture. Invalid and duplicate rows never add multipliers. For a non-Scandinavian station, only a worked Scandinavian entity can multiply, once per sponsor prefix-number and band; such a QSO also earns points under §7.2.

The sponsor's prefix-number rule is derived from the actual Scandinavian component of the callsign and the pinned worked-entity identity. The resolver selects exactly one component consistent with that entity's canonical prefix, treats `OH0` as distinct from `OH`, and accepts only an explicit ASCII digit at the sponsor-defined prefix-number position. `SM1ABC/P/QRP` resolves to `SM:1`, `LA/G3XYZ` to `LA:0`, and `OZ150A` to `OZ:1`. Ambiguous, contradictory, malformed, or unresolved inputs fail validation rather than falling back to another slash component. The pinned helper can reduce `SM1ABC/P/QRP` to `P0`, after which its SQLite expression counts an empty area component; that source defect is deliberately not reproduced.

Full rescoring after correction or deletion replays surviving contacts in timestamp then UUID order. The tie-break is deterministic and does not depend on database row order.

## Export and evidence limits

Cabrillo names are `SAC-CW` and `SAC-SSB`, with QSO mode tokens `CW` and `PH`. Both serial fields use the existing six-character layout. The received serial is emitted exactly as normalized: the CW and SSB goldens use received serials `1` and `2`, proving that the exporter does not add zero padding. This agrees with the sponsor Cabrillo specification, which accepts `1`, `01`, `001`, `0001`, or `00001`.

The generic Cabrillo layer does not yet model every SAC submission field and category constraint, including the per-QSO transmitter identifier and full `CATEGORY-STATION`/SAC category readiness. Passing the goldens proves deterministic source-layout rendering, not that the output is ready for sponsor upload.

The existing entity snapshot already pins the needed authority: ADIF identity, continent, canonical country prefix, and reference-data version. No durable contract or store schema expansion is required. The source-only comparison fixture freezes plugin hashes and known source outcomes separately from the corrected operational cases. Eight focused core tests cover descriptors, the comparison fixture, Scandinavian and non-Scandinavian arithmetic, non-European band points, OH0/OJ0 on both sides, actual portable-call area resolution, 2026 entrant exclusion, validation, and CW/PH Cabrillo output. Two focused store tests cover mandatory reservations, commit/reopen, correction/deletion replay, and serial non-reuse after restart.
