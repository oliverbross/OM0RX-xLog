# HM Control and operating repairs — 1.3.70

## Result and scope

This candidate replaces installed 1.3.68 with the requested HM Control integration
and the logging, rapid-QSY/rotor and Maestro repairs. Preceding reviews retain
individual implementation and qualification evidence. Candidate 1.3.69 was
retired before installation because its isolated-worker shutdown touched the
production spot ledger; its review records the incident and its limits.

Window → HM Control opens a separate native window linked to xLog's station,
selected radio/PTT, filtered cluster and complete log. Billy NZ3C's original MIT
source is retained at upstream commit 7203724e7a3374d955430cf3e16dff8458be0212
(original HTML blob b9ea44b3e38fa4bb4752b572fd897c51b70c91fa), with pinned local
assets, dependencies and attribution. Existing operating-country and foreground
focus fixes remain. HM uses read-only station/log context and bounded public
feeds; it cannot transmit, tune or control relays.

QSO saves avoid unused draft work and repeated station/settings setup. HM
incrementally updates known local contact changes; external/unknown/resolver
changes retain full rebuilding. Rapid QSY coalesces toward the latest destination
and invalidates superseded rotor targets, with correlated Stop and an explicit
unconfirmed-Stop retry fence. A transport acknowledgement does not establish
physical rotor cessation.

## Maestro recovery and isolation correction

Source 4229097b repairs the permanently full spot admission ledger without
claiming uncertain historical sends were removed or expired. Inactive legacy
attempts are retained as raw keyed quarantine payloads; only active delivery or
cleanup leases use capacity. Cross-process file locks and transactional physical
identity leases fence publication, cleanup and crashes. Fresh attempt IDs and
provider-specific prewire classifications prevent uncertain fallback from
acquiring false cleanup authority. Sixty-one targeted tests passed on that
implementation, including a 256-record byte-preserving migration and rollback.

The retired 1.3.69 private worker's EOF path unconditionally invoked the shared
cluster's persisted-spot deferral, opening the global ledger. Its migration
freed capacity and the running 1.3.68 worker resumed normal spot acknowledgements.
That deferral performed no radio add/remove RPC itself. A post-incident read-only
ledger snapshot and exact observed limits are retained in the 1.3.69 review;
there was no independent pre-migration raw-byte snapshot. The original 256-record
group matches the earlier 189 contest / 67 normal and 51-identity inventory.

The correction routes the broker's default inventory through AppRuntimeProfile:
production keeps its existing path and private profiles use their resolved
support root. Offline cluster construction suppresses forward, remove, prior
cleanup, retirement and persisted-deferral callbacks. Worker EOF separately
denies radio cleanup even for an injected cluster, and external session shutdown
is limited to a worker that owns production I/O. This preserves production
owner retirement and the uncertain-release guards.

## Verification and release provenance

Build only from the clean canonical main checkout, using one Cargo job and
reduced scheduling priority. Version 1.3.70 advances every earlier candidate.
Record the exact implementation and versioned commits after proportional checks;
DistributionMetadata must match the clean versioned source used for packaging.

Final gates: exact signed source/hashes; Apple acceptance and stapled ticket;
private native save/HM acceptance and isolated EOF; ordinary production Quit
with draft preservation; fresh backup including Integration Services; atomic
installation; fresh acknowledgements after the actual installed worker starts;
all pre-install pending/quarantined payloads retained byte exactly; all original
contact IDs retained and no private acceptance/projection markers in production;
live log/radio/HM verification. Retain prior app and paired data for rollback.

Final checks and installed evidence follow after qualification. Physical Maestro
LCD, RF output and extended hardware/rotor soak are not established by software
transport receipts or disposable tests.

## Checked implementation and version preparation

