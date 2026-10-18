# CQ WW sponsor-country multiplier contract

**Contract date:** 2026-10-18  
**Scope:** reusable country-reference primitive and noncatalog CQ WW scoring slice  
**Activation status:** blocked pending a complete production reference and runtime integration

## Primary authority

The current [2026 CQ World-Wide DX Contest rules](https://www.cqww.com/rules/) define one country multiplier per band. The country standard is the DXCC entity list, the Worked All Europe multiplier list, plus IG9/IH9. Maritime-mobile stations count only for a CQ-zone multiplier. QSO points are separately based on the transmitter location of the station worked.

The official DARC [award rules PDF](https://www.darc.de/fileadmin/filemounts/referate/dx/diplome/Award_Rules_DARC_DX_ENG_032023.pdf) is the pinned WAE-list authority for this bounded slice. The reviewed special endpoints are Vienna International Centre (`4U1V`), Shetland (`GM/s`), Bear Island (`JW/b`), European Turkey (`TA1`), and Sicily (`IT`). CQ WW's explicit `IG9/IH9` supplement is a separate African Italy country multiplier.

The runtime geography coordinate is pinned to:

- `Sources/XLogCore/Resources/cty.csv`
- SHA-256 `e5d907fb16842cfa3dd8502c20ebe6bfc2039c6f5b2cc73f9ea6d3f5915f6d6d`
- runtime version `bundled-cty-fnv64-cf9c48a44d4b5e66`

The independent fixture is intentionally a reviewed subset, not the complete sponsor country list. It proves that the actual bundled resolver distinguishes ordinary DXCC entities from the named WAE-only endpoints and distinguishes Sicily and African Italy even though both use ADIF 248.

## Typed reference

`ContestCountryMultiplierReference` classifies the full immutable resolver endpoint `(ADIF, normalized entity name, continent, CQ zone)`. It never infers a sponsor country from a callsign or from ADIF alone. Each endpoint maps to a stable multiplier key, human label, and authority class (`dxcc`, `wae`, or `cqwwSupplement`). Multiple endpoints may share a country key when their label and authority metadata agree, which supports entities spanning multiple CQ zones. Duplicate endpoints and conflicting shared-key metadata are rejected.

The reference requires one exact runtime geography version. Records are normalized and canonically sorted. Its rule revision token is an unambiguous length-prefixed FNV-64 digest over the identity, pinned geography version, and canonical records. Reversing input records therefore preserves equality, encoding, and rule identity.

The corrected `CQWWSponsorCountryRule` has new CW and SSB identities. It is deliberately absent from `ContestRuleRegistry.pilots`; the existing `cq-ww-cw` and `cq-ww-ssb` source-preview identities and their ADIF-only replay behavior remain unchanged.

## Maritime-mobile boundary

The shared classifier accepts an explicit terminal `/MM` component and rejects misplaced or repeated markers. A leading `MM` country-prefix component remains valid, such as `MM/F1ABC/MM`.

The bundled CTY resolver strips `/MM` and returns the license-prefix home entity. That entity is not evidence of the transmitter location at sea. The 2026 rules provide no separate maritime-mobile QSO-point value: their point branches still depend on transmitter location. The corrected rule therefore exposes only the zone candidate at its policy boundary but marks the QSO invalid with `unsupportedMaritimeMobilePointLocation`; it does not award home-country points or a country multiplier. Accepted zone-only `/MM` scoring requires a future immutable physical-location snapshot and sponsor continental-boundary classification.

## Proven behavior and remaining activation work

The fixture independently proves ordinary DXCC, WAE-only, IG9/IH9 shared-country behavior, Sicily separation, per-band country and zone scope, duplicates, correction, deletion, deterministic replay, unknown endpoints, reference mismatch, malformed references, and actual bundled CTY resolutions. Its score oracle is 11 QSO points × 9 multipliers = 99.

This slice is not full CQ WW support. Product activation still requires:

1. A complete reviewed country-reference materialization for every eligible endpoint in the pinned CTY snapshot, including deleted/reference-date policy.
2. Durable worker persistence of the exact reference coordinate and reconstruction of the corrected rule after restart.
3. Physical transmitter geography for maritime-mobile point calculation; no license-prefix fallback.
4. Human multiplier labels resolved from the same pinned reference in score and manager views.
5. Catalog, parser, worker, UI, and export acceptance under a new immutable sponsor-profile identity.
6. The other open gates in `PILOT_SPONSOR_RULE_AUDIT.md`, including schedule, category, single-band projection, operating limits, and sponsor-ready Cabrillo validation.

Until those gates close, the shipped source-preview CQ WW rules retain their existing labels and limitations.
