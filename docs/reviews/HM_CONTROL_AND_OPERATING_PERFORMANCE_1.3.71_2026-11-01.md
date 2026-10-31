# HM Control and operating repairs — 1.3.71

## Scope and carried qualification

Installed 1.3.71 replaces 1.3.70 and repairs a persistent callsign lookup
failure after temporary worker startup contention. The 1.3.70 review records
the preceding HM integration, Scotland operating-country/foreground repairs,
save/logbook improvements, rapid-QSY/rotor safeguards, Maestro recovery and
isolated-worker lifecycle correction, with the retired 1.3.69 incident and its
limits recorded separately. Those implementation paths remain unchanged here.

The installed 1.3.70 qualification preserved all 69,556 contacts and the pending
FW3GT draft; it retained all 257 pre-install spot quarantine key/payload pairs
byte-exactly and received fresh normal_logging/direct_agent/radio1 acknowledgements.
Its signed private save → page samples took 28–80 ms, and save → page → HM
60–131 ms. Native durable success appeared in 1028 ms including automation.
Initial full HM rebuilding took 4.535 seconds and is a separate cold boundary.
Live HM showed the shared log, radio, cluster, PSKReporter, weather and satellites;
one Reconnect was needed during initial startup contention. Software transport
receipts do not establish the physical Maestro LCD or rotor cessation.

## Remaining failure and correction

Live qualification found the restored draft's lookup permanently showing
“Prototype worker is busy; try again.” LiveApp delayed the lookup by 400 ms,
retried only once after 750 ms, then stored the error. Navigating Logbook → Desk
did not rerun its effect. Its effect/dedupe identity also omitted the current
workspace generation and draft ID, allowing a same-call new draft to join an
older lookup. Existing manual-field enrichment guards must remain intact.

The follow-up is limited to read recovery: bounded cancellable retry for known
worker/admission/settings-busy responses, explicit manual lookup retry without
rewriting the operator's draft, and workspace/draft-scoped result admission.
Provider authentication/not-found responses retain their terminal behavior.
Record exact checked implementation, focused tests and independent review before
version preparation; then package only clean canonical source with a new version.

## Release gates

Require exact packaged source and installed executable hashes, Apple acceptance
and stapled ticket, signed private native save/HM/lookup acceptance, unchanged
shared ledger during private EOF, ordinary Quit and draft preservation, a fresh
complete backup including Integration Services, atomic replacement, fresh radio
acknowledgements after the installed worker starts, byte-preserved pre-install
retained spot payloads, complete original contact IDs and absence of private
acceptance/projection markers in production. Retain the prior application and
paired backup for rollback. Append actual results and bounded limitations below.

## Checked implementation and version preparation

Implementation b9689029e4b4f3bec774de24c398e33d37e2cdff was pushed before
version preparation. The final proportional run passed 171 tests in 12 files:
main app, rotor, power, workspace recovery, spot barrier, worker client/error
codes, callsign retry helper/hook/UI, detached intelligence and draft enrichment.
TypeScript passed, diff checks passed, and independent read-only review was clean.

The retry is limited to lookup_call and known worker/admission/settings-busy
responses. A fixed 65.75-second overall cap includes the original 46-second
provider allowance plus at most 19.75 seconds of backoff; it never resets.
The finite schedule permits at most nine attempts. Provider terminal profiles
are retained without an automatic authentication/not-found loop. An explicit
Retry lookup refreshes intelligence without any operator-draft enrichment.
Workspace generation, draft ID and normalized call scope request sharing and
result admission, with latest-render fencing, per-consumer release and abort
cleanup. Falsy promise rejections remain errors.

Tests cover busy recovery/exhaustion, eight busy admissions then a 40-second
provider response, fixed deadline, abort and shared-consumer ownership, same-call
new-workspace/new-draft stale replies, manual edits during reads, manual retry
without enrichment, control activation/disabled state and coded worker errors.
Earlier main fixtures used the old retry timing or an arbitrary warming-up
string; they now exercise the coded retry contract and finite schedule. No
production draft text or station I/O was changed during implementation/tests.

Version 1.3.71 packages only from the clean canonical checkout with nice priority
10 and one Cargo job. DistributionMetadata and the main executable record the
exact versioned commit, independently verified before installation. Native
backend control and ledger code are unchanged from qualified 1.3.70.

## Final signed candidate qualification

Clean packaged source: 0680d7558d3cd48c14f9a2e2e460e8ac24a538c9.
The package completed from the canonical checkout with the documented single-job
priority. Frontend production/type/bundle checks, worker self-test, Python tests,
CW payload checks and strict signatures passed. The independently verified hashes:

