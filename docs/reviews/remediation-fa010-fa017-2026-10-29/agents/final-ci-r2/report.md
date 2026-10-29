# Final CI evidence R2

Final frozen canonical HEAD: `280f6db21c2bc7ccbf465cfa90beaa1a13af1bcb`. Application input commit: `c8cc1a134ee7fdacfb4b389f1648b47e18a059a1`, including authority validator correction `36d908d7959d9eaa518029bad3afca1c118767d7`.

`git diff --raw c8cc1a13 280f6db2` is retained as `xlog-finalci-r2-equivalence.diff`; only `docs/`, `RELEASE_READINESS.md` and `REMEDIATION_TRACKER.md` differ. A diff excluding those documentation paths exited zero. This establishes matching application, test and workflow inputs; it does not relabel the prototype workflow's actual source SHA.

| Workflow | Actual source | Result |
| --- | --- | --- |
| [CI 40846367663](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40846367663) | exact `280f6db2` | PASS |
| [Cross-platform prototype 40846092150](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40846092150) | automatic push `c8cc1a13`; code inputs equal final HEAD | PASS; macOS build/test job successful; operator packaging and runtime acceptance skipped |
| [Contest portability 40846611492](https://github.com/oliverbross/OM0RX-xLog/actions/runs/40846611492) | exact `280f6db2` test-only dispatch | PASS; all 7 jobs |

No exact `280f6db2` prototype workflow was triggered because its push path filter excludes these documentation-only changes. No `c8cc1a13` or `280f6db2` portability push run existed, so this task dispatched only the test-only `contest-portability.yml` after verifying remote main's exact SHA. No full prototype rerun, package/release/deploy dispatch, artifact installation, UI or production access occurred.

## Completed evidence

- Exact-head CI job `123354726332`: XCTest 330 tests, zero failures; Swift Testing reports 340 tests passed, with 12 explicit skips (11 disposable FTP/FTPS integration tests and generated-catalogue scale test). Automatic push packaging/resource verification succeeded; this task dispatched no packaging.
- Exact-head portability generator job `123355544377`: 42 generator and 7 reviewed dependency policy tests passed.
- Exact-head native portability jobs macOS `123355544633`, Ubuntu `123355545187`, Windows `123355544852`: each 64 bounded Rust tests passed across seven filters (24+7+1+16+3+6+7); zero failed or ignored.
- Exact-head Swift portability macOS `123355544611`, Ubuntu `123355544779`, Windows `123355544806`: discovery passed; broad contest run 227 XCTest plus 8 Swift Testing, 3 portable CW primitive tests, 1 cluster admission test and additional filtered regression runs passed. Windows also passed 6 ConnectionDoctor fallback and 8 remote backup revision tests. No explicit test-skip lines. Do not add overlapping runs as unique coverage.
- Prototype full portable Swift step: 1219 XCTest, 7 skipped, zero failures; Swift Testing reports 544 tests passed with 7 explicit skips. Frontend 4760 tests / 339 files passed. The original `BoundedSyncReconciliationTests.testLateRemoteAcknowledgementCannotWriteAfterDatabaseClose` passed in 0.555 seconds, directly shown in final raw log `xlog-finalci-r2-123353832039-final.log:8203`; full XCTest totals are at 10957-10959, Swift Testing total at 12382. The earlier `xlog-finalci-r2-prototype-running.log` snapshot is separately preserved.

## Prototype step and runtime conclusions

These are actual final GitHub conclusions from `xlog-finalci-r2-prototype-jobs-final.json`, not inferred from progression to a later step:

| Step/job name (verbatim) | Conclusion (verbatim) |
| --- | --- |
| Test complete portable Swift core (Unix) | success |
| Build desktop executable (not an installer acceptance claim) | success |
| Collect resolved dependency inventory and notices | success |
| Package macOS application | skipped |
| Upload macOS package | skipped |
| Package Linux runtime and Debian application | skipped |
| Package Windows portable runtime | skipped |
| Upload Linux runtime packages | skipped |
| Upload Windows runtime package | skipped |
| Upload development executables and evidence inputs | success |
| Save native dependency/build cache | success |
| Linux runtime-only container acceptance | skipped |
| Windows fresh-runner runtime acceptance | skipped |

The event is `push`, and the workflow matrix defaults to macOS unless dispatch input `build_platforms == 'all'`. The macOS operator package/upload steps require both macOS and `github.event_name == 'workflow_dispatch'`; Linux/Windows package/upload steps require their respective runner OS. The runtime acceptance jobs require explicit all-platform or runtime-run inputs. Therefore this successful automatic prototype run proves its macOS development build/tests, not operator packaging or Linux/Windows runtime acceptance. An interim message incorrectly inferred packaging success from progression to step 37; inspection of final step conclusions corrected that claim.

## Historical failed evidence remains

The previous report in sibling `final-ci/report.md` and its failed `4ec11a7` raw prototype log remain unchanged. Its late-acknowledgement SQLite failure remains historical failed evidence; the R2 log directly demonstrates the original test passing after the authority correction. This does not retroactively change the failed run's result.

## Raw metadata and logs

Sibling `xlog-finalci-r2-*.json` files retain raw GitHub run/job metadata, including final run and job metadata for all three runs. `xlog-finalci-r2-<job>.log` files retain raw complete job logs fetched directly through GitHub's API, captured to scratch before copying here. Build/test success does not establish installation, signing/notarization, provider credentials or physical-radio acceptance. Native/fixture tests and skipped live/performance acceptance remain separate boundaries.

Final local HEAD and remote main remained `280f6db21c2bc7ccbf465cfa90beaa1a13af1bcb`. The parent task was concurrently updating tracked documentation/evidence for closure; those expected documentation changes were identified and left untouched. This evidence task made no tracked edits or commits.
