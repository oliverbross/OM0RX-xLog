# Windows-only 1.5.20 recheck — FAILED; diagnostic unavailable

[Run 42034725192](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42034725192) executed QA controller **2dc63d1e7654c92d0d5614085427e36e9ef1ab72** against unchanged version 1.5.20/package source **3d9cb0981c30764f1188db350ffebc22a5f328a7**, artifact 13413349502 from original run 42016723457. Package artifact SHA-256 3869a453e665320c4fe19662595b616cebb61d8217a1e6ea80a99ac99db3d41f. No application build, repackaging, version bump or deadline change occurred. Executor/package identities are separately confirmed in both qa-executor receipts.

| Job | Conclusion |
|---|---|
| [Windows fresh-runner runtime acceptance (perMachine)](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42034725192/job/127269787220) | FAILURE |
| [Windows fresh-runner runtime acceptance (currentUser)](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42034725192/job/127269787471) | FAILURE |
| [prototype](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42034725192/job/127269788438) | SKIPPED |
| [Linux runtime-only container acceptance](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42034725192/job/127269788992) | SKIPPED |

Build and Linux jobs were skipped as requested. Both fresh Windows scopes passed portable native acceptance, then repeated the installed local-logbook assertion failure.

| Scope | Normalized observed default | Installed assertion | Paired diagnostic |
|---|---|---|---|
| currentUser | %LOCALAPPDATA%\OM0RX-xLog | FAIL | diagnostic-unavailable / 0 runs |
| perMachine | %ProgramFiles%\OM0RX-xLog | FAIL | diagnostic-unavailable / 0 runs |

Early installed worker replies are now retained in both scope artifacts: id local-logbook-self-test, **ok:false**, error code **local_self_test_failed**, message “Local logbook acceptance failed.” No result/count fields are present. This establishes an actual failed self-test response; it does not identify its underlying stage/cause. Actual worker exit was not retained because the unchanged assertion throws before Finish-Worker; **scope step exit1** is observed. Do not equate that with a captured worker exit.

Both diagnostic steps failed separately at **diagnose-windows-local-self-test.ps1:289**: a PSNoteProperty was passed into the Boolean Condition parameter. Both diagnostic JSONs explicitly report diagnostic-unavailable, runs=[], maximumRuns 6 and unchanged 10-second deadline. **No child probes, stdout/stderr identity records or A/B/A outcomes were produced.** No TEMP/path-length cause or application fix is inferred.

Both scopes retained observed default-path/registry/Start Menu/payload partial passes. Installed GUI, uninstall and marker-retention checks were not reached. Install paths are publicly normalized from actual successful raw default/equality checks to the known-folder tokens above; raw CWD/TEMP/profile/PID/marker coordinates remain private. Both hosts were elevated; ordinary-user/UAC/upgrade/hardware qualification remains NOT RUN.

| Artifact | ID | Bytes | ZIP SHA-256 |
|---|---:|---:|---|
| xlog-acceptance-windows-currentUser-3d9cb0981c30764f1188db350ffebc22a5f328a7 | 13418820852 | 433188 | b8201385dc781331009fba140162305ee289076f624bb2e656899b565236e520 |
| xlog-acceptance-windows-perMachine-3d9cb0981c30764f1188db350ffebc22a5f328a7 | 13418750052 | 327517 | f636ddd4a7933bebc14c249a20deef2591c4e8cfca85d32b2f7180121ccc6cb3 |

Both artifact ZIPs were downloaded and digest-verified; final scope logs and early raw replies are privately retained and hashed in ci-disposition.json. QA CI42034636599 passed. Verified redundant Mac-only push42034636629 was cancelled, not passed. Original [run42016723457](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42016723457) remains failed; no result was replaced. No retry or source change was performed by this monitoring task.
