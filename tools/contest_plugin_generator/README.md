# Contest plugin inventory and definition drafts

This toolchain reads Python source with `ast.parse` and `ast.literal_eval`. It never imports a plugin, evaluates arbitrary expressions, or calls plugin functions. Comments are not treated as operational authority. The extractor records literal declarations, recognized UI wiring, contact mappings, function/dependency inventories, line spans and canonical AST fingerprints. A fingerprint is evidence that source shapes match; it is not proof that contest semantics match.

Generate the pinned inventory and non-catalog Swift fixture:

```sh
/opt/homebrew/bin/python3.14 tools/contest_plugin_generator/extract_plugins.py \
  --upstream /Users/oliver/Documents/Projects/contest-sw \
  --ledger docs/contesting/contest-acceptance-ledger.json \
  --output docs/contesting/generated/python-plugin-inventory.json
/opt/homebrew/bin/python3.14 tools/contest_plugin_generator/render_swift_metadata.py \
  --inventory docs/contesting/generated/python-plugin-inventory.json \
  --output docs/contesting/generated/PythonContestDefinitions.generated.swift
```

The required corpus check fails rather than skips when the external checkout is absent, on a different commit, has any included or excluded plugin bytes that differ from the ledger SHA-256 values, or differs from the checked-in inventory. Inventory extraction and verification require Python 3.14.x because `ast.dump` fingerprints vary across Python minor versions; the inventory records the required `3.14` major/minor while allowing any 3.14 patch release:

```sh
/opt/homebrew/bin/python3.14 tools/contest_plugin_generator/verify_pinned_corpus.py \
  --upstream /Users/oliver/Documents/Projects/contest-sw \
  --ledger docs/contesting/contest-acceptance-ledger.json \
  --inventory docs/contesting/generated/python-plugin-inventory.json
```

The decisive converter, comparator, and inventory tests require `CONTEST_SW_ROOT`; they fail rather than skip when it is absent. The `contest-definition-generator` CI job supplies an isolated checkout and runs both the corpus verifier and the complete generator suite.

To reproduce that setup locally, install Python 3.14 and use that interpreter explicitly:

```sh
git clone --no-checkout https://github.com/oliverbross/contest-sw.git /tmp/xlog-contest-sw
git -C /tmp/xlog-contest-sw checkout --detach 7c8b499225a73f7f8f792246881bd7aefc05452f
CONTEST_SW_ROOT=/tmp/xlog-contest-sw python3.14 tools/contest_plugin_generator/verify_pinned_corpus.py \
  --upstream /tmp/xlog-contest-sw \
  --ledger docs/contesting/contest-acceptance-ledger.json \
  --inventory docs/contesting/generated/python-plugin-inventory.json
CONTEST_SW_ROOT=/tmp/xlog-contest-sw python3.14 -m unittest discover -s tools/contest_plugin_generator/tests -v
```

`definition_schema.json` keeps the historical `1.0.0` draft interchange and adds a strict `2.0.0` authoring envelope. Version 2 uses only the finite policies already implemented by `ContestDefinitionDraft`; it is not an expression language and cannot request an adapter. Its optional `geographicMultiplier` maps directly to the bounded Swift configuration: one required received subdivision field, up to eight unique entity policies with uppercase tokens, and one entity fallback. Geographic goldens must provide resolved entity snapshots and a pinned reference-data version. Runtime-blocking omissions belong in `constraints.runtimeUnresolved` and prevent translation. Sponsor, category, schedule, membership and activation gaps belong in `constraints.acceptanceUnresolved` and remain visible without changing runtime semantics.

Version 2 goldens are intentionally limited to fully resolved positive scoring cases with `accepted` or `duplicate` dispositions. Malformed or contradictory contacts are covered by validator and Swift negative tests; authoring an expected `invalid` contact remains unsupported until the interchange defines which validation failure is expected. A geographic golden's reference-data version must be trimmed and no more than 160 UTF-8 bytes, matching the Swift runtime bound rather than JSON character count.

Validate a v2 envelope and emit sorted JSON that Swift decodes directly as `ContestDefinitionDraft`:

```sh
python3 tools/contest_plugin_generator/validate_definition.py \
  Tests/XContestCoreTests/SourceFixtures/custom-two-band-sprint.authoring-v2.json \
  --emit-runtime-draft /tmp/custom-two-band-sprint.runtime-draft.json
```

Use `--write-digest` only while authoring to replace `identity.contentDigest` with the digest of the complete envelope after that field is zeroed. `runtime.sourceProvenance` is explicit runtime metadata rather than derived authority; the validator requires it to surface every SHA-256 recorded by the envelope, but a reviewer must still verify those source records independently. The translator validates exact nested keys, bounds, finite integer types, the current core band plan, supported mode/ADIF/Cabrillo/report combinations, structured exchange and serial invariants, scoring-field references, and export projection coverage. It never imports or evaluates author content, emits Swift source, adds a definition to the runtime catalog, marks it reviewed, or claims sponsor submission readiness. The 94-plugin inventory remains source metadata until each semantic mapping receives its own review and acceptance evidence.

`convert_pinned_plugins.py` is the bounded source-to-authoring path for the first seven reviewed inventory records: four 10-10 seasonal plugins plus CWT, CW Open and ICWC MST. It checks the pinned upstream commit, exact source path and SHA-256, and reviewed literal declarations before applying one of the existing finite Ten-Ten or CW unique-call mappings. It emits deterministic v2 authoring envelopes and Swift-consumable runtime JSON under `Tests/XContestCoreTests/SourceFixtures/PinnedPluginDefinitions`, plus `docs/contesting/pinned-plugin-conversion-coverage.json` for all 94 inventory records:

```sh
CONTEST_SW_ROOT=/path/to/contest-sw python3 tools/contest_plugin_generator/convert_pinned_plugins.py
```

The converter verifies the actual upstream Git revision and hashes the seven source files before trusting the checked-in inventory. Reviewed golden inputs and expected outcomes live in the mapping document rather than translator code. These seven outputs intentionally reproduce the immutable v1 Swift factories and omit `operatorPolicy`; they are historical compatibility drafts, not operator-enabled definitions. Their acceptance constraints also preserve the outstanding sponsor, category, schedule and activation work. Every other inventory record is marked `converter-mapping-unavailable` with the semantic reviews needed to add it; this does not claim that xLog cannot support that contest. Source fingerprints and literal matches guard the reviewed mapping but do not establish semantic authority on their own. The generic `validate_definition.py` authored-v2 route remains available for future human-authored contest descriptions without changing the runtime catalog.
