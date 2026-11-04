# CQRLOG C01–C06 integration evidence

Canonical starting source: `db4a9ce2739fc8b96371cd432d3b8787e950a45e`.
The [master](../../planning/OM0RX-xLog_CQRLOG_C01-C06_Implementation_Plan_2026-11-03.md)
retains the task and acceptance contracts. This record distinguishes software,
static browser, signed package and physical evidence.

## Software gate checkpoint

| Gate | Actual result | Retained log / qualification |
| --- | --- | --- |
| Full Python | 618 passed | `/tmp/xlog-cqrlog-full-python-312.log`; `PYTHONPATH=python /opt/homebrew/bin/python3.12 -m unittest discover -s python/tests -v` |
| Full native Rust | 1,103 passed | `/tmp/xlog-cqrlog-full-rust.log`; `XLOG_TEST_PYTHON=/opt/homebrew/bin/python3.12 cargo test --locked --bin xlog-prototype` |
| Contesting Test native admission | 7 passed | `/tmp/xlog-cqrlog-contest-admission.log`; same environment, `cargo test --locked --bin xlog-prototype --features contesting-test contesting_test_native_admission_tests::` |
| Explicit pinned Hamlib dummy | 31 passed | `/tmp/xlog-cqrlog-hamlib-dummy.log`; `cargo test --locked --test hamlib_dummy`, with the repository's arm64 `XLOG_TEST_RIGCTLD` / `XLOG_TEST_ROTCTLD` paths; loopback dummy only |
| Full frontend | 5,183 passed in 378 files, plus 6 Node tests | `/tmp/xlog-cqrlog-full-frontend-final.log`; `XLOG_CONTEST_PYTHON=/opt/homebrew/bin/python3.12 XLOG_TEST_PYTHON=/opt/homebrew/bin/python3.12 npm test` |
| Final country Settings load change | 37 passed | `/tmp/xlog-cqrlog-lazy-country-controls.log`; ServiceSettings and CountryCorrectionReview. These overlap the full suite and are not additional unique test totals. |
| Frontend production build | Passed, all existing budgets unchanged | `/tmp/xlog-cqrlog-frontend-build-ready.log`; `npm run build`; Settings 407,858 bytes against 408,000. Country controls load on first reference-tab opening and stay mounted to retain input. Both new style modules use the existing eager stylesheet owner. |
| Normal Swift | Exit 0 | `/tmp/xlog-cqrlog-normal-swift-final.log`; `XLOG_CONTEST_PYTHON=/opt/homebrew/bin/python3.12 swift test --no-parallel`; 227 reported XCTest, 389 reported core Swift Testing and 8 reported contest-rate Swift Testing methods. Existing conditional skips are retained; reported methods are not all executed passes. |
| Full portable Swift slice | All targets exit 0 | Final working source committed as `92a36e39`; `XLOG_PORTABLE_ONLY=1 XLOG_CONTEST_PYTHON=/opt/homebrew/bin/python3.12 swift test --scratch-path .build/cqrlog-portable-final --jobs 2 --no-parallel`; all XCTest targets, 617 reported Swift Testing methods/85 suites and another 8/2 pass. Existing optional/conditional skips remain. [Complete log](country-compatibility-portable-gate.txt). |
| Final country core / UI delta | 13 core and 5 UI, TypeScript exit 0 | [Core log](country-compatibility-core-gate.txt) and country evidence; canonical names, original area descriptions and shared unknown-only XML fallback now agree across consumers. |

At that checkpoint, Rust/Python source did not change after those full gates. The later Settings
loading change has its focused regression and complete production-graph gate
above. The [country](country.md), [devices](devices.md), [CW](cw.md) and
[voice](voice.md) records identify the focused integration cases and sources.

The final UI metadata delta was followed by another production build, exit 0:
`/tmp/xlog-cqrlog-frontend-build-candidate.log`, unchanged Settings size/budgets.
The full normal run precedes that last country-only compatibility delta; its
13-case normal core repeat and complete portable run above qualify that delta.
Exact-source remote CI and package results remain separate candidate gates.

## Failed checks and corrections

The first Python command used system Python 3.9 without its module path; it was
corrected to the documented supported interpreter/path, without source changes.
An existing actual-Host frontend case separately uses `XLOG_TEST_PYTHON`; both
interpreter variables are now explicit. The original logs remain in `/tmp`.

The first frontend run failed when an unavailable native voice snapshot crashed
the mounted desk. VoiceDesk now rejects the malformed reply and keeps output
disabled. Existing Desk/rotor files passed 77/77 after the correction; dedicated
voice/EP-15 controls passed 11/11. The final complete run above has no unhandled
errors. No test timeout or assertion was weakened.

