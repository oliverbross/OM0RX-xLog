# Executed command/proof index

All commands used canonical `/Users/oliver/Documents/Projects/OM0RX-xLog` or
its `prototype` directory explicitly. Tool inspections used lean-ctx. Source
reads/ranges are listed in coverage.json; raw full assigned diff is diff.txt.

1. `git status --short`, `git rev-parse HEAD`: clean0ce97a12 at start and finish.
2. `git diff 530de4c4e4b23281ec60585cc7a2e5ca011476fb..HEAD -- <assigned8files>`:
   diff.txt. No fetch/pull or git mutation was delegated to this read-only auditor.
3. `python3 .../prepare_probe.py`: created scratch fixture prefix from current
   DetachedQSOSurface test mocks, using absolute original source imports. Scratch
   node_modules is a symlink to existing node_modules; original tree unchanged.
4. `node node_modules/vitest/vitest.mjs run --config .../vitest.config.mjs`:
   manual-remount.log, initial config-loader /@fs setup failure, no tests executed.
5. `node node_modules/vitest/vitest.mjs run --configLoader native --config .../vitest.config.mjs`:
   manual-remount-r2.log(one requirement case), manual-remount-r3.log(three cases),
   manual-remount-final.log(final five cases). Exit1 is the intentional expected
   requirement regression, not harness failure for r2/r3/final.
6. `git show 530de4c4...:prototype/src/live/{QSOEditorCore,OperatorDesk,DetachedQSOSurface}.tsx`:
   exact baseline bodies retained as *.baseline.tsx, then import paths rewritten
   by prepare_baseline.py. Only frontend comparison bodies differ.
7. `node node_modules/vitest/vitest.mjs run --configLoader native --config .../vitest-baseline.config.mjs`:
   manual-remount-baseline.log, first three cases compared, frontend-only origin.
8. `node node_modules/vitest/vitest.mjs run --configLoader native --maxWorkers=1 src/live/DetachedQSOSurface.test.tsx src/live/operatorDraftSession.test.ts src/live/OperatorDesk.test.tsx src/live/QSOEditorPower.test.tsx src/live/adifTransfer.test.ts src/live/adifTransfer.schema.test.ts`:
   targeted-tests.log, 1431 PASS / 6 files.
9. `node node_modules/vitest/vitest.mjs run --configLoader native --maxWorkers=1 src/live/QSOEditor.test.tsx src/live/operatorDraftPowerSession.test.ts src/live/operatorDraftTransport.test.ts`:
   targeted-time-transport.log,55 PASS /3files.
10. `python3 .../static_proofs.py`: static-proofs.json and source-sha256.json,
    exact XSD vocabulary equality and dependency lock versions.
11. `python3 .../prepare_ipc_probe.py`: exact production Rust functions copied to
    ipc-validator.rs, metadata in ipc-validator-source.json.
12. `rustc --edition=2021 .../ipc-validator.rs --extern serde_json=prototype/src-tauri/target/debug/deps/libserde_json-9f28204eae963b24.rlib -L dependency=prototype/src-tauri/target/debug/deps -o .../ipc-validator && .../ipc-validator > .../ipc-validator.log`:
    BLOCKED before any segment by lean-ctx scratch-executable allowlist. No binary
    compile or run occurred; no dynamic native role-gate proof claimed.

All ellipses above name `/tmp/xlog-phase6-20261029-0ce97a12/agents/frontend`.
The earlier inline python attempt was blocked; the same work was expressed as
an explicit reviewable scratch Python script as the tool instruction directed.
No permanently blocked executable command, outside-root read, or allowlist override
was retried using another execution surface.

Security follow-up: global TS/TSX sink search with rg wrote `security-sinks.txt`;
targeted ctx_read source ranges are in coverage.security_followup. Additional
native role, retained-report identity, read-radio recovery and constant sponsor
URL producers were read without executing application or provider effects.
`python3 .../append_security_coverage.py` appended the machine-readable coverage;
`python3 -m json.tool .../coverage.json` validated it. Final git status remained
clean0ce97a12. No additional test suite was repeated for this source-only pass.

MainLiveApp completion: ctx_read windows in MAIN_BODY_COMPLETION.md completed
all previously unread body ranges217-1477 and caller209-214. Numbered full body
copy archived via `nl -ba prototype/src/LiveApp.tsx | sed -n '217,1477p'` into
MainLiveApp-reviewed-source.txt. complete_main_coverage.py updates source-read
completion without asserting all behaviors certified. Final git status/hash
unchanged; no tests repeated.