Isolation implementation: 0c4d8ced5984da1cce5425035f203215480487e3, pushed
before this version preparation. Final aggregate: 68 XCTest plus 45 Swift
Testing cases passed, zero failures. Two actual worker EOF cases passed,
including both marked normal_logging/contesting launches against a fake HOME
with 256 legacy pending records; byte hash and directory contents were unchanged.
The earlier failure exposed five retirement fixtures that used localAcceptance
while expecting production callbacks; those constructors now explicitly use
production semantics with private injected clusters and no global ownership,
retaining their original delayed-ACK/uncertainty assertions. Independent review
found no open issue after the adjacent local-acceptance guard was included.

Read-only comparison during final tests found the actual production quarantine
unchanged: 257 entries, digest
26497a527c186fd9cacc640d26701f00a7c408c4ddff503c0234e7db15e5dadb
(length-prefixed sorted key/raw payload SHA-256), and the same three publisher
lock filenames. Repeat this comparison for the signed private candidate before
production replacement.

Package from the clean versioned commit using prototype/scripts/package-macos.sh
with CARGO_BUILD_JOBS=1 and nice priority 10. The build records that commit in the
main executable and DistributionMetadata; independently verify them and all three
executable hashes before notarization and installation.

## Actual installed 1.3.70 acceptance and remaining startup lookup

Clean packaged source: 15733f32477e7f52e2c9078641fe9a301807b05e.
Main SHA-256 f75960ffe4d4eab7cecf6d5a2fb32f85324f2a8e693d1be155eac8ed4bae6c45;
worker 718b298f9175728cddda0b85b3535713d99dcc2ce702344637bd62495ef3b01b;
CW worker ce135c1c860ebaf03fab8fd0fd689e136dda214b3aec1a44c8525f9c029d38c6.
Apple submission 951e490c-6598-4390-aeae-c44d7d36248f was Accepted, stapled and
Gatekeeper accepted. The exact hashes matched the installed app.

The signed private 69,556-contact benchmark measured save → page at 28–80 ms
and save → page → HM at 60–131 ms over five runs. Initial HM full rebuilding
took 4.535 seconds; first workspace initialization took 10.375 seconds. These
cold operations remain separate from the repeated save path. Native durable
success was visible in 1028 ms including automation, with HM open. Native
logbook and HM both updated 69,561 → 69,562 and showed the saved callsign.
Ordinary private Quit completed, and actual global quarantine digest and all
three publisher filenames remained unchanged across signed CLI and native EOF.

Production 1.3.68 quit normally. Fresh complete backup:
/Users/oliver/Documents/Backups/OM0RX-xLog/HM-Control-performance-1.3.70-before-install-20261101T025358+0930.
The production database stayed byte-identical through the atomic swap
(SHA-256 0b02c342548d08361e50179945e1f42f0e6516305ec83ed7fb3ea1c8d1049de0).
Retained prior app: /Applications/OM0RX-xLog-previous-20261031T172445Z-91369.app.
New app PID 91424 and worker 91446 were process-verified with exact installed
paths, correct parentage and no private arguments before GUI binding.

All 69,556 original contact IDs remained; no HM16/HM17 acceptance/projection
markers or N0PERF contacts reached production. All 257 pre-install quarantine
key/payload pairs remained byte-identical, with zero missing/altered entries.
At 17:29:38 UTC the installed worker had 40 fresh normal_logging/direct_agent/
radio1 receipts and zero pending deliveries. This verifies software transport
acceptance; no physical Maestro LCD observation was supplied.

The FW3GT draft (including frequency, name, comment, grid, country and IOTA)
was retained. Live HM showed 69,556 contacts, direct-agent 14.003810 MHz CW,
filtered cluster, PSKReporter, weather and 11 satellites. Its initial open
exhausted the startup retry budget while the worker was busy; one explicit
Reconnect immediately recovered the complete live dashboard.

A remaining startup defect was found: callsign lookup retries only once after
750 ms, then stores a busy error until its callsign/request/workspace dependency
changes. The restored draft's intelligence card stayed busy after ordinary
Logbook → Desk navigation. This is a persistent failure after temporary startup
contention, not a successful lookup qualification. A bounded read-retry and
explicit retry follow-up will receive a new visible version before replacement.
