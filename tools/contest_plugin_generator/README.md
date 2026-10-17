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

`definition_schema.json` is a draft authoring interchange for a later Create Contest flow. `validate_definition.py` validates draft shape and immutable digest only. It cannot mark a definition reviewed, accepted, or active. Runtime definitions must map to the existing `ContestRuleMetadata`, `ContestEntryDescriptor`, parser, store and export services after a separate authority and differential acceptance gate.