The first normal Swift run found the incorrectly assumed unknown `ZZ` prefix.
The independent real-data correction and strengthened 12-case corpus gate are in
[country.md](country.md); the full normal repeat passed.

The retained `.build/prototype-tests` Xcode scratch contained older nested XCTest
resource bundles with `cty.csv` but without the new pack, despite the updated
top-level bundle. Its run failed and one old assertion subsequently trapped.
That scratch is preserved. A fresh named scratch is used for the full repeat;
no resolver fallback to source/production resources or guard weakening was added.
The explicit non-macOS source slice also now includes `VoiceProfile.swift`.

The fresh run exposed real PJ, declared-location and partial-XML compatibility
regressions, plus misleading AreaOK1RR descriptions in the country field. They
are corrected in `92a36e39`, without weakening the original QRZ/map/PJ assertions.
Canonical names and explicit winning-description/source facts now share v2
snapshot identity. The original 16-issue log is retained as
`.build/country-portable-original16issues.log`. A later run omitted the Python
environment and repository concurrency option; its failure is preserved in
`.build/country-portable-missing-env-parallel-failed.log`. The proper full run
above passes unchanged concurrency deadlines.

CI at `9087b323` exposed a portable Swift type-check timeout; the TCI snapshot
now uses typed subdictionaries. The new country stylesheet initially violated
late-CSS ordering, then its eager control import exceeded the Settings budget.
Both were fixed through existing load/style owners; the limits were preserved.

Several MCP shell requests stalled before starting their command. Process-only
inspection through the documented lean-ctx CLI proved no native test process was
running; these requests are not passes. The actual CLI runs/logs supersede them.

## Bounded browser review

`prototype/tests/visual/cqrlog-preview.{html,tsx}` mounts the actual CWDesk,
CWSettings, VoiceDesk and CountryReferenceControl, with native, station and
production-store I/O rejected. Browser session `cqrlog-1052e41d9c2a` was limited
to `127.0.0.1:1428`. Expanded controls were checked at 1280×900 and 440×900.
Final PNGs are `.build/cqrlog-controls-{desktop,compact}-final.png`.

The bounded two-round review fixed country path-field width/import specificity
and compact voice route labels. Independent review found no material overflow;
Stop CW/Stop voice remained visible beside Send. This establishes those static
fixture states only, not native IPC, active transmission, focus, device or RF
acceptance. Existing product typography, density and design guidance were kept.

## Candidate and external boundaries

The exact signed candidate, process-verified private native launch, 100k changed-
path benchmark, final applicable CI and remaining unrun cases belong in the
release record. No production application/store or physical radio/audio/keyer
setup was used by these source/browser checks. C03 physical ExpertSDR/TCI, C04
firmware/pot/paddles, and C06 microphone/monitor/transmitter/PTT qualification are
Not run. Existing TLF R03/MO2T and advanced unsupported adapter limits remain.

## Final candidate and follow-up gates — 5 November 2026

The retained signed [1.5.13 candidate](../../releases/v1.5.13-cqrlog-candidate.md)
is source `75cb1fbe78791b47735e7d81e7e42e3404dc7010`. Functional delivery is
`f7dd16b9`, durable recovery `d6c1dc52`, and the base country compatibility/v2
snapshot correction `92a36e39`. The initial test-only validation commit is
`768c0bb78a13964bb28255041dc4edda7de2b169`; 6,435 other tracked application/help,
resource, build-recipe, lock and workflow entries are identical to the release.
The signed artifact's original source/hashes are not relabelled and no package
is rebuilt from the validation commit.

The subsequent test-only feedback-completion repair is
`723d852ba3d65f595c27aa8a524abb2cd31b2d54`, with 6,434 other tracked application,
help/build/workflow entries identical to the original release. Its affected
DetachedContestSurface file passed 198/198 plus TypeScript, without changed
timeouts, sleeps, wakes, product code or guards. Receipt:
`.build/detached-feedback-gates.json`. The retained signed source/hashes remain
unchanged and the prior 6,435-entry/`768c0bb7` proof remains a historical gate.

