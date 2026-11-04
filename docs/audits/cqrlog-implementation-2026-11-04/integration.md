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
| Full portable Swift slice | Pending final result | Fresh scratch `.build/cqrlog-portable-final`; final results and skip counts will be recorded before candidate qualification. |

The Rust/Python source did not change after those full gates. The later Settings
loading change has its focused regression and complete production-graph gate
above. The [country](country.md), [devices](devices.md), [CW](cw.md) and
[voice](voice.md) records identify the focused integration cases and sources.

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
