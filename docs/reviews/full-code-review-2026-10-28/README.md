# Full-review evidence

Source: canonical `main` at `4bd554a25951ddc995b4bef1715d3df12918a07b`.
Root CODE_REVIEW.md and REVIEW_COVERAGE.md are the consolidated authority.
This directory contains review artifacts and synthetic evidence only.

`REVIEW_INVENTORY.tsv` covers all baseline tracked files; `SCAN_HITS.tsv` contains
unvalidated pattern locations, without matched data. `checks/` preserves complete
suite/build/audit outputs, including the failed full npm run and limited reruns.
`results/` contains counterexamples, `reproductions/` their sources, `subreviews/`
bounded reports, and `sources/` exact external-rule provenance. `SOURCE_INDEX.txt`
records baseline Git blob/mode identities. `SHA256SUMS` is an integrity aid, not
an authentication signature.

Readable `.txt` logs normalize line-ending whitespace for Git. Their `.txt.gz`
companions preserve the exact original captured bytes, including failures.

Original work is retained under `/tmp/xlog-review-20261028-4bd554a/` and fixtureRoot
paths in results. Nothing unique was cleaned up. Scripts retain their exact
original paths: restore them to that isolated directory or adjust only artifact
paths for a fresh run. Never point a probe at a real workspace database.

## Check commands

From `/Users/oliver/Documents/Projects/OM0RX-xLog`:

```sh
git fetch origin main
git merge --ff-only origin/main
git status --short --branch
git rev-parse HEAD
swift test --no-parallel
XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/prototype-tests --no-parallel
PYTHONPATH=python python3.12 -B -m unittest discover -s python/tests -v
python3.12 -B tools/check_all_contests_readiness.py --output /tmp/xlog-review-20261028-4bd554a/contest/all-contests-readiness.json
cargo test --locked --manifest-path prototype/src-tauri/Cargo.toml
cargo audit --version
bash -n prototype/scripts/package-macos.sh prototype/scripts/install-macos.sh prototype/scripts/build-worker.sh prototype/scripts/notarize-macos.sh
zsh -n scripts/package-app.sh scripts/notarize-release.sh
git diff --check
```

From `prototype`:

```sh
npm test
npm run build
npm audit --json
node node_modules/vitest/vitest.mjs run src/contesting/Not1MMContestWorkspace.test.tsx -t 'simulates only claimed.*voice-keyer intents' --maxWorkers=1
node node_modules/vitest/vitest.mjs run src/contesting/Not1MMContestWorkspace.test.tsx --maxWorkers=1
```

Commands used lean-ctx and captured stdout/stderr. Stalled/unlaunched MCP jobs
were not counted as completed checks; explicit-cwd CLI executions supplied final
build/native results. The initial npm failure remains a failure. No release script
was executed. See bounded reports for additional exact commands and fixture setup.

## Real SQLite probes

After the normal Swift test build, these linked the exact unmodified XLogCore
objects; there are no core/parser/database stubs in these two reproductions:

```sh
swiftc -emit-library .build/debug/XLogCore.o .build/debug/CCurlBackup.o -lcurl -lsqlite3 -lz -framework Security -framework Network -framework LocalAuthentication -o /tmp/xlog-review-20261028-4bd554a/libReviewCore.dylib
swift -I .build/debug -Xcc -fmodule-map-file=.build/out/Intermediates.noindex/OM0RXXLog.build/Debug/CCurlBackup-t.build/CCurlBackup.modulemap -L /tmp/xlog-review-20261028-4bd554a -lReviewCore /tmp/xlog-review-20261028-4bd554a/repro_manual_time.swift
swift -I .build/debug -Xcc -fmodule-map-file=.build/out/Intermediates.noindex/OM0RXXLog.build/Debug/CCurlBackup-t.build/CCurlBackup.modulemap -L /tmp/xlog-review-20261028-4bd554a -lReviewCore /tmp/xlog-review-20261028-4bd554a/repro_core_interpreted.swift
```

CR-001 reopens real SQLite and reads the receipt. CR-009 executes the caller's exact
data loop with real core APIs, without AppKit chooser/banner interaction. A first
compile missed CCurlBackup's module map; the corrected commands above passed.
Custom executable invocation was blocked; permitted Swift interpreter fixtures
completed the checks without changing tooling policy.

## Host and UI probes

```sh
python3.12 -B /tmp/xlog-review-20261028-4bd554a/contest/repro_recorder_esm.py
python3.12 -B /tmp/xlog-review-20261028-4bd554a/contest/repro_wae_call_area.py
python3.12 -B /tmp/xlog-review-20261028-4bd554a/contest/repro_import_shared_serial.py
python3.12 -B /tmp/xlog-review-20261028-4bd554a/contest/repro_import_replica.py
```

Actual Host functions run against disposable synthetic roots. Exit 0 confirms the
counterexample. Root independently reran all four scripts. From `prototype`, root
also ran the final actual-React cases:

```sh
node node_modules/vitest/vitest.mjs run --config /tmp/xlog-review-20261028-4bd554a/frontend/vitest-review.config.ts -t 'REVIEW retains manual UTC|REVIEW.*radio.output'
```

Two expected intended-behavior assertions fail; 47 copied unrelated tests skip.
Canonical `automaticStart:false` is explicit. Two earlier mocked-Save cases are
retained in the file for audit but withdrawn as insufficient production evidence;
do not run them as accepted findings. The root report explains their missing
native automatic-time behavior.

## fldigi probe

The generator concatenates the complete unmodified actor, neighboring-interface
stubs and fake RPC. No actual engine/socket is used; stub parsing is not exercised.

```sh
swiftc -emit-module -emit-library -module-name XLogCore /tmp/xlog-review-20261028-4bd554a/native/fldigi_core_stubs.swift -o /tmp/xlog-review-20261028-4bd554a/native/libXLogCore.dylib -emit-module-path /tmp/xlog-review-20261028-4bd554a/native/XLogCore.swiftmodule
python3 /tmp/xlog-review-20261028-4bd554a/native/make_fldigi_script.py
swift -I /tmp/xlog-review-20261028-4bd554a/native -L /tmp/xlog-review-20261028-4bd554a/native -lXLogCore /tmp/xlog-review-20261028-4bd554a/native/fldigi_interpreter_repro.swift
```

Root independently reran the interpreter and confirmed both unowned `main.rx`
calls. This is actor boundary evidence, not native GUI or physical-engine proof.
