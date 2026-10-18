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

The independent fixture remains a small hand-reviewed scoring oracle. The production source snapshot is now materialized separately at `Sources/XContestCore/Resources/CountryReferences/cqww-2026-country-reference.json`. Its canonical 91,990 bytes have SHA-256 `3f4e9752188f47677661a156790ddbbf1ac8afde8b282d3e2ebbbc9f68ba070b`, identity `cqww-country` / `2026.1-complete`, and 362 records. `ContestPackagedCountryReferenceLoader` verifies the exact digest, identity, CTY version, and record count before decoding it.

`CQWWCountryReferenceMaterializer` is the reviewable generator. It enumerates every distinct endpoint reachable from the pinned CTY parser at the fixed reference instant `2026-10-18T00:00:00Z`, including token-level CQ-zone, ITU-zone, and continent overrides. For this exact reviewed snapshot, it classifies ordinary endpoints only when their ADIF identity has one unambiguous ordinary entity name, then applies exactly six primary-source exceptions: the five DARC WAE areas above plus African Italy. That uniqueness check is a guard on these pinned bytes, not authority to classify an arbitrary CTY edition. Generation fails if an authority endpoint is absent, gains unexpected metadata, an ADIF entity has no unambiguous ordinary row, or any reachable endpoint is left uncovered. The legacy CTY `resolve` token cleaning and matching remain unchanged for existing callers; the corrected sponsor path explicitly uses separately cleaned `resolveCountryEndpoint` rules.

## Typed reference

`ContestCountryMultiplierReference` classifies the full immutable resolver endpoint `(ADIF, normalized entity name, continent, CQ zone)`. It never infers a sponsor country from a callsign or from ADIF alone. Each endpoint maps to a stable multiplier key, human label, and authority class (`dxcc`, `wae`, or `cqwwSupplement`). Multiple endpoints may share a country key when their label and authority metadata agree, which supports entities spanning multiple CQ zones. Duplicate endpoints and conflicting shared-key metadata are rejected.

The reference requires one exact runtime geography version. Records are normalized and canonically sorted. Its rule revision token is an unambiguous length-prefixed FNV-64 digest over the identity, pinned geography version, and canonical records. Reversing input records therefore preserves equality, encoding, and rule identity.

The corrected `CQWWSponsorCountryRule` has new CW and SSB identities whose source revision includes `country-reference-fnv64-bc711180563fcc50`. It is deliberately absent from `ContestRuleRegistry.pilots`; the existing `cq-ww-cw` and `cq-ww-ssb` source-preview identities and their ADIF-only replay behavior remain unchanged.

The snapshot policy is current-reference only. The bundled CSV carries no effective or deletion dates, so this materialization includes exactly the endpoints reachable in that immutable snapshot at the stated reference instant. Deleted DXCC or WAE entities absent from the snapshot are not inferred or resurrected. A future CTY or authority edition must generate new bytes, a new packaged reference identity/version and a new rule identity; persisted sessions continue to require their original reference bytes. Historical/deleted-entity scoring remains a separate reference-data project.

## Maritime-mobile boundary

The shared classifier accepts an explicit terminal `/MM` component and rejects misplaced or repeated markers. A leading `MM` country-prefix component remains valid, such as `MM/F1ABC/MM`.

The bundled CTY resolver strips `/MM` and returns the license-prefix home entity. That entity is not evidence of the transmitter location at sea. The 2026 rules provide no separate maritime-mobile QSO-point value: their point branches still depend on transmitter location. The corrected rule therefore exposes only the zone candidate at its policy boundary but marks the QSO invalid with `unsupportedMaritimeMobilePointLocation`; it does not award home-country points or a country multiplier. Accepted zone-only `/MM` scoring requires a future immutable physical-location snapshot and sponsor continental-boundary classification.

## Proven behavior and remaining activation work

The subset fixture independently proves ordinary DXCC, WAE-only, IG9/IH9 shared-country behavior, Sicily separation, per-band country and zone scope, duplicates, correction, deletion, deterministic replay, unknown endpoints, reference mismatch, malformed references, and actual bundled CTY resolutions. Its score oracle is 11 QSO points × 9 multipliers = 99. The complete-reference tests additionally prove every one of the 362 reachable endpoints is classified, token-level zone overrides survive materialization, same-country contacts score 0, same-continent contacts score 1, intercontinental contacts score 3, distinct North American countries score 2, and Austria plus Vienna remain distinct country multipliers.

This slice is not full CQ WW support. Product activation still requires:

1. Durable worker persistence of the exact reference coordinate and reconstruction of the corrected rule after restart.
2. Physical transmitter geography for maritime-mobile point calculation; no license-prefix fallback.
3. Human multiplier labels resolved from the same pinned reference in score and manager views.
4. Catalog, parser, worker, UI, and export acceptance under a new immutable sponsor-profile identity.
5. The other open gates in `PILOT_SPONSOR_RULE_AUDIT.md`, including schedule, category, single-band projection, operating limits, and sponsor-ready Cabrillo validation.

Until those gates close, the shipped source-preview CQ WW rules retain their existing labels and limitations.
