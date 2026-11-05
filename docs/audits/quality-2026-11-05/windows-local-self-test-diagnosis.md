# Installed Windows local-logbook diagnosis

The [original 1.5.20 gate](ci-1.5.20-original.md) passed all builds and Linux
native acceptance. Both Windows scopes passed portable native checks, real
silent default paths without `/D`, registry/shortcut scope and all 3,270
installed payload hashes. Their installed local-logbook self-tests then failed;
installed GUI/uninstall/marker checks were not reached. Original failed replies
were not retained. The inner cause remains **undetermined**.

The installed and portable worker bytes are identical:
`2dd9a007937b0cee8240bc73785a76ce2fbe4cc6a6dbe9dcde5114abce5593e5`,
source `3d9cb0981c30764f1188db350ffebc22a5f328a7`, version 1.5.20. The inner
`LocalLogbookSelfTest` checks catalogue count 192 and hardcodes that same count
on success. A stale outer count is not established by this failure; no count
is changed. Its generic catch hides which workspace/settings/import/CTY/backup/
restore/reopen/export operation failed.

QA-only `b3a72f06` persists parsed local/self-test replies before their unchanged
assertions and shutdown checks. Seven behavioral tests execute the actual
PowerShell try/finally blocks with fake process I/O and the real writer/asserts:
the pre-change source fails all seven regression cases; the changed source
passes. Wrong count 191 still fails. No application bytes were rebuilt.

The controlled diagnostic uses the unchanged 1.5.20 packages. It requires exact
source/version/default-directory/hive/shortcut receipts, the successful native
payload checkpoint, and rehashes both full payloads before and after probing.
The original nested private TEMP and a fresh shorter private TEMP are compared
for both portable and installed workers in A/B/A order (six children maximum).
CWD, profile, APPDATA, LOCALAPPDATA and a common PATH remain fixed; only TEMP/TMP
vary within each pair. A path-length explanation is a **hypothesis**, not a
conclusion or a reason to shorten the acceptance fixture.

Every child receives only the existing disposable `--local-logbook-self-test`
flag. Common suspended creation allows OS executable/full-arguments/parent
proof before one resume and any output observation. That launch differs from
the original harness and is recorded. The same 10-second response budget starts
at resume, including loader execution. Output prefixes are bounded to 65,536
bytes per stream. Cleanup targets only the newly created process handle;
unverified never-resumed children abort without executing application code.
Raw coordinates and replies stay private. A complete diagnostic matrix is not
acceptance success, and the original failed gate is never relabelled.

Before Windows execution, 34 diagnostic contracts, seven receipt contracts,
PowerShell syntax (ten scripts), policy checks and workflow YAML validation
passed. The diagnostic tests compile the C# declarations and check 64-bit ABI
layouts without calling a Windows API or launching an app/worker on the Mac.
At that point, actual Windows launch/CIM/pipe behavior and paired outcomes
were untested. The guarded native attempts below do not establish paired outcomes.
The runtime-only workflow records QA-executor and package-source SHAs separately;
it reuses original run `42016723457` without an application rebuild. Matrix,
assertions, install paths, guards and deadlines are unchanged.

## Initial native diagnostic attempt

[Windows-only recheck 42034725192](ci-1.5.20-windows-diagnostic-initial.md)
used QA source `2dc63d1e7654c92d0d5614085427e36e9ef1ab72` and the unchanged
original 1.5.20 packages. Both installed self-tests failed again. Early replies
are now retained and contain `ok:false` / `local_self_test_failed`, with no
result/count fields. Their worker exit was not captured; only the scope-step
exit 1 is observed. The generic response still identifies no inner operation.

The diagnostic itself stopped before creating any children: the top-level
receipt-property check passed a `PSNoteProperty` into a Boolean parameter.
Both reports contain zero runs; no A/B/A outcome or path cause exists. This
QA preflight error is separate from the installed-worker failure.

The minimal correction makes property presence explicitly Boolean. A new test
executes that exact top-level command AST with a real present `PSNoteProperty`
and with the property missing. The old command fails on the valid property;
the corrected command accepts it and still rejects the missing property.
All 35 diagnostic contracts plus seven receipt cases, ten-script syntax and
policy checks pass locally. No launch, payload, TEMP, count, guard or deadline
policy changed. The native identity attempt below used that correction.

## Native identity attempt before resume

[Windows-only recheck 42036670843](ci-1.5.20-windows-diagnostic-identity.md)
used QA executor `ca7dfbaeddf2ae72cc601a5f3d98f4d8c86166a9` and the same
package source `3d9cb0981c30764f1188db350ffebc22a5f328a7`. Builds and Linux
were skipped; both fresh Windows scopes failed their unchanged installed
local-logbook assertions again. Both retained `ok:false` /
`local_self_test_failed`. Installed-worker exit remains **unobserved**;
the scope-step exit 1 is observed. Installed GUI, uninstall and marker
retention were not reached.

