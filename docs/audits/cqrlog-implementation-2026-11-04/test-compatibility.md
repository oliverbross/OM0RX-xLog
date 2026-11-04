# Final validation compatibility repairs

The signed 1.5.13 application remains built from
`75cb1fbe78791b47735e7d81e7e42e3404dc7010`, ZIP SHA-256
`b21af154b96632159236dda7d4249ff0cc95f377ad9e549f364ac7b2c3867929`.
After its native acceptance, remote CI exposed two test-only compatibility
failures. Neither required a product, build-configuration or workflow change.

* All-platform validation 41866246884, Linux job 126701239689: 5,187 frontend
  tests passed and one failed (378 files, 610.09 seconds). The legacy PJ preview's
  broad negative button-name check `/apply|correct|fix/i` also matched the new
  **Read saved country correction receipts** button. Its read-only request guard
  had passed. The identical negative check is now scoped to the legacy PJ region;
  the test additionally requires the passive reader to exist and actual Apply
  and Recover controls to remain absent globally before explicit review. The
  existing every-request-is-`logbook_cty_preview` assertion is retained.
* Contest portability 41866189855, macOS job 126700870608: discovery compilation
  rejected three throwing right-hand expressions expanded into nonthrowing
  Swift Testing autoclosures. The exact same throwing resolver calls are now
  evaluated into local values immediately before the same equality assertions.
  No assertion, expected value, timeout or source guard was removed.

Raw failed-job logs are retained as `.build/country-ci-watch-linux-job.log` and
`.build/country-ci-watch-contest-mac-failure.log`. The latter identifies exactly
three CountryIntegrationTests locations (the original lines 128, 510 and 517),
with no other compiler error. An independent read-only review found no remaining
throwing comparison RHS in that file and confirmed both repairs preserve the
original no-edit and reference-identity checks.

Other macOS CI/beta jobs at that source were cancelled before acquiring a hosted
runner, with GitHub's explicit acquisition failure and arm64 capacity notices.
Those are not test passes. The five non-macOS Contest jobs passed: generator,
Linux/Windows Swift and Linux/Windows native. This historical scope does not
substitute for the final validation run.

The full frontend/Node and portable gates are repeated for the test repair.
Their actual results, validation commit and remote rerun are recorded in the
final release and machine receipts. All other tracked application/resource/help,
build-recipe, dependency-lock and workflow entries are compared against the
release source, excluding these two test-only files and evidence/planning/release
prose. The retained ZIP, host/worker hashes and original source provenance are
not relabelled; no new package or installation is produced by the test repair.
Remote reruns explicitly use `validation_only=true`, `package_macos=false`.

The repeated full local gates passed before committing the repair:

* `XLOG_CONTEST_PYTHON=/opt/homebrew/bin/python3.12 XLOG_TEST_PYTHON=/opt/homebrew/bin/python3.12 npm test`
  in `prototype`: **5,188 passed / 378 files**, plus **6 Node tests**, 497.02 s
  Vitest duration. Raw log `/tmp/xlog-cqrlog-full-frontend-post-ci.log`.
* `XLOG_PORTABLE_ONLY=1 XLOG_CONTEST_PYTHON=/opt/homebrew/bin/python3.12 swift test --scratch-path .build/cqrlog-portable-final --jobs 2 --no-parallel`:
  all targets exit zero; all XCTest targets pass, **619 reported Swift Testing
  methods / 85 suites** plus **8 / 2** contest-rate methods. Existing conditional
  skips remain. Raw log `/tmp/xlog-cqrlog-portable-post-ci.log`.

The source/build/workflow comparison and ZIP checksum were independently reviewed
without changing HEAD or artifacts. No product code or output guard changed.

## Subsequent platform feedback fixtures

Validation at `768c0bb7` passed normal Mac CI and all seven Contest portability
jobs. In the full all-platform workflow, Linux completed its frontend, portable,
worker/framing, shell/dummy and desktop build steps without failure. Mac and
Windows each passed 5,187 frontend tests and failed a different asynchronous
feedback case in the same existing DetachedContestSurface test file:

* Windows: original line 765, owner rejection after Edit last, alert not observed
  before Testing Library's default deadline (full Vitest duration 1,028.72 s).
* Mac: original line 1889, QSO saved feedback after Log It not observed before that
  deadline (667.56 s). Linux's full frontend passed.

The Windows branch is an immediate rejection plus receipt refresh, **not** a
500 ms polling branch. Its test now awaits the real diagnostic IPC completion
inside asynchronous React `act` before checking the exact alert. Both original
owner/window error cases retain K1KEEP and editor 0/1 assertions, and additionally
require one correctly bound `entry_edit_last` envelope and exact diagnostic.
The saved-feedback test waits for the actual post-applied next-draft readback
inside `act`, then requires one correctly bound `entry_commit`, QSO-saved status
and empty next draft. Its original selected-spot wake still clears the feedback
and retains PJ4G. No timer, sleep, extra wake, response-status branch, product
code, guard or timeout was changed.

Focused three concrete cases passed; the complete affected file passed **198/198**
in **13.31 s**, TypeScript and whitespace checks passed. Structured receipt:
`.build/detached-feedback-gates.json`, with inline-only raw-log limits stated.
The full original platform logs remain `.build/country-ci-watch-768-{mac,windows,linux}-job.log`.
Linux had 31 successful/20 skipped steps and no failed step, including Complete
job; GitHub still reported its final job conclusion pending at the preservation
checkpoint, so step success was not falsely reported as a finalized matrix pass.
All package/upload steps skipped and no packaged-app artifacts were produced.
That failed/stuck matrix is superseded by validation of the test-only repair.

The exact signed 1.5.13 artifact remains retained. Application/build/workflow
equivalence is regenerated for the additional test-only file, with the validation
commit and final remote results separately pinned in the candidate receipt.
