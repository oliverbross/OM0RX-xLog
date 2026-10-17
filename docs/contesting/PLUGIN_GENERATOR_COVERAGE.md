# Python contest plugin extraction coverage

Source boundary: `oliverbross/contest-sw` at `7c8b499225a73f7f8f792246881bd7aefc05452f`. The acceptance ledger and extractor reconcile exactly 95 Python files: 94 contest plugins plus the empty package initializer. Every included and excluded file must also match its ledger SHA-256, so dirty bytes at the same Git HEAD are rejected. The existing acceptance ledger remains the owner of the 16 active preview and 78 pending dispositions; this slice changes none of them.

## Exact result

| Coverage dimension | Automatic | Needs adapter | Manual | Unknown |
| --- | ---: | ---: | ---: | ---: |
| Declared metadata and recognized UI extraction | 94 | 0 | 0 | 0 |
| Executable contest semantics | 0 | 0 | 0 | 94 |

Every per-plugin result and reason is in [python-plugin-inventory.json](generated/python-plugin-inventory.json). “Automatic” means only that all six requested declarations and recognized UI facts were deterministically extracted at this pin. It does not mean the contest is ported, correct, accepted, or safe to activate. Semantic status stays unknown until a reviewed declarative policy or exceptional adapter passes differential and independent fixtures.

The pinned corpus yielded 564 resolved declaration observations, 246 field-label observations, 376 field visibility operations and 555 field-to-contact mappings. There were no dynamic UI labels in this exact corpus. Negative fixtures prove that non-literal labels, branch-dependent labels, malformed syntax, missing metadata, conditional reassignment, direct mutation, augmented assignment, subscription writes and deletes remain explicit unresolved/manual observations.

## Behavior inventory

All 94 plugins contain `points`, multiplier and score functions. Their canonical AST shapes are diverse:

| Behavior | Functions | Unique fingerprints |
| --- | ---: | ---: |
| Points | 94 | 64 |
| Multipliers | 94 | 55 |
| Score | 94 | 28 |
| Contact mapping | 94 | 51 |
| Cabrillo export | 94 | 55 |
| ADIF export | 94 | 70 |
| Recalculation | 94 | 33 |
| ESM | 93 | 22 |

Points contain branches in 90 plugins and entity lookup dependencies in 35. Literal numeric returns occur in 72, but usually alongside branches. Exact combined points/multiplier/score fingerprints recur in 17 groups: two groups of four, one group of three, and fourteen pairs. The remainder are singletons. These clusters are candidates for policy review only; they do not establish equivalent rules.

The cleanest new-family pilot is the four 10-10 seasonal plugins. They have the same scoring triple, once-per-contest duplicate scope, no multiplier, the same three-token exchange handling, and CW/phone metadata variants. The checked-in [draft definition](generated/ten-ten-family.authored-definition.json) correctly preserves member number `0` as a valid nonmember exchange worth one point, positive member numbers as two points, and duplicate/invalid cases as zero/error. It intentionally leaves bands, categories, eligibility, operating time and export goldens unresolved. Before executable policy work, pin the official 10-10 rules for member eligibility, 10 m limits, seasonal/category dates and Cabrillo layout. Python source alone cannot authorize those facts.

## Generated Swift boundary

[PythonContestDefinitions.generated.swift](generated/PythonContestDefinitions.generated.swift) is outside `Package.swift` and the active catalog. It contains one array of declarative metadata, not 94 rule implementations. Missing bands and all score/multiplier/export policies are `.unresolved(...)`; the generator never substitutes empty bands, zero points, or guessed rules as operational defaults.
