# HM Control and operating repairs — 1.3.71

## Scope and carried qualification

This candidate advances installed 1.3.70 to repair a persistent callsign lookup
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
