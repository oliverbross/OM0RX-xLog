# Call-history integration checkpoint

18 October 2026. The `codex/contest-history-integration` merge combines shared-policy integration `74ef3ba0549c84b5b436e1c5d7a421f0daa328cf` with reviewed call-history source `8ff0e5317e891bf0dacbb1f2e366b9b809b4aaa4`.

The two client-file conflicts were resolved by preserving both operator capability/readiness validation and the history mutation contract. The lane retains the existing strict Boolean check with conditional CoreFoundation support; a duplicate helper introduced by the automatic merge was removed. Root reviewed the resulting client, lane, rule-engine, workspace and type diffs and verified their supplied hashes.

## Validation

The combined portable Swift run passed **155 core, 80 store and 63 support tests (298 total)**. A supplemental 30-test shared-policy/operator run also passed; it overlaps the first run and is not 30 additional distinct tests. Frontend validation passed two Node assertions and **198 Vitest tests across 20 files**, followed by TypeScript, Vite and window-bundle checks. These are tests of the merged product tree before the merge commit; subsequent edits are documentation only.

| Evidence | SHA-256 |
| --- | --- |
| `/tmp/xlog-history-integration-swift.log` | `f36e0b5ebc405c12f8e3510c9415bc5362b72f33906d3393b7ffbcbc120d5baa` |
| `/tmp/xlog-history-integration-swift-shared.log` | `7a3e116967be4bb97ca673d81a85f2eabb383d52611f9a6814e4cd20a092f5b7` |
| `/tmp/xlog-history-integration-frontend.log` | `9c16b20c0b5e2f278bd0550087420a2f255fe4cb12ac159938d463c631487159` |
| `/tmp/xlog-history-integration-build.log` | `1547de8009483c5eadc4e1f894a69f9f7d5b5be30b47dd2b91791a65c20483b7` |

Root also verified all 19 frozen source hashes and ten log hashes in `evidence/call-history-phase2b-2026-10-18.json`. The final repair suite exercises forged values, unrelated edits, occupied targets, replaced datasets, stale revisions, structured name prefill, zero-QSO mutation and historical replay after a later edit.

## Boundaries and next work

History uses a private local preview, explicit record selection and explicit blank-field application. It does not commit a QSO or overwrite an occupied field. The existing eight-family allowlist remains; extending history projection to further definitions is still work. Fresh browser-to-worker history import/select/prefill/recovery acceptance and native-picker/package checks remain open.

Exact-merge hosted CI has not run at this checkpoint. Both parent capability integration `65d617f` and shared-policy integration `74ef3ba` passed all six native platform jobs and regular CI; those results are not substituted for this merge's CI.

The 14-profile, 84-contact CW/SSB Run/S&P harness is still a development candidate. Declarative export source is under review. The catalog remains 16 active previews, 78 pending entries and zero fully ported contests, with seven inactive declarative definitions. Final main-app integration awaits the latest accepted installed-source handoff from the task working on 1.2.21–1.2.23. No canonical checkout, installed application, radio output or user database was changed here. The pre-existing Excel lock remains untracked and untouched.
