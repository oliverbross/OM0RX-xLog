# Second-pass commands and results

Working directory: `/Users/oliver/Documents/Projects/OM0RX-xLog`.

1. Provenance / interpreter (rechecked at conclusion):

```sh
git status --short --branch
git rev-parse HEAD
git diff --stat 4bd554a25951ddc995b4bef1715d3df12918a07b HEAD -- Sources prototype python tools .github Package.swift
command -v python3.12
python3.12 --version
```

Result: clean `## main...origin/main`; HEAD `12824393f2799f21c223fadcb19d03305a5bf2f8`; application diff empty; `/opt/local/bin/python3.12`, Python 3.12.4.

2. New real-Host contract probe:

```sh
PYTHONPATH=python:python/tests XLOG_CONTEST_N1MM_UDP_ALLOWED=0 python3.12 -B /tmp/xlog-review-verification-20261028-12824393/contest/verify_contracts.py > /tmp/xlog-review-verification-20261028-12824393/contest/verification-stdout.log 2>&1
```

Result: exit 0; all assertions passed. Machine-readable results in `verification-results.json`; real isolated stores under `data-56bd2487-ddc2-4300-b146-f835fac3f631/`. The script creates a fresh UUID data directory on every run; a rerun replaces only its two result files, not prior synthetic roots. Requires the already-retained pinned DARC rules HTML in `.build/wave5/rules/darc-wae-rules.html`; performs no network retrieval.

3. Proportional existing regression tests:

```sh
PYTHONPATH=python:python/tests XLOG_CONTEST_N1MM_UDP_ALLOWED=0 python3.12 -B -m unittest -v test_recorder test_wave5_qtc_host test_wave5_adif_host test_multi_operator_host test_review_replica_authority test_review_adif_import test_host.HostTests.test_esm_disabled_enter_commits_without_output_and_manual_keys_still_work test_cq_ww_ssb_host.CQWWSSBHostTests.test_ssb_run_and_s_and_p_esm_emit_voice_intents_and_commit > /tmp/xlog-review-verification-20261028-12824393/contest/focused-tests.log 2>&1
```

Result: exit 0, `Ran 41 tests in 19.224s`, `OK`. These suites pass while the four edge cases remain; their current assertions do not cover the failing contracts demonstrated by the new probe.

4. Coordinated native consumer proof (run by native agent; exact build/run command is owned by that agent): unchanged Rust recorder store, offline isolated Cargo harness and synthetic PCM. Result in `../native/recorder-store.log`, source harness `../native/verify_recorder_store.rs`. Reported result: ESM local=false with valid marker omitted; direct local=true control linked; durable cursor 2; reopen/replay still omitted. This child did not run audio or native UI.

Source reads/searches used lean-ctx MCP tools, with independent inspections batched in `functions.exec` via `Promise.allSettled`. An outside-project `ctx_read` attempt was denied by lean-ctx's project-root filter; needed temporary evidence was read through bounded shell/archived output. This was a tooling access limit, not an application result. No dependency installation or app mutation occurred.
