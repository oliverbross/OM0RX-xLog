# C01/C02 country implementation evidence — 4 November 2026

**Final integration:** the [1.5.13 release record](../../releases/v1.5.13-cqrlog-candidate.md)
adds signed-worker/100k and native selected-apply/restart/recovery results to this
source evidence. Earlier pending-candidate statements below are historical.
The final layer matrix and machine receipt retain connected/disk-cold limits.

Final normal-manifest gate found one fixture error: `ZZ` is allocated to Brazil,
as the bundled CSV and [ITU allocation table](https://www.itu.int/gladapp/Allocation/CallSigns)
both establish. The resolver was unchanged. The corpus now positively checks
Brazil/108 for `OM0RX/ZZ`, and checks unknown plus absent country for `OM0RX/QQ`
against both bundled adapters. `swift test --filter 'CountryFactsTests|CTYResolverTests'`
passed **12/12** (CLI evidence `swift_test_--filter__CountryFactsTests_C_64533a0d.log`).
The initial normal run's one assertion failure remains recorded; it is not a pass.

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

Current normalized digest: `c04689ac8cf530672a98df3d1ecd132a150d13e7583f88037928b75a09ff1731`.
21,335 normalized rules, all six component digests, 302 explicitly enumerated
excluded source rows/patterns. Source-reported version is unknown; the source Git
revision and local content digest are separate facts. The source checkout remains
under `.build`; it is retained as a reproduction input, not packaged source code.

Supported: current/deleted records, exact exceptions, real inclusive UTC date
windows, finite literal/`#`/`?`/`%`/character-class patterns, ignored modifiers,
declared ambiguous prefixes, US numeric-district and Argentine letter-area rules.
Literal length and class matching are represented directly; leading wildcard
patterns use the same lookup path on bundle/import/download.

Excluded coverage is machine-readable in the pack: 259 non-callsign designators or
unsupported patterns; explicit source date/ADIF/coordinate/zone defects, unsupported
range-valued zones and eight collapsed identical repeated aliases/windows account
for the remainder. No truncation, arbitrary default-year
limit, legacy shortstring collation or file-order conflict resolution is copied.
This derivative does **not** claim full CQRLOG parser parity. A future refreshed
source must be normalized by the pinned normalizer contract or be rejected by the
same bounded pack validator.

Specificity: complete-call exact exceptions first; historical deleted records at
their valid dates; longest matching pattern and literal/digit/letter specificity;
then explicit source authority (exact-call component, area component, base table).
Equally authoritative contradictory outcomes are ambiguous, independently of input
order. Area rows refine the matched source description; the country name remains
the canonical ADIF entity label from the bundled CTY entity catalogue. Missing/invalid dates never mean today. The legacy
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

The first core/data commit `d2f2758d` retained 21,343 records/digest
`3ad5c0c89dcc4929020fcefe8d2d2f053d2e18a57993b9c6725fd3a18ea67603`.
Subsequent strict duplicate-identity validation correctly rejected eight identical
aliases/windows repeated in their original source rows (failure archive
`47ceb33516b6a7d8`). The normalizer now explicitly collapses and enumerates those
eight duplicates, retaining all unique meanings. The validator was preserved.

## Task state (live lane record)

| IDs | State | Boundary |
| --- | --- | --- |
| C01-T01/02/03 | Implemented; initial core evidence above | Final integrated core gate is recorded by programme owner |
| C01-T04/05/06 | Implemented; focused host/consumer evidence below | Packaged candidate and large-fixture acceptance remain separate |
| C01-T07 | Implemented; source regression and operator handoff supplied | Final programme acceptance adds packaged evidence |
| C02-T01/02 | Implemented; real derivative validated | Explicit excluded coverage retained |
| C02-T03/04/05/06 | Implemented; native lifecycle/correction and component evidence below | Packaged integration and large-fixture gate remain separate |
| C02-T07 | Implemented; focused lifecycle/backup evidence below | Programme owner records final candidate acceptance |

## Host implementation and source freeze

Frozen for programme integration on 4 November 2026, after first core/data commit
`d2f2758d`; the programme owner records the exact final integration commit. The
normalizer/resource hardening following that commit is intentional and documented
above. Operator instructions: `docs/help/country-reference-review.md`.

Consumer inventory and dispositions:

- Logbook lookup, live cluster DX/spotter facts and inferred contact projection
  capture the same admitted immutable snapshot. Existing configured Club Log XML
  remains selected until an explicit richer-pack activation. Current source bytes
  are cached by source identity; spots do not reread/parse the pack.
- Public callsign lookup, operating goals/opportunities, WSJT-X classification and
  legacy data-quality evidence consume neutral `facts`. Explicit stored DXCC has
  priority over inference. Slash-call home profile locations are separately
  labelled and never promoted to an operating position.
- Contest reference/scoring uses its existing independent pinned interpretation;
  country reference activation does not replace that owner. The intentional
  bundled/downloaded comparison in LogReviewReferences remains a comparison.
- A reference change reclassifies retained spots with their original ID and time
  and invalidates the existing contact projection. Both explicit new reference
  routes and an ordinary Club Log snapshot change join the existing asynchronous
  contact rebuild. Root owns the alert retained-ID deduplication and map labels.
- New review/correction endpoints stay on the existing logbook, reference, query,
  contact mutation, receipt, backup and native workspace guards. Whole-log review
  streams compact SQL fields on a pinned cancellable reader. Cancellation and
  workspace replacement drain that reader before database replacement.
- Selected apply is bounded to 25 contacts in one canonical SQLite transaction;
  each field requires an explicit choice. Contact revision, source snapshot,
  workspace and evidence are fenced. Durable receipts retain before-images;
  recovery is a compensating revision-checked edit. Keep/cancel does not enqueue
  writes. Only existing sync/invalidation owners run after a successful mutation.
- Reference import/download use the bundle validator and atomic single-file
  publication under the same process publication lock as correction. A first
  import over configured XML preserves that exact XML predecessor. Cross-source
  rollback restores those bytes and source selection; inactive XML is archived.

## Final focused verification

`country-source-gate.txt` is the retained complete CLI output for:

```sh
XLOG_PORTABLE_ONLY=1 swift test --filter 'CountryIntegrationTests|LiveLogbookMethodsTests.ctyResolverSourceIdentity|CallsignEnrichmentTests|LiveClusterMethodsTests.spotterContinentFiltering|OperatingGoalTests|LiveOperatingGoalMethodsTests'
```

Exit 0: **18 Swift Testing tests in five suites** (16.373 s), plus **seven
CallsignEnrichment XCTest tests**. This is actual host/test execution, not packaged
UI or hardware evidence. It covers shared cluster/logbook facts and retained
spot ID/time, source cache reuse, independent DX/spotter continent, source-aware
goal projection, page-outside-first/zone-only corrections, replay/undo/later-edit
refusal, stale-QSO/source failure, injected precommit atomic failure, cancellation
and workspace drain, exact first-import XML rollback, real download/304 semantics
and the real BackupManager restore.

The combined backup test persists representative station equipment, portable
preset/active context, nearby callsign setting, all 20 CW memories including speed
and prosign directives/WinKeyer preferences/composition mode, ten voice labels and
routes/edits, saved filter/shortcut/bandmap preferences, a held draft, current
country pack and correction receipt. After actual restore it asserts equality of
the retained settings/preferences/draft, country answer 999, durable original
before-image and successful receipt recovery to the original zone. Voice profile
metadata is covered; external voice recording bytes are not claimed copied.

The preceding expanded-backup attempt failed at settings fixture ISO8601 decoding
(`95e3f7a1df4f1b59`); the fixture now uses the owning API's ISO8601 encoding and the
same equality assertions pass. The failed run is not acceptance evidence.

`country-ui-gate.txt` retains the five new component tests and successful
`npx tsc --noEmit` command (exit 0; archive `b1aca47eb260ec6f`). It verifies explicit
read actions, no default field selection, Keep/cancel, selected apply/recovery,
stale reference rejection, native scan cancellation/late-result suppression and
reference actions. Earlier affected legacy component run passed 84 tests; root
runs the final full frontend gate. Both Python tools pass `py_compile`; scoped
`git diff --check` passes. Root's final full core gate must include the latest
`CountryFactsTests|CTYResolverTests` because the portable manifest excludes that
test target.

## Candidate acceptance boundary

No packaged native UI or changed-path 100k timing is claimed by the focused
evidence. Root runs `prototype/scripts/benchmark-country-workflows.py` against the
single signed canonical candidate and the retained existing synthetic fixture
`.build/qlog-scale-20261103-1ny_kct7/synthetic-100k.sqlite`. C01-A10 and C02-A11 stay
**Not run** until that evidence exists. The script retains version/hash,
PID/executable/private-root proof and cold/warm/parallel health measurements.

The earlier raw-debug-worker benchmark launch failed closed at runtime-profile
validation: archive `450800fd332eaee5`,
`.build/cqrlog-country-benchmark-source.json`, private root
`/private/tmp/xlog-wave1-country-benchmark-k5jdswez`. That sequence stopped before
any GUI/path binding. The corrected benchmark requires a signed integration app
bundle and never falls back to production. No new shipped executable/target was
introduced. Root owns final package/UI/large-log acceptance and the master tracker;
the source lane does not equate these focused tests with every acceptance row.

## Full-suite compatibility reconciliation, 5 November

The first programme-wide portable run exposed real integration regressions rather
than a reason to relax legacy fixture assertions:

- The rich pack has no legacy `rules` array, so PJ impact preview lost its
  historical Bangladesh-305 comparison and omitted unresolved `PJ9UNKNOWN`.
  `pjCorrection` now obtains that comparison from the admitted pack records while
  preserving the XML-only source's intentional missing-Bangladesh behavior. The
  existing page/count/order expectations remain, with additional current ADIF 519
  checks for PJ5/PJ6 (pinned Country.tab:219 and AreaOK1RR.tbl:4542).
- AreaOK1RR labels such as “Slovakia, Presov, Bardejov” and Australian licence
  classes describe the matched area/rule, not a country. Facts now use canonical
  ADIF entity names and retain the original text in `matchedDescription`. The
  existing Slovak/Australian QRZ assertions remain unchanged. The source-specific
  Argentina/Santa Fe fixture now separately asserts entity 100/ARGENTINA and the
  retained SANTA FE description, preserving its geographic matching check.
- Canonical names on reachable endpoints also restore the existing declared-name
  South Shetland DXpedition match. The original latitude-below-minus-60 assertion
  remains unchanged; no Polish home position is substituted, and no additional
  map fallback was introduced.
- Partial Club Log XML keeps its legacy source-only `resolve` coverage. At the
  existing shared snapshot owner, neutral `facts` adds the bundled richer pack
  only when XML returns `unknown`. Ambiguous, invalid, missing-date and known-no-
  entity results never fall through. All neutral cluster/logbook/profile consumers
  share one immutable composite identity. Winning `matchedReferenceRevision` and
  description identify the actual fallback source; legacy source-only API behavior
  stays explicit. No implicit fallback is attached to normalized packs.

The facts policy is now `xlog-country-facts-v2`. Rich identities include the CTY
entity-catalogue digest; XML composite identities include both admitted source
identities. Existing preview/correction fences use this complete identity.
Reference status/import/download/rollback expose that same `reference_revision`
as the active snapshot, with separate primary/fallback revisions and explicit
provider/coverage labels. The settings detail view labels each revision.

Focused execution before the final status-display assertions passed all 44 tests
in the four affected suites plus CountryIntegrationTests (16.550 s). Original
QRZ/map/PJ expectations were preserved. The expanded source/status and complete
portable/core gates are recorded by the programme owner at integration.

Final source verification after those assertions:

```sh
XLOG_PORTABLE_ONLY=1 XLOG_CONTEST_PYTHON=/opt/homebrew/bin/python3.12 swift test --scratch-path .build/cqrlog-portable-final --jobs 2 --no-parallel
swift test --filter 'CountryFactsTests|CTYResolverTests'
cd prototype
npm run test:vitest -- src/live/CountryCorrectionReview.test.tsx && npx tsc --noEmit
```

All commands exit 0. Full portable: **617 Swift Testing tests in 85 suites**
(89.926 s), another **eight tests in two suites**, and all XCTest targets pass.
The unchanged held-feed/logbook-read concurrency test passes in 0.841 s; the real
private Python-host concurrency XCTest passes in 4.031 s. Normal core: **13 tests
in two suites** (1.538 s), including canonical entity labels versus retained area
descriptions, composite/actual-winning source identities and refusal to fall back
from non-unknown states. Frontend: **five tests** and TypeScript pass, including
separate active/XML/fallback revision labels. Scoped diff checks pass.

Complete retained evidence: `country-compatibility-portable-gate.txt` and
`country-compatibility-core-gate.txt`. The preceding unqualified full run omitted
the required Python environment and repository `--no-parallel` option; its Python
precondition failure and scheduling timeouts are retained in
`.build/country-portable-missing-env-parallel-failed.log`. The original 16-issue
portable regression log is retained in `.build/country-portable-original16issues.log`.
No timeout assertion was changed. The proper full CI run resolves both conditions;
the isolated held-feed test also passed unchanged in 1.133 s.
