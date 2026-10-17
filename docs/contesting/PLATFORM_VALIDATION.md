# Contest core and store platform validation

The `Contest core and store portability` workflow runs the focused
`XContestCoreTests` and `XContestStoreTests` targets on GitHub-hosted macOS
14, Ubuntu 24.04, and Windows Server 2022 runners. It supplements the existing
project CI; it does not replace the broad Swift, prototype, frontend, Rust,
packaging, or runtime acceptance jobs.

The workflow runs for relevant pushes and pull requests and can also be started
manually. It has read-only repository permission. It does not read credentials,
use deployment environments, contact station hardware, package an application,
or upload a production artifact.

## Toolchain contract

- macOS selects the repository's existing Xcode 16.2 toolchain.
- Ubuntu installs `libsqlite3-dev` and uses the same official Swift 6.3.3
  Ubuntu 24.04 archive as the cross-platform prototype workflow.
- Windows uses the same pinned `compnerd/gha-setup-swift` revision and runner
  vcpkg `sqlite3:x64-windows` installation as the prototype workflow.
- Every runner sets `XLOG_PORTABLE_ONLY=1`, so SwiftPM selects the broader
  portable manifest and never attempts to build the macOS application. SwiftPM
  still compiles that manifest's portable targets and test products.
- The `--filter` arguments limit test execution to each contest test target;
  they do not limit compilation. Both runs use the same per-runner scratch
  directory. The Windows commands pass the existing SQLite include and library
  paths.

Changes to the contest core, store, SQLite system-library target, focused tests,
package manifest, or this workflow trigger the matrix. Documentation-only
changes do not claim a new platform result.

## Evidence boundary

A platform is validated only when its corresponding GitHub Actions matrix job
finishes successfully at the exact source commit under review. A local macOS
run, a portable build performed on macOS, workflow syntax review, or a passing
job on another operating system is not evidence for Linux or Windows.

Record the workflow URL, run ID, source commit, runner image, reported Swift
version, and the outcome of both focused test commands before marking an
operating system complete. A later failure does not erase an earlier native
result at its recorded commit, but it does not validate the newer source.

| Platform | Required job | Current status |
| --- | --- | --- |
| macOS 14 | `Contest tests (macos-14)` | Passed at `049d36d69f78c3b40782216cb7f35424907a3bdc`: 23 core/export and 32 store tests, Apple Swift 6.0.3 / Xcode 16.2. [Job 117408894823](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39037051303/job/117408894823). |
| Ubuntu 24.04 | `Contest tests (ubuntu-24.04)` | Passed at `049d36d69f78c3b40782216cb7f35424907a3bdc`: 23 core/export and 32 store tests, Swift 6.3.3. [Job 117408894962](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39037051303/job/117408894962). |
| Windows Server 2022 | `Contest tests (windows-2022)` | Passed at `049d36d69f78c3b40782216cb7f35424907a3bdc`: 23 core/export, 32 store, 6 ConnectionDoctor and 8 remote-backup presentation tests, Swift 6.3.3. [Job 117408894928](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39037051303/job/117408894928). |

[Run 39034236953](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39034236953)
is the first completed green three-platform matrix for this pilot baseline.
The newer [run 39035403568](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39035403568)
also passed all three jobs after integrating durable corrections/deletions and
pilot export formatters. The latest [run 39037051303](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39037051303)
passed all three jobs after export metadata/service integration; the table
records that source checkpoint. ADIF and export-service tests were compiled
by the portable manifest but were not executed by these focused hosted
commands; their five ADIF and seven service passing tests are local evidence only.
Earlier runs `39031590054` (`d1ab5aa`) and `39032872265` (`434e5de`)
passed Linux and Windows but failed macOS during compilation, respectively in
a portable backup test and the malformed TCI input test. The latest result does
not retroactively validate those failed jobs or subsequent worker, UI, snapshot
and export-service changes beyond the exact commit recorded above.

These are native Swift compile-and-test results for the workflow's portable
manifest. They do not prove a packaged application, renderer or worker runtime,
installation, device access, radio behavior, or end-to-end contest operation.