| Final gate | Actual result / scope | Retained evidence |
| --- | --- | --- |
| Full native Rust after recovery | 1,103 passed, 20.79 s | `/tmp/xlog-cqrlog-recovery-rust.log` |
| Full normal Swift after recovery | Exit zero; 227 reported XCTest, 390 core Swift Testing and 8 contest-rate methods; conditional skips retained | `/tmp/xlog-cqrlog-recovery-normal-swift.log` |
| Full frontend after CI test repair | 5,188 passed / 378 files plus Node 6; Vitest 497.02 s | `/tmp/xlog-cqrlog-full-frontend-post-ci.log` |
| Full portable after CI test repair | Every target exit zero; all XCTest targets pass, 619 reported Swift Testing/85 suites plus 8/2; existing skips retained | `/tmp/xlog-cqrlog-portable-post-ci.log` |
| Recovery-focused checks | Native country 10, contact/acceptance 15, UI 10 plus TypeScript, Rust surface authority 1 | `.build/country-recovery-gates.json`; native raw `.build/country-recovery-native-gate.log`; [recovery audit](recovery-navigation.md) |
| Traditional layout | 40 existing tests / four files plus TypeScript; pointer-wheel/focus/Stop checks at four widths; source fix is CSS only | `.build/cqrlog-desk-layout-20261105/geometry-accepted.json`, 20 PNGs; [layout audit](traditional-desk.md) |
| Production graphs after both follow-ups | Exit zero with all existing budgets unchanged | `/tmp/xlog-cqrlog-recovery-build.log`, `/tmp/xlog-cqrlog-traditional-build.log` |
| Extracted signed package | arm64 host/worker, strict deep signatures, 3,546 payload files / zero findings | `.build/releases/1.5.13/` |
| First signed worker | 9/9 under unchanged 5 s deadline; total 1,928.893 ms | `.build/releases/1.5.13/signed-worker.tap` |
| Signed generated 100k | All 100,000 compared; first/warm page 13.367/3.305 ms; cold lookup 700.197 ms; background review 58,613.438 ms; health 0.252 ms before completion | `.build/cqrlog-country-100k-1.5.13.json`; OS caches uncontrolled |
| Private native workflow | Strict replay: two explicit launches 26640/28185 and 30886/30916; 24 fresh host/worker proofs before every binding/AX/screenshot observation; selected CQ-only apply, restart recovery/Already recovered, Traditional bottom/top controls and persisted unarmed CW preview | Private root `/private/tmp/xlog-wave1-qlog-candidate-fxb4aixv`, marker `8e3053bb-2056-45ab-8973-b33f1e06b73d`; final release and machine receipt. Earlier cross-version 1.5.11→1.5.13 recovery remains separately retained. |
| Post-Quit data | Ordinary Quit process-verified; separate signed-worker read confirms 12 QSOs, restored fields and only intended undo audit/edit timestamp, other contacts/settings/filter retained | Private `post-ui-1.5.13.json` |

Counts overlap and are not summed. The unchanged Python source retains its full
618-case gate, and the retained native admission/dummy gates retain their named
scope. [Test compatibility](test-compatibility.md) records the genuine remote
failures and non-weakened repairs: a broad legacy UI regex matched the passive
saved-receipt reader; the older Swift Testing macro rejected three throwing RHS
expressions. Full repeats above pass. The original raw failures are preserved.

Remote validation is at the separate equivalent-input commit. Mac CI
[41872488439](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41872488439)
and all seven Contest jobs in
[41873199611](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41873199611)
passed. All-platform
[41872588803](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41872588803)
subsequently exposed the Mac/Windows fixture failures described below; its raw
job logs are retained and the superseding validation is pinned separately.
Automatic Mac beta
[41872489082](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41872489082)
could not acquire a hosted runner and downstream runtime jobs skipped; those
are not passes or source test failures. No source/guard was changed for capacity.

The first all-platform rerun subsequently exposed one asynchronous feedback
fixture on each Mac/Windows; their full logs are retained and the fix above
awaits actual owner/diagnostic completion. Linux's actual execution had no failed
step, but stuck GitHub finalization was not falsely declared an overall pass.
The superseding all-platform workflow is
[41879714902](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41879714902)
at `723d852b`. Latest normal CI
[41879444170](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41879444170)
passed. Latest automatic Mac beta is
[41879444183](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41879444183).
All three manual platform test/build jobs and the automatic Mac prototype job
completed successfully. Both prototype runs skipped the two optional Windows
fresh-runner/Linux runtime-only packaged acceptance jobs; those layers are
Not run. The successful Contest run at `768c0bb7` retains its exact unchanged native/
Swift/generator inputs; only a frontend test fixture and audit prose changed
afterward. The [final machine receipt](candidate-gates.json) captures the exact
job/step results and evidence checksums, including final Mac/Linux/Windows raw
logs and the separate original failed validation logs.

The 50 CQR work-package identifiers, deliverables, dependencies and acceptance
references were compared to the exact imported master. Original QLog/TLF task
states are retained, with only the documented grouped TLF capability-evidence
clarification. [CX layer matrix](acceptance-layers.md) and release record retain
the unrun connected/native/physical cases, macOS-only normal native audio,
external-WAV backup contract and unchanged production/rollback state.
