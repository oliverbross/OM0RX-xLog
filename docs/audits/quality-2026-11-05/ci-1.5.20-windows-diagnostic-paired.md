# Windows-only 1.5.20 paired diagnostic — acceptance FAILED

[Run 42040743706](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42040743706) executed QA source **038d542b8c35dbd8e47451f4849e8f3a600a4e4b** against unchanged package **1.5.20 / 3d9cb0981c30764f1188db350ffebc22a5f328a7**, original run **42016723457**, artifact **13413349502**, SHA-256 **3869a453e665320c4fe19662595b616cebb61d8217a1e6ea80a99ac99db3d41f**. No application rebuild, packaging or version change occurred.

| Job | Conclusion |
|---|---|
| Windows fresh-runner runtime acceptance (currentUser) | FAILURE |
| Windows fresh-runner runtime acceptance (perMachine) | FAILURE |
| Linux runtime-only container acceptance | SKIPPED |
| prototype | SKIPPED |

Both installed-scope assertions again failed with the retained generic **local_self_test_failed** reply (SHA-256 **5ef8c6c6ffd142991cd5f02021c699a59058ea6d848d10db0fb250003c1e0b3e**). Original installed worker exit remains **UNOBSERVED**, while scope step exit1 is observed. Portable GUI/worker steps passed. Silent default, registry and shortcut checks passed at observed defaults normalized to **%LOCALAPPDATA%\OM0RX-xLog** and **%ProgramFiles%\OM0RX-xLog**. Installed GUI, uninstall and marker preservation were not reached.

Both diagnostic steps completed all six probes. **Every child was independently identity-verified before Resume, resumed once, exited with a confirmed actual exit code, and completed pipe drains without timeout/truncation.** Mandatory owned-handle image, PID/parent/full-command-line and positive creation proof passed; null CIM image is retained as optional redundant data under QA038 policy. The unchanged worker SHA-256 is **2dd9a007937b0cee8240bc73785a76ce2fbe4cc6a6dbe9dcde5114abce5593e5**.

| Scope | Order | Worker | Condition | TEMP UTF-16 length | Actual exit | Self-test contract |
|---|---:|---|---|---:|---:|---|
| currentUser | 1 | portable | A | 92 | 1 | FAIL |
| currentUser | 2 | installed | A | 92 | 1 | FAIL |
| currentUser | 3 | portable | B | 23 | 0 | PASS |
| currentUser | 4 | installed | B | 23 | 0 | PASS |
| currentUser | 5 | portable | A | 92 | 1 | FAIL |
| currentUser | 6 | installed | A | 92 | 1 | FAIL |
| perMachine | 1 | portable | A | 91 | 1 | FAIL |
| perMachine | 2 | installed | A | 91 | 1 | FAIL |
| perMachine | 3 | portable | B | 23 | 0 | PASS |
| perMachine | 4 | installed | B | 23 | 0 | PASS |
| perMachine | 5 | portable | A | 91 | 1 | FAIL |
| perMachine | 6 | installed | A | 91 | 1 | FAIL |

All A replies are **ok:false / local_self_test_failed**, stdout 131 bytes; all B replies are **ok:true / passed:true / award_programmes192 / network_contact:false / station_io:false**, stdout 375 bytes. All twelve stderr streams are empty. Full raw stdout/stderr and identities remain private; hashes and parsed replies are retained in the companion JSON. These child exits are observed, unlike the original acceptance worker exit.

Within each host, only **TEMP and TMP** changed between A and B. A used the original nested disposable acceptance-profile Temp; B used a newly created strictly shorter marked root owned under RUNNER_TEMP. Restored A exactly equals first A. CWD, PATH, USERPROFILE, APPDATA, LOCALAPPDATA and WEBVIEW2_USER_DATA_FOLDER remained common; retained controlled values and all non-TEMP inherited value lengths match. The full non-TEMP environment hash was asserted equal before every launch, and parent environment was unchanged. Raw roots/identifiers remain private. Both 3270-file payloads were validated before and after probes; payloadsUnchangedAfterProbes=true.

This reproduces **TEMP/TMP-root sensitivity** for both portable and installed workers: **A1 fail1 → B pass0 → A2 fail1**. It does not isolate root length from root content, state, location or other filesystem properties, establish a Windows long-path mechanism, or expose the underlying caught operation. The common diagnostic suspended-create/resume-once launch differs from original acceptance. **B success is diagnostic evidence, not installed acceptance**; both scope jobs and all prior failed runs remain failed.

| Artifact ID | Bytes | ZIP SHA-256 |
|---|---:|---|
| 13420891691 | 369183 | 7898f1b9544628eb55f7098a16de08fb7c184bb7631c0c4d2c91212f6b0d34a0 |
| 13420349503 | 473848 | 4eab5ded248dbd21557a7567126205b3ca142976b3c9a00215f21f858e5da8d2 |

Both artifact ZIPs and final job logs were downloaded/hash-verified. Ordinary QA CI **42040740696 passed**. Verified redundant push **42040740653 was cancelled**, not passed. Build and Linux jobs were skipped. Hosted elevated results do not qualify ordinary-user/UAC/hardware operation; no retry or application edit was performed by this monitoring agent.
