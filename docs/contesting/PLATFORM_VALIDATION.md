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

## Historical snapshot baseline

The following table records the earlier `478269e` baseline. The later six-job acceptance below supersedes its Windows publication limitation for source `f724f73` only.

| Platform | Required job | Historical status |
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

## Export extension scope

The workflow source now requests four additional portable Swift classes on all
three runners: `ContestADIFExportTests`, `ContestExportServiceTests`,
`ContestExportLaneTests`, and `ContestExportWorkerWireTests`. It also requests a
three-platform, nonpackaging native Rust job limited to
`contest_export::tests::`. These extensions passed at `f724f73`, as recorded
below; the earlier platform table describes only its historical source.

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

## Accepted snapshot publication, SSB core and export test matrix

[Run 39047313889](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39047313889)
passed all six jobs at `f724f73684d80c1ccf205fc35fc777377b965543` on
`codex/contest-ssb`. Actual job logs confirm the following executed counts:

| Runner | Swift toolchain | Swift tests | Native Rust export tests | Jobs |
| --- | --- | --- | --- | --- |
| macOS 14, arm64 | Apple Swift 6.0.3, Xcode 16.2 | 38 core, 47 store/snapshot, 27 export support | 18 passed | [Swift 117438543721](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39047313889/job/117438543721), [Rust 117438543553](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39047313889/job/117438543553) |
| Ubuntu 24.04, x86_64 | Swift 6.3.3 | 38 core, 47 store/snapshot, 27 export support | 18 passed | [Swift 117438543734](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39047313889/job/117438543734), [Rust 117438543767](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39047313889/job/117438543767) |
| Windows Server 2022, x86_64 | Swift 6.3.3 | 38 core, 52 store/snapshot, 27 export support, 6 ConnectionDoctor, 8 backup presentation | 18 passed | [Swift 117438543786](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39047313889/job/117438543786), [Rust 117438543630](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39047313889/job/117438543630) |

Windows executed all **17 snapshot tests with zero skips**, plus 3 SSB store
and 32 existing store tests. macOS/Linux executed 12 snapshot, 3 SSB store and
32 existing store tests. This closes the observed Windows snapshot publication
test defects, including exact-name publication and cleanup, at this source.
The preceding repairs use an identity-verified cleanup handle and a terminated
UTF-16 rename buffer whose byte length excludes the terminator.

Export support comprises 5 ADIF, 8 service, 11 lane and 3 worker-wire tests.
These still exercise the existing CW adapter paths: the newer four-pilot
worker/UI integration is not part of this accepted SHA. The SSB core/store
tests are included. Native Rust tests validate injected save behavior, not a
real native save dialog or packaged-app operation. This source excludes the
later SCP and Oceania changes.

## SCP fixture checkout follow-up

[Run 39047583727](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39047583727)
at `3b0019d6d48d4c4ea3215e59852085929a03b1d0` passed macOS/Linux Swift
and all three native Rust jobs. Windows Swift job `117439354645` failed one
of 10 SCP tests with `digestMismatch`; all other core classes passed (40 total,
one failure), and later store/export steps were not reached. A temporary Git
checkout with `core.autocrlf=true` independently reproduced the fixture changing
from 124 LF bytes (SHA-256 `6510d5f2076e8bec2e268290a24a5f6d963a2d6d30a4701e8dd667394b383855`)
to 138 CRLF bytes. Reviewed fix `1b54a85`, integrated at `b7e442a`, pins only
this fixture to `text eol=lf`; production raw-byte digest verification is
unchanged. The same checkout experiment then preserved the expected bytes.
The repair then passed all six jobs in
[run 39048913988](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39048913988)
at `db99b3133d9134ed53565d83abab0785f20ce7a7`. Windows Swift job
`117443204511` executed all 10 SCP tests, including the exact digest assertion,
with zero failures: 40 total core tests and 49 store/snapshot tests, including
all 17 snapshot tests. macOS job `117443204272` and Linux job `117443204439`
each passed 40 core and 44 store/snapshot tests. Export-support and all native
Rust jobs also passed. The fixture byte-preservation fix now has actual Windows
execution evidence. This SHA predates SSB worker/UI and Run/S&P integration.

## Oceania core/store native matrix