| Executable | SHA-256 |
| --- | --- |
| xlog-prototype | cc323fc712f6967a91f4373300e94ec4f4c2f058a8c040baf39d3628c406119f |
| xlog-prototype-worker | 8356bc11f589d459788babe5a3168ff9207161cd02ab7132feafd88205d8a50f |
| xlog-cw-worker | ab81a7af2c562db59095ce14d69741b99375077c58b68592862951e064f5255d |

Apple submission b760577b-ad89-4587-9450-b39de96a757b was Accepted. The ticket
was stapled and validated; Gatekeeper accepted the candidate and installed app.
Final notarized ZIP SHA-256:
9b98e677cf0b61c506e97d79952937b2221a68729e3337731e94128940deeb6a.

The signed private benchmark used 69,556 copied original contacts and five
isolated saves. Save → status → logbook page took 16.92–35.97 ms; including
HM projection took 37.53–65.33 ms. Initial workspace opening took 9.093 seconds
and first full HM projection 4.448 seconds; these remain separate cold boundaries,
not repeated-save timings or production latency percentiles.

The actual signed native app opened HM as a separate window while a private
QSO was entered. Retry lookup left all 14 draft text fields unchanged, including
a manual name and country. An initial comparison incorrectly included the AX
focused-control summary; comparing actual fields and the later full tree
confirmed preservation. Durable “QSO logged” appeared within the first
observation, 1577 ms including automation. SQLite confirmed the saved MM/LY3X/P
row with Manual operator / Scotland and its unique HM171 acceptance marker.
Native logbook and HM both updated 69,561 → 69,562 with the matching notification.
Country was deliberately typed for the retry preservation check; this is not
a claim of an offline QRZ lookup. Ordinary Quit completed.

Read-only actual shared-ledger comparison before/after both signed CLI and
native runs found the same 257 quarantined key/raw payloads and four publisher
filenames. Digest remained
26497a527c186fd9cacc640d26701f00a7c408c4ddff503c0234e7db15e5dadb.
The earlier isolation escape did not recur.

## Installed acceptance — complete on this Mac

The running 1.3.70 app quit normally with the FW3GT draft retained. Fresh complete
backup, including Integration Services, workspace, native state, WebKit and
preferences:
/Users/oliver/Documents/Backups/OM0RX-xLog/HM-Control-performance-1.3.71-before-install-20261101T034553+0930.
The database remained byte-identical before the first updated launch:
936a4156cb3c82516aa69f058177ecafb7f897966166db4569e80a5bf5677f48.

Atomic replacement retained prior 1.3.70 at
/Applications/OM0RX-xLog-previous-20261031T181653Z-4663.app.
Installed main/worker/CW hashes exactly matched the table. App PID 4711 and
worker PID 4732 were verified by process-only inspection with exact installed
paths, matching parentage and zero private arguments before GUI binding.

The restored FW3GT intelligence resolved automatically to QRZ, Gavin GM3GAV,
Wallis and Futuna Islands, DXCC 298 and AH05wr. No manual Retry lookup or draft
input was needed. The draft kept its call, 14.001000 MHz, CW/20m, 599 reports,
name, comment “up”, grid, country and IOTA OC-118. The radio remained connected
at 14.003810 MHz CW. The existing Scotland history row was present.

Window → HM Control connected without manual Reconnect on this final build.
It displayed the same 69,556 contacts, direct-agent radio, live PSKReporter
and 11 tracked satellites. The previously qualified shared-cluster integration
is unchanged. HM was closed after verification and Operator Desk left active,
with the resolved lookup and pending draft intact.

Read-only ledger checks preserved all 257 pre-install quarantine key/payload
pairs byte-exactly, with zero missing or altered entries. At 18:17:55 UTC, 23
fresh normal_logging/direct_agent/radio1 receipts postdated this installation's
start; no pending deliveries or active leases remained. These are actual
software transport acknowledgements from the installed worker, not fixtures.

Final contact integrity passed: all 69,556 original live contact IDs remained,
no original contact was missing, no HM16/HM17 acceptance/projection marker
reached production, and the N0PERF count remained zero. No production test QSO
was logged and no manual RF/QSY/rotor test input was sent.

Keep paired backup/app rollback assets and the 1.3.69 incident evidence. Its
pre-migration historical-byte limitation is not replaced by the later exact
pre-install comparisons. This is accepted for the installed current Mac;
physical Maestro LCD observation, measured physical rotor-stop timing, extended
hardware/provider soak and all-platform public-release qualification are outside
this acceptance. Cold opening/full rebuilding can still take several seconds.
