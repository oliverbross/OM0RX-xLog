# Linux 1.5.22: separate unchanged-byte runtime recheck passed

The separately authorized [runtime-only run42150401167](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42150401167), attempt1/job127671986339, passed. It used QA executor `b66c433c9e9d8913713202cff93c12863bb6dbc1` and the original candidate package version1.5.22/source `fc7909d63aa0f4d9fd9abf278c2b08bfd557cdd5`. Linux beta packages are not publisher-signed; source identity and byte integrity are recorded separately from authenticity.

No application was rebuilt. Build and Windows jobs were skipped. The root-authorized dispatch used build_platforms=linux, validation_only=true, package_macos=false, runtime_run_id42139380197, runtime_source_shaS22 and runtime_platform=linux. Exactly one follow-up was dispatched; no automatic retry/cancellation occurred.

The [numeric audit receipt](linux-runtime-1.5.22-audit.json), SHA256 `03685a78ef4c3115fcde5b7e7d338f08cec6ad977e83b93aac3c65a2be19ecd3`, binds actual reports, payload/worker checks, process cleanup and limits. It omits process IDs, profile/root paths and session identifiers. The raw completed log is276,772bytes, SHA256 `c73c3a10b068900902c3fe2fee532be7237e2f7da697cdb322bd027c25b6824e`.

## Same original S22 bytes

The actual download log names original package run42139380197/artifact13469437610,315,737,277bytes, expected digest and measured digest both `7c2a9190aaa51c5718a5bf94cabf0cdcac186d6f885533341e910c49f383f64a`. The package was not rebuilt or replaced with executor assets. The runtime manifest hash was the original `0c8fb741077f7cee67b8896d0d3ef9b1a54194aedb1d923edcd2a4b3d98251c1`; source/version and all1,013installed scan entries matched the independently audited original package. Installed and relocated payload hash checks passed.

The accepted payload's host hash is `c7792597cf96e1990290b665b95d86dd1b6dcf993d986b72785b92d6b19bd612`; worker hash is `04df0354db564ff1174e853fee20b0fbe0af2c5a700eca9cb83ae3c0264c1fa1`. The executor's changed paths were QA workflow/harness/diagnostics/tests only; application/version/config/lock/package-recipe inputs were unchanged from S22.

The runtime ran as UID10001 in a container launched with network none and cap-drop ALL. No Swift/Rust/Node/development tools were admitted. Installed and relocated direct-worker receipts passed core self-test, hard192 local logbook/backup-restore,98contest definitions and two framing cases each; network/station/credential flags were false. Original CLI bounds remain unchanged: core self-test10s, local self-test30s, contest self-test120s and direct framing-child EOF wait5s. These direct CLI checks are distinct from the app-owned GUI workers below.

## Four actual native GUI reports

| Journey | Payload/backend | Actual report | Host / timeout-wrapper waits | Cleanup |
|---|---|---|---|---|
| ui-1 | Installed DEB / X11 |36/36true |0 /0 | Host and one observed worker absent |
| ui-2 | Installed DEB relaunch / X11 |36/36true |0 /0 | Host and one observed worker absent |
| ui-3 | Relocated archive / X11 |36/36true |0 /0 | Host and one observed worker absent |
| ui-wayland | Installed DEB / native Wayland |36/36true |0 /0 | Host and one observed worker absent |

Each report had schema1/statuspassed/scopeintegrated-local-ui, embedded UI and worker true, Linux platform, no production singleton and station I/O false. Finite labelled validation summaries matched each raw report hash with36true/0false/0other and no error hash. All four1600×1100screenshots were retained. Static inspection of the Wayland screenshot showed the rendered Desk/map/band-map and a `Native automatic rotor status unavailable` toast. The toast is outside the36checks; no hardware availability or cause/fix is inferred.

Wayland was Weston nested on X11 using pixman, with DISPLAY removed for the application. This is not a physical desktop or direct headless-compositor test. All four layoutConflictRecovered fields were false: the normal paths passed, but this run did not exercise the conflict-recovery branch. Its source regressions remain separate evidence.

## Actual owned-process outcomes and evidence recovery

Each supervisor retained its actual host identity and original owned handle. Actual host wait and GNU timeout-wrapper wait were0; application signal lists were empty and hostNormalExittrue. Receipts positively matched one direct worker per host, and final inventory covered each host plus its observed worker, all absent. Application deadline100s and Wayland kill-after5s were unchanged.

**Worker wait/EOF stays UNKNOWN:** workerWaitReturnCode wasnull and workerEOFunknown-not-observed in every app-owned worker receipt. Observed absence is not an invented exit0/EOF. The inventory covers only host and observed workers, not every shared WebKit/helper process.

Weston had planned owned TERM cleanup, actual wait0 and final absence, no cleanup errors. Its ordinaryExit flag was false, correctly distinguishing helper cleanup from an ordinary application exit. No application TERM/KILL was used.

The always-running finite evidence ownership recovery passed52entries/0errors, after which all55report files uploaded. The acceptance ZIP833,420bytes matched digest `2c681f7189608e618cbb9eb9059d85686f5b530d4c882cbd1b0bfcd2ebfe2a99`. No packaged binary/process or UI was launched by the read-only auditor; only retained bytes/reports and one static screenshot were inspected.

## Original failure remains preserved

The [original run42139380197](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42139380197) remains FAILED. Its unlabelled stdin line5 assertion cause is UNKNOWN: X11 scope versus Wayland schema/status could not be distinguished. Its original GUI/cleanup reports were lost to an EACCES upload failure and were not recovered by this later run. The later ownership/diagnostic correction and separate passing run do not prove that original assertion was transient or repair an established application defect.

See [original disposition](ci-1.5.22-original.md) and [combined bounded qualification](ci-1.5.22-packaged-qualification.md). Ordinary Linux desktop, equipment/RF, memory/CPU budgets, notarization, daily installation and public release remain outside this container/synthetic observation.