Each diagnostic created one owned suspended portable/A child, then failed
`OS image/PID/PPID proof failed before Resume.` Identity verification remained
false. Cleanup confirmed `resumed=false`, `abortedBeforeResume=true`,
`exitConfirmed=true` and supervisor abort exit 125. Both output streams
contained zero bytes. That cleanup code is not a worker self-test result.

The independent OS-observed PID, parent PID, executable path and command line,
plus `QueryFullProcessImageName` and creation-time operands, were
**NOT RETAINED**. Only the requested command line and returned creation PID
are available privately; they do not replace independent OS identity proof.
The missing observations prevent identifying which comparison failed.

Consequently **zero self-test probes resumed**. No short-TEMP/B or repeat-A
case ran, so there is no A/B/A result, path-length diagnosis or application
cause established by this attempt. No OS-proof requirement, guard, deadline,
count or fixture policy was relaxed. Raw process/path/profile coordinates
remain private; the published reports normalize observed defaults to their
verified Windows known-folder tokens.

The next QA-only correction independently captures all CIM fields, the
owned-handle image query and creation time, including nulls and bounded error
metadata. Expected PID/parent/image/arguments/hash and unverified observations
are written privately before validation. The existing image/PID/parent/full
arguments/creation/hash predicates and resume/cleanup policy are retained.
Three tests execute the actual capture-through-resume source region with null
CIM image, failing native probes and failing CIM query; each persists the
independent observations before the unchanged guard rejects, with zero resumes.
All 38 diagnostic and seven receipt contracts, ten-script syntax, installer
policy and workflow YAML checks pass locally. Independent review found no
actionable issue. These Mac-side tests make no Windows API or application
calls; the next Windows-only check will reuse the original package bytes.

## Observed null CIM image with positive owned-handle image

[Recheck 42039550660](ci-1.5.20-windows-diagnostic-observation.md) used QA
executor f68caff24dc171268b90eafd121f94ad8462363e and the unchanged 1.5.20
package source 3d9cb0981c30764f1188db350ffebc22a5f328a7. Both installed
scope assertions failed again with the retained generic local_self_test_failed
reply. Installed worker exit remains unobserved; scope exit 1 is observed.

Unlike the prior ca7 attempt, this run retained independent OS observations.
Both CIM queries returned one object with no error. PID and parent PID matched
expected values; full CommandLine matched exactly. ExecutablePath was present
but **null**, with no field error. Independent owned-handle image queries
positively matched the expected worker; creation times were observed and positive.
Public reports retain comparison booleans, with raw coordinates kept private.

The exact failed operand was the required CIM executable-path comparison.
The f68 guard required that match in addition to the positive owned-handle image,
so neither child resumed. Later argv/creation/hash assertions were not reached;
observed command equality and creation positivity do not claim they executed.
Both owned children were aborted before Resume with cleanup exit125, confirmed
exit and empty streams. Zero probes resumed; B and repeat-A were not run.
There is no TEMP-length or application-cause conclusion.

Microsoft marks [Win32_Process.ExecutablePath](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process)
with a SeDebugPrivilege qualifier. Actual privilege absence or the reason for
the null field is unproven. [QueryFullProcessImageNameW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew)
returns the full executable image name through the owned process handle;
flags0 selects Win32 path format. That independent proof succeeded here.

The next QA-only source 038d542b8c35dbd8e47451f4849e8f3a600a4e4b requires
the matching owned-handle image and rejects any nonempty contradicting CIM image.
This changes the redundant CIM availability requirement; PID/parent, full
arguments, creation/hash and cleanup requirements remain. Its Windows-only
run 42040743706 was pending when the f68 report was published; the completed
outcome follows below. This failed f68 run does not qualify that correction
or any A/B/A result.

## Completed controlled A/B/A matrix, acceptance still failed

[Run 42040743706](ci-1.5.20-windows-diagnostic-paired.md) used QA 038d542b
and the unchanged 1.5.20 package source 3d9cb098. Both fresh installed-scope
assertions failed again. The diagnostic completed six verified/resumed children
per host, with all actual exits confirmed and no timeout or pipe truncation.

For both portable and installed workers on both hosts, original nested TEMP/TMP
(A1) failed exit 1, short owned TEMP/TMP (B) passed exit 0 with award_programmes 192,
and restored original TEMP/TMP (A2) failed exit 1 again. A roots measured 92 UTF-16
characters for currentUser and 91 for perMachine; B roots measured 23. All A
responses were generic local_self_test_failed; all B responses passed with
network_contact=false and station_io=false. Every stderr stream was empty.

