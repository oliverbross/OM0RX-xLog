# Contest runtime and main 1.2.21 composition

18 October 2026, Australia/Darwin. Branch: `codex/contest-runtime-main-121`.

This conflict-free merge combines reviewed main compatibility checkpoint `6f0d94a321c6766038e9028d3ee8b6ffc7d7dfab` with reviewed declarative runtime/export integration `48d68ec014e006234aad1325d54feb0a9f634243`.

Root verified that the composed `Sources`, `Tests`, package manifests and contest portability workflow exactly match `48d68ec`, while the complete `prototype` tree exactly matches `6f0d94a`. No new implementation or conflict resolution is introduced by this composition.

| Verified subtree | Git tree object |
| --- | --- |
| Sources | `43140bf3b0f9b9b20da8db4b0fe58a94835f30b2` |
| Tests | `17281532d8bbf51fedac68377eca694a2747ac77` |
| prototype | `742b98768956d7dd24d569e2d380154aa751d46b` |

Validation is inherited only for these identical trees: the runtime integration manifest records core 164, store 80, history 15 and export 25 passes, and a 23-test operator suite with one opt-in browser test skipped; the main compatibility checkpoint records 316 frontend passes, production build and affected native checks. These suites were not rerun or relabeled as a new combined end-to-end rehearsal. Exact logs/hashes are in [the runtime manifest](evidence/declarative-runtime-base-integration-2026-10-18.json) and [the main compatibility checkpoint](MAIN_1_2_21_INTEGRATION_CHECKPOINT.md). Hosted CI for this new commit is a separate gate.

The catalog remains 16 active previews, 78 pending and zero fully ported entries. Seven versioned definitions remain inactive pending generic catalog/create/open/UI activation. Main 1.2.22–1.2.23, exclusive module ownership, full operator/feature acceptance and canonical packaging remain outstanding. This merge does not modify the canonical checkout or installed application.
