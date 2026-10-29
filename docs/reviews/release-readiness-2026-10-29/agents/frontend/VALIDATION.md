# Phase 7 frontend validation — 29 October 2026

Canonical checkout `/Users/oliver/Documents/Projects/OM0RX-xLog`, HEAD `b892663915cbc0768b26dc5a7bf7ec116869e409`; application inputs supplied as `f3f6e3de`. This agent performed frontend validation and external reporting only. No application, checked-in test, configuration, dependency lock, existing report or Git mutations; no native application/browser/GUI, live provider, credential, station, hardware, RPC or RF operation. The parent owns Git synchronization and all other validation areas.

**Mandatory frontend checks PASS. Existing FA-014 and FA-017 requirements still FAIL in fresh scratch reproduction.** A passing mandatory suite/build does not clear those findings or establish complete release acceptance.

## Fresh dependency and execution evidence

New stage: `/Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase7-validation-20261029-b8926639`. Only `package.json` and `package-lock.json` were copied into its new `frontend-deps` directory before `npm ci`. The original trees were reversibly renamed while the fresh installed dependencies ran from the canonical `prototype` path. No old tree was removed. The runner restored both originals in `finally` after all primary and scratch checks.

All check receipts and raw logs are under `/tmp/xlog-phase7-20261029-b8926639/checks/`, named by the IDs below. `run_check.py` records the exact argv, cwd, UTC start/end, elapsed seconds, actual process exit, timeout status, source HEAD start/end, source diff hash, log byte count and SHA256. `results.json` in this directory was generated only after verifying every log hash against its receipt. Every receipt has the same HEAD at start/end and an empty source diff hash (`e3b0c442…b855`). No command timed out.

| Check ID | Exact command | cwd | Exit | Seconds | Result |
| --- | --- | --- | ---: | ---: | --- |
| FRONTEND-NPM-CI | `npm ci` | stage/frontend-deps | 0 | 10.315 | 133 packages installed; install summary audited 134, zero vulnerabilities |
| FRONTEND-FULL-TEST | `npm test` | canonical prototype | 0 | 850.310 | 6 Node tests PASS, no skips; 4,742 Vitest tests / 339 files PASS |
| FRONTEND-BUILD | `npm run build` | canonical prototype | 0 | 36.638 | `tsc --noEmit && vite build && node scripts/check-window-bundles.mjs` PASS |
| FRONTEND-NPM-AUDIT | `npm audit --json` | stage/frontend-deps | 0 | 7.413 | zero vulnerabilities at every severity; metadata dependency total 167 |
| FRONTEND-TOOLCHAIN | `/opt/homebrew/bin/python3.12 /tmp/xlog-phase7-20261029-b8926639/frontend_toolchain.py` | canonical root | 0 | 1.325 | toolchain and lock provenance recorded |

The mandatory test command was unchanged: `npm run test:node && vitest run --maxWorkers=1`. It completed once, without focused reruns, timeout changes, skipped mandatory tests, changed assertions, or isolation changes. Vitest's own elapsed duration is 843.20 seconds; its suggestion to disable isolation was not applied.

Toolchain: `/usr/local/bin/node` v24.11.1, `/usr/local/bin/npm` 11.6.3, macOS 27.0.1 arm64. Locked versions: TypeScript 5.9.3, Vite 8.3.4, Vitest 5.0.3, React/React DOM 19.3.0, React Vite plugin 6.1.2. The canonical and copied lockfile SHA256 both equal `527b256030de0eb664c771b2a82275e8e83532d2f32d12167f3a5b5b6279609a`; package JSON SHA256 is `831ad8c0f81573dbeab8c66d75e4ece463a2b305a5dc2d382cb9f45a803c6d4c`.

The runner removed inherited XLOG_/XCW_ opt-ins without printing their values, used private per-check temporary directories, selected the explicit test Python, and denied contest UDP. The npm install/audit contacted the package registry as required by these checks; neither is an application provider operation.

## Bundle gates and warnings

All 24 window startup graph/budget checks passed, including the source-defined exclusions for main workspace, map and IQ UI, late CSS, isolated setup dialogs, recorder and analytics. Complete per-window byte/gzip/files lists are in the build log and `results.json`.

| Window | Startup bytes | Budget bytes | Headroom bytes |
| --- | ---: | ---: | ---: |
| Logbook | 405,194 | 405,200 | **6** |
| Cluster | 390,175 | 401,000 | 10,825 |
| QSO | 385,341 | 407,000 | 21,659 |
| Settings | 395,412 | 408,000 | 12,588 |
| Band Maps | 344,361 | 400,000 | 55,639 |

The six-byte Logbook headroom is freshly demonstrated for this toolchain and lockfile. It is fragile; this result does not establish equal output under another Node/toolchain version. No budget was increased.

Two warnings are retained rather than hidden:

- React reported `act(async () => ...)` without `await` in the Not1MM test “sends one native ESM operation with buffered fields and accepts its confirmed log even when CW fails.” That file's 195 tests passed; the warning remains a test maintenance limitation.
- Vite warned that some minified chunks exceed 500 kB. The Map chunk is 1,089.29 kB; the source-defined window graph/budget gates nevertheless passed. No warning threshold or splitting behavior was changed.