Within each host only TEMP/TMP changed. CWD, PATH, USERPROFILE, APPDATA,
LOCALAPPDATA and WEBVIEW2_USER_DATA_FOLDER stayed common. Captured controlled
values/non-TEMP variable lengths agree, the full non-TEMP environment hash was
asserted equal before every launch, and the parent environment stayed unchanged.
Both 3270-file payloads were validated before and after all probes. All 12 children
passed the mandatory owned-handle image and other pre-resume identity guards.

This establishes reversible TEMP/TMP-root sensitivity under the controlled
diagnostic launch for both byte-identical portable and installed workers. Root
length, content, location, state and other filesystem properties changed together;
no threshold, Windows long-path mechanism or underlying caught operation is
established. The common suspended-create/resume-once diagnostic launch differs
from original acceptance. Diagnostic B success does not turn either failed
installed acceptance into a pass. Installed GUI/uninstall/marker preservation
remain not reached, and ordinary-user/UAC/hardware qualification remains open.

## Bounded staged RPC preparation

`diagnose-windows-local-rpc.ps1` uses only the existing
`--local-ui-acceptance` mode of the unchanged 1.5.20 worker. It requires the
completed six-run paired evidence, exact source/payload/default-install receipts,
and the same original nested TEMP, CWD, profile and full non-TEMP environment
hash. Both diagnostics run within one workflow step so GitHub's per-step
environment coordinates do not introduce another factor.

At most two sequential workers are permitted, with the first failure stopping
the whole replay. Each has a total ten-second budget from process start,
including loader, identity proof, 21 local RPC stages and EOF. A positively live
owned process, OS image/PID/parent/full arguments/creation time and binary hash
are checked before RPC or output reads. Requests, bounded chunks/replies and
stage outcomes are saved privately before advancing. Cleanup attempts EOF;
an EOF-close error still proceeds to retirement within the original deadline.
Only the owned worker may be terminated after that deadline.

This mode creates a differently named temporary root, seeds 137 synthetic spot
history rows, disables native preference inheritance and initializes LiveWorker
lanes. EOF deletes the generated workspace/defaults. Backup restore reopens the
database but does not reproduce the direct test's final fresh-service reopen.
A replay pass therefore narrows the failure without clearing it. No GUI,
normal-mode worker, station or network method is used.

Local checks passed: 50 new RPC, 45 paired-diagnostic and seven failure-receipt
contracts, twelve-script syntax, installer policy and workflow YAML validation.
The tests make zero native API calls or worker launches; independent review
found no remaining actionable issue. A separate signed Mac 1.5.20 private CLI
shape check completed all 21 stages in about 0.9 seconds and normal EOF exit 0;
its largest frame was the 61,923-byte catalogue with unchanged total 192.
That check validates result shapes, not Windows behavior or a latency budget.
Actual Windows staged execution remains pending this QA-only preparation.

## Bounded RPC replay localizes the first failed endpoint

[Run 42044140753](ci-1.5.20-windows-diagnostic-rpc.md), QA source 35efbb13,
reused the same application/package source 3d9cb098. Both original installed
assertions remained failed. Both hosts repeated the six verified direct A/B/A
probes with the same reversible failure/pass/failure pattern and stable payloads.

In the same workflow step, paired receipt/source/payload ownership and the full
non-TEMP environment hash passed before RPC. Original nested TEMP, CWD/profile
and PATH remained fixed. Each host launched only one identity-verified portable
worker with sole --local-ui-acceptance. The first 18 RPC stages passed, including
settings, import/edit/stats/resources, backup_create, delete and undo. Stage 19,
backup_restore, returned ok:false with code operation_failed and the generic
message “Operation failed. Check the connection or configuration; no success has
been confirmed.” Correlation matched on both hosts; raw replies are retained.

Global first-failure policy prevented any installed RPC worker. EOF cleanup
confirmed both owned exits 0 with empty stderr and no timeout termination, within
2351 ms for currentUser and 2469 ms for perMachine (total budget 10000 ms each).
Post-restore settings/export and successful replay completion were not reached.
Pre-RPC payload validation passed; post-RPC payload validation was not reached
after failure, distinct from the earlier paired post-probe payload proof.

This localizes the acceptance-only endpoint failure without exposing its caught
operation or proving the direct self-test failed on the identical exception.
The acceptance-only worker precreates a differently named root, seeds 137
spot-history rows, disables native preference inheritance and initializes
LiveWorker lanes. EOF deletes its workspace/defaults, with no final fresh-service
reopen. These differences and the generic reply leave the underlying mechanism
unproven; no path-length threshold or Windows long-path cause is claimed.
Installed GUI/uninstall/marker preservation and ordinary-user/UAC qualification
remain open. No retry, application edit or acceptance-policy change occurred.
