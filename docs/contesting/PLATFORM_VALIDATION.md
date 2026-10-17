# Contest portability and native export validation

The `Contest portability` workflow runs the focused
`XContestCoreTests`, `XContestStoreTests`, and contest export-support test
classes on GitHub-hosted macOS 14, Ubuntu 24.04, and Windows Server 2022
runners. A separate job in the same workflow compiles the native desktop binary
with the `contesting-test` feature and runs only the injected native export-save
tests. It supplements the existing project CI; it does not replace the broad
Swift, prototype, frontend, Rust, packaging, or runtime acceptance jobs.

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
  directory and two Swift jobs. The Windows commands pass the existing SQLite
  include and library paths. Discovery must find the ADIF mapper, export
  service, export transport, and real `LiveWorker` wire test classes before any
  of those four filters runs. The fixture-output environment variable is not
  set, so CI runs the real `LiveWorker` wire assertions without regenerating
  the committed fixture. Committed-fixture consumption remains covered by the
  TypeScript test.
- The native job records Rust and Cargo versions and uses an OS- and
  `Cargo.lock`-keyed target cache under the runner temporary directory, separate
  from packaging targets. Its local Tauri configuration uses the Contesting
  Test name and identifier with bundling disabled and no external binaries.
  It discovers at least one `contest_export::tests::` test, then executes that
  exact filter with `--locked` and two Cargo jobs. Linux installs the same Tauri
  compile dependencies as the prototype workflow.

Changes to the contest core, store, export-support sources, `LiveWorker`, SQLite
system-library target, focused tests, generated worker fixture, native export
module and its narrow registration/accessors, package manifests, lockfile, or
this workflow trigger the matrix. Documentation-only changes do not claim a new
platform result.

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
| macOS 14 | `Contest tests (macos-14)` | Passed at `478269e9adce94d1eec8ec9f7282c9e7406e8b54`: 23 core/export and 44 store/snapshot tests, Apple Swift 6.0.3 / Xcode 16.2. [Job 117415329219](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39039297251/job/117415329219). |
| Ubuntu 24.04 | `Contest tests (ubuntu-24.04)` | Passed at `478269e9adce94d1eec8ec9f7282c9e7406e8b54`: 23 core/export and 44 store/snapshot tests, Swift 6.3.3. [Job 117415328940](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39039297251/job/117415328940). |
| Windows Server 2022 | `Contest tests (windows-2022)` | Passed at `478269e9adce94d1eec8ec9f7282c9e7406e8b54`: 23 core/export, 32 store, 4 snapshot, 6 ConnectionDoctor and 8 backup-presentation tests; 9 snapshot publication tests explicitly skipped. Swift 6.3.3. [Job 117415329174](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39039297251/job/117415329174). |

[Run 39034236953](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39034236953)
is the first completed green three-platform matrix for this pilot baseline.
The newer [run 39035403568](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39035403568)
also passed all three jobs after integrating durable corrections/deletions and
pilot export formatters. [Run 39037051303](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39037051303)
passed all three jobs after export metadata/service integration. The table now
records the later snapshot/compatibility integration below. ADIF and export-service tests were compiled
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

## Export extension pending validation

The workflow source now requests four additional portable Swift classes on all
three runners: `ContestADIFExportTests`, `ContestExportServiceTests`,
`ContestExportLaneTests`, and `ContestExportWorkerWireTests`. It also requests a
three-platform, nonpackaging native Rust job limited to
`contest_export::tests::`. No hosted run for this extension is recorded yet.
Until a run at the exact integrated commit passes, the existing platform table
continues to describe only its recorded source and commands.

The native job proves compilation of the desktop binary under the Test feature
and the injected memory/filesystem save behaviors covered by the filtered unit
tests. It does not stage a Swift worker or Hamlib helper, invoke Tauri build,
create or sign an application bundle, show a real save panel, launch the app,
exercise a renderer, access credentials or station hardware, or establish
foreground runtime acceptance.

## Snapshot integration follow-up

Run `39038651231` at `2f7418b62f8639366c55929b40c835ea0ee8ef2f`
passed macOS but failed Linux compilation because Swift's Glibc module did not
expose `renameat2`, and Windows compilation because WinSDK and Foundation both
declare `UUID`. Reviewed commit `09cd62d` adds a Linux-only C wrapper with
`RENAME_NOREPLACE` and explicitly qualifies the Foundation type. It does not
add an overwrite fallback. The Linux libc binding requires glibc 2.28 or newer;
the selected Ubuntu 24.04 runner satisfies that requirement.

Integrated [run 39039297251](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39039297251) at
`478269e9adce94d1eec8ec9f7282c9e7406e8b54` passed all three jobs. The workflow
filters the whole `XContestStoreTests` target: macOS and Linux executed all 12
snapshot tests plus 32 existing store tests. Windows ran 4 independent snapshot
tests plus 32 store tests and explicitly skipped 9 publication-dependent tests.
Windows snapshot publication at that SHA fails closed; this passing matrix does
not establish Windows publication support. Its native implementation remains a
separate slice awaiting its own hosted acceptance.

## Native Windows publication follow-up

Native implementation `d24cb0b` at integrated source `daa8bdb` passed Linux
and macOS in run `39040271218`, but Windows compilation failed because the
WinSDK member is imported as `DeleteFileA`. Reviewed repair `c962f87` changes
only the typed initializer.

[Run 39041173713](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39041173713)
at `0b6eaba12aeb17a65662e964c0b1562af0729856` passed Linux job
`117420808506` and macOS job `117420808640`, each with 23 core/export and
44 store/snapshot tests on the same toolchain versions as above. Windows job
`117420808459` now compiles and passes 23 core/export and 32 store tests.
However, its 14 snapshot tests report 9 failures (7 unexpected), principally
`Windows rename failed: 5` during publication; the late-staging move test also
reports access denied. There are no publication skips hiding this failure.
Native publication remains unaccepted pending repair and a successful rerun.
Later Windows backup-presentation/ConnectionDoctor steps did not run after the
snapshot failure and receive no fresh acceptance claim at this source.