Some lean-ctx read/status calls returned a 120-second transport timeout while their underlying commands had already completed or continued normally. These are tool transport issues, not substituted command exits. Saved runner receipts/logs establish the results above. No command was restarted because of a transport timeout.

## Existing audit counterexamples rerun with fresh dependencies

The three phase 6 fixtures were copied byte-for-byte from `/tmp/xlog-phase6-fresh-20261029-0375a8e1/agents/frontend/` into this directory's `scratch/`. Only a new scratch config's root, fs allowance and cache path were changed to the canonical `/private/tmp/xlog-phase7-20261029-b8926639/agents/frontend/scratch` path. All tests import the current canonical component sources. Existing sources and original fixtures were preserved. Every scratch command explicitly selects this config and test root, native config loading, no cache, and one worker; no native application/backend/RPC executes.

The common argv prefix, run from canonical `prototype`, was:

```text
node /Users/oliver/Documents/Projects/OM0RX-xLog/prototype/node_modules/vitest/vitest.mjs run --config /tmp/xlog-phase7-20261029-b8926639/agents/frontend/scratch/vitest.config.mjs --configLoader native --cache false --maxWorkers 1
```

| Check ID | Added argv | Exit | Exact outcome |
| --- | --- | ---: | --- |
| FRONTEND-FA014-FORMS | `reversal.test.tsx` | 1 | 3 requirement failures, 2 passing controls / 5 tests in 2 files |
| FRONTEND-FA014-DETACHED | `detached-reversal.test.tsx` | 1 | 2 requirement failures, 1 passing control / 3 tests |
| FRONTEND-FA017-STOP | `fldigi-stop.test.tsx --testNamePattern 'fresh fldigi uncertain Stop'` | 1 | 1 requirement failure, 1 passing control; 195 original fixture cases intentionally skipped |

**Count accuracy:** Vitest substring filtering on `reversal.test.tsx` also selected `detached-reversal.test.tsx`. Therefore the first FA-014 run contains both form cases and all three detached cases; the second check repeats the detached cases and is not additional unique coverage. Across these scratch fixtures there are seven unique executed cases: four failing requirements and three passing controls. Scratch counts are separate from the 4,742 mandatory Vitest tests. The 195 skipped Not1MM cases in the narrow scratch run were already included and passed in the complete mandatory suite.

**FA-014 — reproduced requirement failure, no harness/environment failure.** Full form reversal returns effective automatic intent to true while displaying `2026-10-20 10:15:30` instead of the fake current UTC `2026-10-28 12:34:56`; the Desk form control passes. Actual DetachedQSOSurface plus actual OperatorDraftSession, with the inspected native timestamp contract emulated at the backend mock, dispatches only `save` and retains automatic provenance. Both rapid Save and blur/focus plus 1,500 ms timer advancement display October 20 while the emulated saved contact is October 28. The Full→Simple→Full remount control passes. Assertions fail on the displayed/saved date mismatch, after collection and execution, rather than import/alias/timer setup errors. Relevant current buffer precedence remains in `QSOEditorCore.tsx:183-190,206-208`. This JS evidence does not execute Swift persistence or prove a production operator mutation.

**FA-017 — reproduced requirement failure, no harness/environment failure.** The actual Not1MM workspace receives a fulfilled mocked fldigi Stop response containing both release flags true and an explicit unconfirmed-release status. It hides the dedicated Stop/warning and projects `disarmed`, including after the setup-owner callback performs another Stop/readback. The surface Escape action adds zero fldigi Stop calls (2 before/2 after) and one CW Stop. The assertion fails because expected `uncertain` is observed `disarmed`; the confirmed-Off/false-release-flags control passes. This models the audited completed-macro/retained-duty state. It does not contact fldigi, execute RPC/RF, establish that RF is on, defeat the native transmit guard, or show that every possible recovery route is unavailable.

The broad existing tests therefore do not cover these two interactions sufficiently to close them. They remain the existing final-audit findings, not newly claimed introduced regressions. This validation applies no repairs.

## Preservation and limits

`preservation.json` verifies original `prototype/node_modules` directory inode **560040948** before and after restoration; all **180 original dist files / 5,745,506 bytes** match their original SHA256 entries; all **983 tracked prototype file hashes** match before/after. Before/after manifests and original dist hashes are retained here. Final read-only `git status --short` was empty. Fresh dependencies remain at stage `frontend-deps/node_modules`; newly generated build output remains at stage `frontend-generated-dist`, separate from the restored original `prototype/dist`.

No package, signed bundle, installation, deployment, version change or release artifact was produced. Type checking/build/unit/component tests and npm advisories do not establish native GUI/keyboard/menu/unsaved-work behavior, true cross-process IPC/persistence, bundled runtime acceptance, signing/notarization, current provider credentials, hardware or RF acceptance. Backend semantics in both audit probes are mocked. This agent did not execute browser/native acceptance or retry any previously blocked custom Swift proof binary. npm audit is bounded to the queried npm dependency advisory result; it is not a source security review or evidence for other ecosystems.
