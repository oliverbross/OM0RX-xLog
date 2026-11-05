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
Actual Windows launch/CIM/pipe behavior and paired outcomes remain pending.
The runtime-only workflow records QA-executor and package-source SHAs separately;
it reuses original run `42016723457` without an application rebuild. Matrix,
assertions, install paths, guards and deadlines are unchanged.