[Run 39048732300](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39048732300)
passed all six jobs at `0c9a4d1ca5519bf546f1dfb718eec37768f5d2c5` on
`codex/contest-oceania`. macOS Swift job `117442667998` and Linux Swift job
`117442667973` each executed 44 core and 49 store/snapshot tests. Windows
Swift job `117442668032` executed 44 core and 54 store/snapshot tests,
including 17 snapshot tests without skips. Each core run includes 6 Oceania
tests; each store run includes 2 Oceania lifecycle tests. All 27 existing
export-support tests also passed on each OS; Windows additionally passed
6 ConnectionDoctor and 8 backup-presentation tests. Toolchains remain Apple
Swift 6.0.3 on macOS and Swift 6.3.3 on Linux/Windows, on the runner images
listed above.

This validates the Oceania rule/store source on native runners. It excludes
the subsequent six-pilot worker/UI integration, corrected SAC candidate,
SCP integration and full operator simulation; no package, save-dialog,
sponsor approval or hardware acceptance is inferred.

## Six-pilot adapter source matrix

[Run 39050582252](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39050582252)
passed all six jobs at `e70f3bd0778d9938bba046aae1ec87cd1e5df56b`.
Actual logs show 44 core, 49 store/snapshot and 27 export-support tests on
macOS (Swift job `117448166194`) and Linux (`117448166200`). Windows Swift
job `117448166193` passed 44 core, 54 store/snapshot, 27 export-support,
6 ConnectionDoctor and 8 backup-presentation tests. Its snapshot suite ran
all 17 tests without skips. Rust jobs `117448166089`, `117448166174` and
`117448166231` each executed 18 native export tests successfully.

This source contains the six-contest worker/UI adapters and Oceania ADIF
mapping, but the workflow currently executes only the four export-support
classes (5 ADIF, 8 service, 11 export-lane, 3 wire tests). It does not run
`ContestingLaneTests`; create/log/edit/delete/restart scenarios in that suite
have local evidence only. It also excludes the later SCP backend, Run/S&P
reducer and deterministic export-concurrency repair. Native test success is
not application/operator or native save-dialog acceptance.

The predecessor four-pilot adapter
[run 39049346200](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39049346200)
at `a074a34f35fd3916d332e97b496c174fc5ff59aa` also completed all six jobs
successfully; no uninspected per-suite counts are claimed for that run here.

## Combined six-rule foundation

[Run 39052034797](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39052034797)
passed all six jobs at `6e721cdd2a15c850302a938c550892b0bf26c31a`.
Swift jobs `117452405170` (macOS), `117452405054` (Linux) and `117452405090`
(Windows) each executed 54 core tests. Store/snapshot counts were 49 on
macOS/Linux and 54 on Windows. The repaired 11-test export-lane suite passed
on every OS. All existing export-support steps passed. Rust jobs
`117452405093`, `117452405068` and `117452405122` each executed 18 tests.

This closes native test evidence for the combined SCP core, six rule pilots
and deterministic export concurrency repair. Its workflow still omits
`ContestingLaneTests` and `ContestAssistanceLaneTests`. Reviewed CI change
`e51b847aacd05c0bf678fc08b78791d37f770be2` adds anchored nonzero discovery
checks and actual execution of those classes on all three operating systems;
local discovery found 13 tests in each class, while hosted results remain
pending at this checkpoint. Later SAC integration adds another worker test.

The separate SAC core [run 39051704053](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39051704053)
at `c406a5fcfc1168b1f7c8c455d0d00486a425c380` passed Linux/Windows Swift
and all Rust jobs. macOS Swift job `117451451879` passed 52 core and 51
store tests, including 8 SAC and 2 SAC store tests, then failed the old
export concurrency test with caught error `planned`. Windows job
`117451451846` passed 52 core and 56 store tests, including those SAC
suites. This is not an all-green run. The combined foundation already
contains the reviewed deterministic repair; no new SAC defect is inferred.

## Explicit worker and assistance lifecycle execution

[Run 39052566495](https://github.com/oliverbross/OM0RX-xLog/actions/runs/39052566495)
at `e51b847aacd05c0bf678fc08b78791d37f770be2` passed all six jobs.
Actual logs confirm 13 `ContestingLaneTests` and 13
`ContestAssistanceLaneTests` with zero failures on each runner:

| Platform | Swift job | Worker lifecycle | SCP assistance lifecycle |
| --- | --- | --- | --- |
| macOS | `117453940443` | 13 passed | 13 passed |
| Linux | `117453940362` | 13 passed | 13 passed |
| Windows | `117453940484` | 13 passed | 13 passed |

The other core/store/export and Rust jobs also succeeded. This is the
six-rule baseline with the deterministic export repair, before SAC adapter
integration. It closes native execution coverage for these two previously
omitted suites; it does not exercise a packaged GUI, real save dialog,
operator input or station hardware.
