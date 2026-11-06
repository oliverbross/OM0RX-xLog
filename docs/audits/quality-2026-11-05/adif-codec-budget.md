# ADIF codec startup-budget correction — source evidence

Committed source `d2f22973b86b6530acc7455aef694994478a603f` changes only LogbookPanel.tsx and the new codec-load component regression. No package, signed artifact, version bump, installation or release was produced by this correction.

Original [run42126127531/job127590690222](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42126127531/job/127590690222) remains FAILED on795f77c2: all 5256 Vitest tests/383 files passed, then Logbook startup graph 407119 B exceeded unchanged 405200 B. This was a post-build budget assertion, not a test flake. Original rawlog SHA33967c8d9c535e47b2e0cca24185e37c468a561e09035a8f524c20ce2708c981 is retained privately.

The correction loads the codec inside existing admitted async transfer handlers, keeping session ownership eager. It rechecks captured owner after module load before decoding/constructing/reading. Exact matching retirement, held-user draining, snapshot identity, duplicate consent and QSO rules remain unchanged. No budget/check was raised or removed.

Affected validation: 1456/1456 tests across 10 files PASS 55.87s, including two controlled cold-load cancellation cases plus delegated actual-codec export/import/visibleCancel controls. Standalone TypeScript PASS; canonical npm run build PASS including final TypeScript and the entire existing bundle gate. All 25 reported window graphs passed. Logbook is 381779 B (125495 gzip), leaving 23421 B below 405200. Codec is absent from its static graph; owner chunk remains. Full frontend suite after correction was not rerun.

Original CI used Node 22.23.4; local validation used 24.11.1. The observed graph difference 25340 B is not asserted as a same-toolchain benchmark or desktop CPU/memory result. Testlog SHA34ba342ec3b3b30a72748f1ea97027736c34643ad0328bb5eca6c07dd0a45771; buildlog SHA129e20fdded97d4994a965dbf5bda98a727e820fba7d0bd561cc23d9ddfb82e0. Full graph inventory and raw logs are retained under validation/.

Initial simultaneous pending-factory regression failure is preserved in focused-initial.log; final tests isolate each cold module case and retain real-codec positive controls. No assertion, deadline, budget or ownership guard was weakened. The earlier Windows blank-after-Finish remains unresolved and is not fixed or qualified by this source correction. Newly versioned coherent package/native gates remain pending.
