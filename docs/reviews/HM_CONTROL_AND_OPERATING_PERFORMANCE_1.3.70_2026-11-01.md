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
