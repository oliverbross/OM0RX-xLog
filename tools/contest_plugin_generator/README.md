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

The required corpus check fails rather than skips when the external checkout is absent, on a different commit, has any included or excluded plugin bytes that differ from the ledger SHA-256 values, or differs from the checked-in inventory:

```sh
/opt/homebrew/bin/python3.14 tools/contest_plugin_generator/verify_pinned_corpus.py \
  --upstream /Users/oliver/Documents/Projects/contest-sw \
  --ledger docs/contesting/contest-acceptance-ledger.json \
  --inventory docs/contesting/generated/python-plugin-inventory.json
```

Unit tests use `CONTEST_SW_ROOT` when set. Corpus tests visibly skip when it is unavailable; they do not replace the required check above.

`definition_schema.json` keeps the historical `1.0.0` draft interchange and adds a strict `2.0.0` authoring envelope. Version 2 uses only the finite policies already implemented by `ContestDefinitionDraft`; it is not an expression language and cannot request an adapter. Runtime-blocking omissions belong in `constraints.runtimeUnresolved` and prevent translation. Sponsor, category, schedule and activation gaps belong in `constraints.acceptanceUnresolved` and remain visible without changing runtime semantics.

Validate a v2 envelope and emit sorted JSON that Swift decodes directly as `ContestDefinitionDraft`:

```sh
/opt/homebrew/bin/python3.14 tools/contest_plugin_generator/validate_definition.py \
  Tests/XContestCoreTests/SourceFixtures/custom-two-band-sprint.authoring-v2.json \
  --emit-runtime-draft /tmp/custom-two-band-sprint.runtime-draft.json
```

Use `--write-digest` only while authoring to replace `identity.contentDigest` with the digest of the complete envelope after that field is zeroed. `runtime.sourceProvenance` is explicit runtime metadata rather than derived authority; the validator requires it to surface every SHA-256 recorded by the envelope, but a reviewer must still verify those source records independently. The translator validates exact nested keys, bounds, finite integer types, the current core band plan, supported mode/ADIF/Cabrillo/report combinations, structured exchange and serial invariants, scoring-field references, and export projection coverage. It never imports or evaluates author content, emits Swift source, adds a definition to the runtime catalog, marks it reviewed, or claims sponsor submission readiness. The 94-plugin inventory remains source metadata until each semantic mapping receives its own review and acceptance evidence.
