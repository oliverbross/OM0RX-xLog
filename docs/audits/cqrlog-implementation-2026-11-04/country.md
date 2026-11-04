# C01/C02 country implementation evidence — 4 November 2026

Baseline: canonical `main` at `db4a9ce2739fc8b96371cd432d3b8787e950a45e`.
No production application, contact store or station device was opened or changed
by this implementation lane. The root integrator owns commits/releases.

## Source/data boundary

The real bundled derivative is `Sources/XLogCore/Resources/country-reference-pack.json`.
Data attribution: Martin OK1RR, distributed by the CQRLOG country-data project.
Pinned source: [`4adb0e70bf29faefc3b203bc355796cd0c6201fe`](https://github.com/ok2cqr/cqrlog-cnty-files/tree/4adb0e70bf29faefc3b203bc355796cd0c6201fe/data/dxcc).
The upstream [data provenance/terms](https://github.com/ok2cqr/cqrlog-cnty-files/blob/4adb0e70bf29faefc3b203bc355796cd0c6201fe/data/README.md)
credits OK1RR and states that the data has no separate licence text; the repository's
GPLv2 code licence does not cover the data. Reuse follows the operator's supplied
permission and retains this attribution. No Pascal/Python/Go parser implementation
was copied. The xLog normalizer and resolver independently implement the scoped
finite grammar documented below.

Reproduction:

```sh
git clone https://github.com/ok2cqr/cqrlog-cnty-files.git .build/cqrlog-country-source
git -C .build/cqrlog-country-source checkout --detach 4adb0e70bf29faefc3b203bc355796cd0c6201fe
python3 tools/normalize-cqrlog-country.py .build/cqrlog-country-source Sources/XLogCore/Resources/country-reference-pack.json
```

Observed normalized digest: `3ad5c0c89dcc4929020fcefe8d2d2f053d2e18a57993b9c6725fd3a18ea67603`.
21,343 normalized rules, all six component digests, 294 explicitly enumerated
excluded source rows/patterns. Source-reported version is unknown; the source Git
revision and local content digest are separate facts. The source checkout remains
under `.build`; it is retained as a reproduction input, not packaged source code.

Supported: current/deleted records, exact exceptions, real inclusive UTC date
windows, finite literal/`#`/`?`/`%`/character-class patterns, ignored modifiers,
declared ambiguous prefixes, US numeric-district and Argentine letter-area rules.
Literal length and class matching are represented directly; leading wildcard
patterns use the same lookup path on bundle/import/download.

Excluded coverage is machine-readable in the pack: 259 non-callsign designators or
unsupported patterns; explicit source date/ADIF/coordinate/zone defects or unsupported
range-valued zones account for the remainder. No truncation, arbitrary default-year
limit, legacy shortstring collation or file-order conflict resolution is copied.
This derivative does **not** claim full CQRLOG parser parity. A future refreshed
source must be normalized by the pinned normalizer contract or be rejected by the
same bounded pack validator.

Specificity: complete-call exact exceptions first; historical deleted records at
their valid dates; longest matching pattern and literal/digit/letter specificity;
then explicit source authority (exact-call component, area component, base table).
Equally authoritative contradictory outcomes are ambiguous, independently of input
order. Area rows can refine the base row's descriptive name without making all
same-prefix calls ambiguous. Missing/invalid dates never mean today. The legacy
`resolve` API retains its home-entity `/MM`/`/AM` adapter; new consumers use neutral
`facts`. Entity centroids remain labelled approximations.

## Independent fixture manifest

Reviewed 4 November 2026. Fixtures assert fixed answers, not resolver-generated
goldens. Synthetic calls establish matching rules, not the location of real people.

| Fixture | Expected neutral fact | Independent rule/source |
| --- | --- | --- |
| OM0RX/EA8; EA8/OM0RX/P | Canary Islands, 29 | Pinned CTY/OK1RR EA8 prefix; explicit operating prefix on either side |
| OM0RX/P, /QRP, /LH | Slovakia, entity approximation only | Pinned OM prefix; ordinary modifiers provide no station coordinates |
| MM/LY3X/P versus OM0RX/MM | Scotland 279 versus known no entity | Leading MM prefix versus trailing maritime qualifier |
| OM0RX/AM | Known no entity; legacy API still home entity | Operation qualifier stays separate from the compatibility adapter |
| DL1ABC/F | France 227 | Explicit geographic suffix; deliberate disagreement with CQRLOG's documented legacy Germany result |
| KG4ABC | USA 291 | Existing KG4 three-letter-suffix distinction |
| Empty/double slash, punctuation | Invalid | Bounded input syntax; no lossy stripping |
| Synthetic OM0RX/LH exact exception, 2020-01-01 | Synthetic entity only inside interval | Authored XML fixture with both boundary seconds checked |
| Contradictory equal OM rules, reversed file order | Ambiguous both ways | Authored equal-authority fixture |
| OK1AYY, 1992-12-12 / 2020-01-01 | Czechoslovakia 218 / Czech 503 | Pinned source deleted/current records |
| KL7AA/1 | Dataset US district rule 291 | Maintainer's pinned algorithm example; not a live station-location assertion |
| Synthetic LU1ZZZ/F | Source Santa Fe area | Pinned AreaOK1RR rules and maintainer's Argentina area contract |
| 3Y0ZZZ | Ambiguous | Pinned Ambiguous.tbl; no fabricated island |
| 2O12L at 2012-07-20 start | England 223, exact source rule | Pinned CallResolution.tbl date-valid record |

## Recorded verification

`swift test --filter 'CountryFactsTests|CTYResolverTests'` passed 12 tests in two
suites (1.226 s test runtime; archive `5b12609466ed62c1`). This run established
the real normalized corpus, legacy endpoint compatibility, slash/date behavior,
conflict order independence and invalid-pack rejection at the then-current source.
Later edits require the final run recorded below; this is not native UI evidence.

An initial real-pack fixture failed for EA8 because base/area descriptive names
were treated as equal authority, and for 3Y0 because a declared ambiguity with no
matching ordinary rule fell through to unknown. The implementation now makes source
authority explicit and retains declared ambiguity even without a broad prefix rule.
The assertions were retained. An initial per-record formatter implementation took
32 s; bounded UTC date parsing reduced the complete focused suite to 1.226 s.

## Task state (live lane record)

| IDs | State | Boundary |
| --- | --- | --- |
| C01-T01/02/03 | Implemented; focused core evidence above | Actual host integration and final source gate follow |
| C01-T04/05/06/07 | In progress | Shared cluster/logbook wiring, retained source identity, portable enrichment, consumer regression and operator handoff |
| C02-T01/02 | Implemented; real derivative validated | Explicit excluded coverage retained |
| C02-T03/04/05/06/07 | In progress | Publication/rollback, compact asynchronous review, explicit selected correction, receipts/recovery, UI and acceptance |

No C01/C02 integration, packaged UI, backup/restore or large-log performance row
is claimed passed by the core-only evidence above. No hardware acceptance is
needed for these two epics, but programme-wide physical boundaries remain separate.
