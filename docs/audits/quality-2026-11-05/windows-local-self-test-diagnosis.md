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
