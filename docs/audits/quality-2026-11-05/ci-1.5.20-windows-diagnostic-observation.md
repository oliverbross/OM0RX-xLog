# Windows-only 1.5.20 identity observation — FAILED before Resume

[Run 42039550660](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42039550660) used QA executor **f68caff24dc171268b90eafd121f94ad8462363e** against unchanged application/package source **3d9cb0981c30764f1188db350ffebc22a5f328a7**, version **1.5.20**, original package run **42016723457**, artifact **13413349502** (SHA-256 **3869a453e665320c4fe19662595b616cebb61d8217a1e6ea80a99ac99db3d41f**). No application rebuild or package/version/TEMP/deadline change occurred.

| Job | Conclusion |
|---|---|
| Windows fresh-runner runtime acceptance (perMachine) | FAILURE |
| Windows fresh-runner runtime acceptance (currentUser) | FAILURE |
| Linux runtime-only container acceptance | SKIPPED |
| prototype | SKIPPED |

Both installed scopes again retained **ok:false / local_self_test_failed**, message “Local logbook acceptance failed.” Each early reply SHA-256 is **5ef8c6c6ffd142991cd5f02021c699a59058ea6d848d10db0fb250003c1e0b3e**. Installed worker exit remains **UNOBSERVED**; scope step exit **1** is observed. Silent default-path, registry and shortcut checks passed. Public defaults map actual equality-checked roots to **%LOCALAPPDATA%\OM0RX-xLog** and **%ProgramFiles%\OM0RX-xLog**; raw coordinates remain private. Installed GUI, uninstall and marker preservation were not reached.

Each diagnostic created one owned suspended portable/A child. Both CIM queries returned one object, status observed, error null. PID and parent PID matched expected values; retained CommandLine exactly matched expected full CommandLine. **ExecutablePath was present but its value was null, error null**; its required same-path comparison was false. The independent owned-handle image query succeeded, error null, and matched the expected executable. Creation time was observed, error null and positive. Numeric identifiers, timestamps and paths are retained privately; published comparisons are booleans.

The f68 guard required both CIM image and owned-handle image matches, so it rejected the null CIM image with **“OS image/PID/PPID proof failed before Resume.”** Later argv, creation and hash assertions were **NOT REACHED**. Retained command equality and positive creation time are derived comparisons, not claims that those later assertions executed. No exact expected creation timestamp was recorded.

Both cleanups confirm **resumed=false, abortedBeforeResume=true, exitConfirmed=true**, supervisor abort **125**, **0 stdout / 0 stderr bytes**. Thus **zero self-test probes resumed**; B and repeat-A were not run. Abort125 is not an application self-test exit. No A/B/A, TEMP-length or application-cause conclusion follows.

Microsoft documents a SeDebugPrivilege qualifier for [Win32_Process.ExecutablePath](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process); the actual privilege state and cause of null are unproven. [QueryFullProcessImageNameW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew) supplies the full executable image name from a process handle, with flags0 selecting Win32 path format. Both current receipts positively matched that owned-handle image.

| Artifact ID | Bytes | ZIP SHA-256 |
|---|---:|---|
| 13420895223 | 446581 | ad97108a25c4d48c566979cda94c3d6460e6a239f706e8e389e7377ec01b1374 |
| 13419703897 | 443880 | a020c350b52d123da49dcf179e57a7cdce52af4f3746e35b8c398bfcb881310a |

Both artifact ZIPs and final logs were downloaded/hash-verified. QA CI **42039547815 passed**; verified redundant push **42039547877 was cancelled**, not passed. Original20, QA2dc and QAca7 failures remain unchanged. Hosted elevated scope checks do not qualify ordinary-user/UAC/hardware operation.

The separate QA correction **038d542b8c35dbd8e47451f4849e8f3a600a4e4b** makes matching owned-handle image mandatory and rejects any nonempty contradicting CIM image; it changes the CIM availability requirement while retaining the other identity/argument/creation/hash/cleanup requirements. Its newly dispatched [run 42040743706](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42040743706) has a separate outcome, not qualified by this report. It reuses the same application bytes.
