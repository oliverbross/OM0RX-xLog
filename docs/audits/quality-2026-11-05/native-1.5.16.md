# Signed 1.5.16 native first-run qualification — held

Exact source: `bd91a83e9952923c6536b7b5df8824600f09ea0b`.
Archive SHA-256: `8ffff85e1e3ba9a06905720ba73037e091fa64f1030cba5fdae52cc27ce61a2e`.
Signed host: `46c2731bf5230a5c0e170cc83ed334018a29ee2dc99238fa779ffb7b6d0c4333`;
signed worker: `ab0427710afc996ba7b19f632c4cdf6cee1a3105f8f34cbabe56690fde07c41d`.
Strict host/worker signature checks, arm64 slice checks, ZIP round trip,
payload privacy and all nine packaged-worker tests passed. The existing
five-second worker deadlines were unchanged. No application was installed or
published; installed 1.5.15 remains running in its original session.

The ZIP-extracted app was launched explicitly with a canonical private root,
validated `normal_logging` module and unique offline marker. Exact original
host/worker PID, executable, complete arguments and parentage were verified
before every GUI observation/input sequence. The native window displayed the
matching marker. External station/network/credential services remained disabled.
Raw process coordinates and synthetic-store receipts remain private.

| Native action | Observed outcome |
|---|---|
| Blank first-run wizard → synthetic station identity | Operator `K1TEST`, station `K1TEST/P`, grid `FN31PR`, location `Isolated quality fixture`, power 100 entered through native controls. |
| Skip radio → skip rotator → local logbook → Finish | Wizard dismissed; configured station/grid appeared. No connection, output or motion was requested. |
| Desk create via Command-Enter | One `K1SYN`, 20m SSB, 14,250,000 Hz contact saved; comment retained `Žilina`. |
| Search → open stored contact → edit comment → Update | Still one contact; frequency/mode/reports and Unicode retained. Final comment: `QUALITY / edited 1.5.16 — Žilina`. |
| Ordinary Quit → process-only stop proof → explicit restart | Setup remained complete; configured identity and the edited single row reappeared. Second ordinary Quit and owned host/worker stop checks passed. No force quit, blind Escape or app-binding survival check. |
| Closed-store integrity and first-contact station identity | Integrity **PASS**; durable own-station fields **FAIL**, as below. Candidate held. |

## First contact loses configured own-station identity

The closed synthetic store and durable mutation receipts show the first saved
contact has empty `myCall`, `myGrid`, `operatorCall` and `stationLocation` despite
the configured setup values. Its `txPower` is 100. The later comment edit retains
those blanks; it did not introduce them. The next blank draft has the configured
station values. UI **CONFIGURED** badges read current settings and therefore do
not prove per-contact storage. ADIF export has no current-settings fallback for
the empty station/operator/grid fields.

Source tracing identifies eager initial draft creation during
`workspace_create` → power-owner reconciliation, before wizard settings are
saved. This is a real first-run correctness failure, separate from catalogue
transport and memory retention. The correction must prevent that early seed
without replacing an operator's populated or previously saved draft. A real
`LiveWorker` setup → first draft → save → ADIF regression is required before the
successor package can be accepted.

## Boundaries and retained diagnostics

Radio/rotor native Browse/Save is **NOT RUN**: the isolated Station Control guard
rejects those operations and was not weakened. Windows/Linux native account,
installer, keyboard/scaling and physical-device checks are separate.

The automation's initial Unicode key injection omitted one character; clipboard
input was then observed to contain the exact intended Unicode text before save.
A paste-conflict notification was followed by readback verification, never a
blind save. The test harness's first post-Quit matcher conservatively confused
the worker executable prefix with the host and independent worker benchmarks;
no old app binding was queried. Exact executable-boundary/root checks and the
established process-only stopped helper then confirmed exit before restart.
These harness issues are retained separately from application defects.

Packaged 20k completed-request tests passed the 24 MiB growth guard on empty and
generated 100k fixtures. Rounded footprint changes were approximately -4.1 MiB
and -7 MiB, respectively, under uncontrolled compression/caches/build load.
This supports removal of positive request-driven retained growth; decreasing
samples are not a whole-app memory budget or a claim about the original htop
reading. See the adjacent machine measurements and [memory report](memory.md).
