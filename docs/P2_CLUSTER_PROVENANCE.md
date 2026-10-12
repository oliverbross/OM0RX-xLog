# P2 xCluster pure-domain provenance

This slice adapts actual xCluster logic into `XClusterIntegrationCore`, with only
Foundation as a dependency. It reads caller-supplied contacts and cluster lines;
it contains no SQLite, file, socket, credential, hardware, or UI access.

Source repository: `/Users/oliver/Documents/Projects/OM0RX-xCluster`.
Pinned full source revision: `776b7b04ffa5a9057f1e909339393549a103836b`.
The source checkout was clean when inspected. The extraction does not edit it.

## Original source SHA-256

| Original file | SHA-256 |
| --- | --- |
| `Sources/XClusterCore/SpotLogic.swift` | `df709b28ec9cb10c91bb3d91f98a70ceb5844af4e267b613e7f116fb93494beb` |
| `Sources/XClusterCore/Models.swift` | `4430fdf0239600aff960495d7c416dac1217f25673ce933ff45b94251fe0a78e` |
| `Sources/XClusterCore/LogbookIndex.swift` | `2a918cf45c5b989b9a084f07962ad7ce47c866d726ad643eff1be817ac248ab0` |
| `Tests/XClusterCoreTests/SpotLogicTests.swift` | `822d41e7dc7bd0fb91eb2f8649ad3f1617252bd241172c31f31c9a37e0e99a2f` |
| `Tests/XClusterCoreTests/LogbookIndexTests.swift` | `9e506c7328e6ee3920577ec79d1907fbf3257e970dd38f2f8f55faca7da6c387` |

## Extraction and compatibility

- `SpotLogic` and `ClusterLineParser` come from the original `SpotLogic.swift`.
  All original `SpotLogic` APIs, bands, mode inference, source inference, status
  strings, score weights, and special-rule matching remain available.
- `SpecialRule` and `SpecialReferenceFormat` are extracted from original
  `Models.swift`, including legacy decoding and reference patterns. Application
  settings, palettes, stored paths, and operator-specific defaults are omitted.
- `RawSpot` retains the original fields and gains Codable and a public
  initializer for the host boundary.
- `ClusterContact` is a Codable minimum projection of `QSORecord`: callsign,
  band, mode, optional ADIF entity, date, paper QSL, LoTW QSL, and eQSL.
  Confirmation matches the original `QSORecord.isConfirmed`: paper or LoTW
  `X/Y/YES/TRUE/1/C/CONFIRMED` after trim/uppercase count; eQSL alone does not.
- `ClusterClassificationIndex` adapts `LogbookIndex.build`, `classify`, and
  `workedBeforeDate` into an in-memory constructor. The host must supply the
  appropriate selected, nondeleted contact records and any resolved entity.
  Entity resolution, SQL loaders, metadata files, and history UI are excluded.
- `ClusterClassification` replaces the original classify tuple with Codable
  `callStatus`, `dxccStatus`, and `workedBefore` fields.

The original classifications are preserved: New Call (NC), New Band (NB), New
Mode (NM), New Band+Mode, Worked, Confirmed, and DXCC ATNO. A callsign's new mode
is specific to the band once that band has been worked. DXCC mode novelty uses
the entity's full history across bands, exactly as the original index does.
An absent/nonpositive entity is `Unknown`, independently of callsign status.
Worked-before dates prefer the newest exact band/mode contact, then the newest
contact on the same band; a different band alone produces no date.

## Deliberate changes

1. `ClusterLineParser.maximumLineBytes` is 4,096 UTF-8 bytes. Larger raw lines
   are rejected before control-character filtering and regex allocation. The
   original parser had no input-size bound.
2. Both live and history parsers require finite positive kHz frequencies no
   greater than `maximumFrequencyKHz` (300,000,000 kHz / 300 GHz). This admits
   the original amateur band table while rejecting zero, overflow to infinity,
   and unreasonable magnitudes. Decimal grammar remains unchanged.
3. Caller-supplied records are normalized in the index constructor using the
   same callsign/band/mode normalization as lookups. Original SQL loaders
   established this invariant before `build`; no loader exists in this slice.
4. In-memory records are sorted newest first, with stable input order for equal
   dates. Original SQL queries established newest-first order. This makes
   worked-before independent of arbitrary caller input order.
5. Band/mode keys use a structured Hashable value rather than delimiter-joined
   strings, preventing collisions for caller-supplied strings containing `|`.

## Host API

```swift
let raw = ClusterLineParser.parse(line, clusterID: id, clusterName: name, at: receivedAt)
let index = ClusterClassificationIndex(records: contacts)
let result = index.classify(call: call, band: band, mode: mode, adif: entity)
```

`ClusterContact`'s public initializer accepts `callsign`, `band`, `mode`, optional
`adif` (default nil), `date` (default distant past), and `paperQSL`, `lotwQSL`,
`eqsl` (default empty). All dates remain Foundation Date values; the host owns
the JSONEncoder/JSONDecoder wire date strategy.

## Validation

`ImportedSpotLogicTests` brings 12 compatible pure-domain tests from the pinned
original `SpotLogicTests`. `ClusterClassificationTests` adapts the original NF3R
classification fixture to memory and checks normalization, confirmation flags,
eQSL-only exclusion, unknown/ATNO entities, callsign vs entity semantics,
worked-before ordering, structured keys, and Codable round trips.
`ClusterParserBoundaryTests` checks Unicode/control input, malformed history,
live/history frequency bounds, raw UTF-8 size limits, original heuristics,
score priority, and Codable raw spots.

On 2026-10-12, the integrated portable manifest built successfully and the
following command passed all 26 selected tests (12 imported, 7 classification,
7 parser/boundary), with zero failures:

```sh
XLOG_PORTABLE_ONLY=1 swift test --filter 'ImportedSpotLogicTests|ClusterClassificationTests|ClusterParserBoundaryTests'
```

These tests prove domain extraction only; they do not prove a live cluster
connection, real logbook acceptance, radio control, or installed app behavior.
