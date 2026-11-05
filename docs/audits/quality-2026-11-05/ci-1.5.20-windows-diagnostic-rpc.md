# Windows-only 1.5.20 bounded RPC diagnosis — FAILED

[Run 42044140753](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42044140753) used QA source **35efbb1344ad675f4b75cec586355450a88eeeb7** against unchanged application **1.5.20 / 3d9cb0981c30764f1188db350ffebc22a5f328a7**, original package run **42016723457**, artifact **13413349502**, SHA-256 **3869a453e665320c4fe19662595b616cebb61d8217a1e6ea80a99ac99db3d41f**. No application rebuild or version change occurred.

| Job | Conclusion |
|---|---|
| Windows fresh-runner runtime acceptance (currentUser) | FAILURE |
| Windows fresh-runner runtime acceptance (perMachine) | FAILURE |
| prototype | SKIPPED |
| Linux runtime-only container acceptance | SKIPPED |

Both original installed assertions again failed with retained **local_self_test_failed** replies. Original installed worker exits remain **UNOBSERVED**; scope step exits1 are observed. Portable GUI/worker steps passed; actual silent default/registry/shortcut checks passed. Public observed defaults normalize to **%LOCALAPPDATA%\OM0RX-xLog** and **%ProgramFiles%\OM0RX-xLog**. Installed GUI, uninstall and marker preservation were not reached.

Both hosts repeated all six direct probes: portable and installed **A1 fail exit1 → B pass exit0 → A2 fail exit1**, with all twelve identity proofs/exits confirmed, no timeouts and stable 3270-file payloads after the paired probes. The RPC helper then passed paired-receipt/source/payload ownership and full non-TEMP environment-hash preflight **in the same workflow step**, preserving original nested TEMP, CWD/profile and common PATH.

On **both hosts**, the first portable RPC worker passed **18 stages**, then **stage19 backup_restore** returned **ok:false / operation_failed**, message “Operation failed. Check the connection or configuration; no success has been confirmed.” **Request/reply correlation matched**, so this is an actual error reply. All raw requests/replies and their hashes were retained privately. The prior stages passed health/workspace/settings, ADIF import/edit/list/stats, catalogue192/country resources, backup_create, delete, undo, list and second delete.

| Scope | Stage | Method | Outcome | Elapsed end ms |
|---|---:|---|---|---:|
| currentUser | 1 | health | PASSED | 266 |
| currentUser | 2 | workspace_status | PASSED | 272 |
| currentUser | 3 | workspace_create | PASSED | 322 |
| currentUser | 4 | settings_load | PASSED | 332 |
| currentUser | 5 | settings_load | PASSED | 343 |
| currentUser | 6 | settings_save | PASSED | 368 |
| currentUser | 7 | logbook_import_adif | PASSED | 381 |
| currentUser | 8 | logbook_list | PASSED | 405 |
| currentUser | 9 | logbook_save | PASSED | 434 |
| currentUser | 10 | logbook_stats | PASSED | 1538 |
| currentUser | 11 | logbook_catalog | PASSED | 1860 |
| currentUser | 12 | logbook_country_facts | PASSED | 1994 |
| currentUser | 13 | backup_create | PASSED | 2057 |
| currentUser | 14 | logbook_delete | PASSED | 2067 |
| currentUser | 15 | logbook_list | PASSED | 2086 |
| currentUser | 16 | logbook_undo | PASSED | 2095 |
| currentUser | 17 | logbook_list | PASSED | 2117 |
| currentUser | 18 | logbook_delete | PASSED | 2125 |
| currentUser | 19 | backup_restore | FAILED | 2321 |
| perMachine | 1 | health | PASSED | 249 |
| perMachine | 2 | workspace_status | PASSED | 254 |
| perMachine | 3 | workspace_create | PASSED | 306 |
| perMachine | 4 | settings_load | PASSED | 318 |
| perMachine | 5 | settings_load | PASSED | 331 |
| perMachine | 6 | settings_save | PASSED | 360 |
| perMachine | 7 | logbook_import_adif | PASSED | 386 |
| perMachine | 8 | logbook_list | PASSED | 414 |
| perMachine | 9 | logbook_save | PASSED | 427 |
| perMachine | 10 | logbook_stats | PASSED | 1645 |
| perMachine | 11 | logbook_catalog | PASSED | 1972 |
| perMachine | 12 | logbook_country_facts | PASSED | 2093 |
| perMachine | 13 | backup_create | PASSED | 2156 |
| perMachine | 14 | logbook_delete | PASSED | 2166 |
| perMachine | 15 | logbook_list | PASSED | 2187 |
| perMachine | 16 | logbook_undo | PASSED | 2196 |
| perMachine | 17 | logbook_list | PASSED | 2218 |
| perMachine | 18 | logbook_delete | PASSED | 2227 |
| perMachine | 19 | backup_restore | FAILED | 2438 |

Both RPC children passed independent image/PID/parent/arguments/creation/hash proof before any RPC. Each helper stopped globally at this first failure; **no installed RPC child was launched**. Cleanup sent **EOF**, and actual owned exit **0** was confirmed, with **0 stderr bytes**, no owned timeout termination. CurrentUser elapsed **2322 ms before / 2351 ms after cleanup**; perMachine **2440 / 2469 ms**, within the unchanged total **10000 ms** per-child budget. Normal successful replay completion was not reached.

Both payloads and worker hashes were validated before RPC; the paired probe's post-payload proof passed. **Post-RPC payload validation was NOT REACHED** after stage19 failed. Post-restore settings_load, ADIF export and the installed replay were not run. Do not infer post-RPC payload proof from the earlier paired proof.

This localizes a failure to the acceptance-only **backup_restore** endpoint under the original nested TEMP. It does not expose the caught operation or prove that the direct self-test failed on the identical exception. RPC uses sole **--local-ui-acceptance**, with a different generated root basename, precreated workspace, 137 spot-history seed rows, disabled native preference inheritance and initialized LiveWorker lanes. EOF deletes that workspace/defaults; there is no final fresh-service/process reopen. No Windows long-path mechanism, root-length threshold or application fix is established. Both installed acceptance jobs remain failed.

| Artifact ID | Bytes | ZIP SHA-256 |
|---|---:|---|
| 13423743450 | 484091 | 92ae84ca162f543e86bee38878e8c9f6be06670c3bd839ba0f99d1d8e760a486 |
| 13422998561 | 485325 | 89819d25c9c8d170f4af70c3fd9e548e5e17022d18b321f28b27b1f3dee57492 |

Both ZIPs and final logs were downloaded/hash-verified. Ordinary QA CI **42044138560 passed**; verified redundant push **42044138534 was cancelled**, not passed. Build/Linux jobs were skipped. Hosted elevated results do not qualify ordinary-user/UAC/hardware operation. No retry or source change was performed by this monitoring agent.
