# Windows-only 1.5.20 ca7 recheck — FAILED; diagnostic aborted before Resume

[Run 42036670843](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42036670843) executed QA controller **ca7dfbaeddf2ae72cc601a5f3d98f4d8c86166a9** against unchanged package source **3d9cb0981c30764f1188db350ffebc22a5f328a7**, version **1.5.20**, artifact 13413349502 from original run 42016723457. No application rebuild, packaging, version, path policy, assertion or deadline change occurred.

| Job | Conclusion |
|---|---|
| [Windows fresh-runner runtime acceptance (currentUser)](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42036670843/job/127276514615) | FAILURE |
| [Windows fresh-runner runtime acceptance (perMachine)](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42036670843/job/127276514960) | FAILURE |
| [prototype](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42036670843/job/127276516772) | SKIPPED |
| [Linux runtime-only container acceptance](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42036670843/job/127276517128) | SKIPPED |

Both installed scopes again retained **ok:false / local_self_test_failed**, message “Local logbook acceptance failed.” Actual installed worker exit remains **UNOBSERVED**; the scope step exited 1 after its unchanged assertion. Real silent default-path, registry and shortcut partial passes remain recorded. Public defaults normalize actual equality-checked roots to %LOCALAPPDATA%\OM0RX-xLog and %ProgramFiles%\OM0RX-xLog; raw CI/profile/process coordinates remain private. Installed GUI, uninstall and marker retention were not reached.

Each host's diagnostic created **one owned suspended portable/A child**, then failed **“OS image/PID/PPID proof failed before Resume.”** Identity verification stayed false. Both cleanup receipts confirm **resumed=false, abortedBeforeResume=true, exitConfirmed=true, supervisor abort exit125**, with **0 stdout / 0 stderr bytes**. These abort codes are not application self-test exits.

Actual independent OS PID, parent PID, ExecutablePath, CommandLine, QueryFullProcessImageName and CreationTime operands were **NOT RETAINED**. Only requested command line and returned CreateProcess PID are recorded privately. The missing operands prevent identifying the failed comparison; no OS-proof relaxation or cause is inferred.

Therefore **zero self-test probes resumed**, no short-TEMP/B or repeat-A case ran, and **no A/B/A or path-length conclusion exists**. Both diagnostic statuses are diagnostic-unavailable, one record each, maximumRuns 6 and response deadline 10 seconds unchanged.

| Artifact | ID | Bytes | ZIP SHA-256 |
|---|---:|---:|---|
| xlog-acceptance-windows-currentUser-3d9cb0981c30764f1188db350ffebc22a5f328a7 | 13419605022 | 332570 | 89aa076327f75e40c4ca9a41c9bea920dc3604ff652e768d7ddc2bd062a94775 |
| xlog-acceptance-windows-perMachine-3d9cb0981c30764f1188db350ffebc22a5f328a7 | 13418822863 | 334457 | 641c8dc292c33732ff0b50fafa1bd5df75aa6bd05493805916582b4275dc3b48 |

Both artifact ZIPs and final logs were downloaded/hash-verified. QA CI 42036582773 passed; redundant single-Mac push 42036582952 was cancelled, not passed. Original20 and initial QA2dc failures remain immutable. No retry/source edit was performed by this monitoring task.
