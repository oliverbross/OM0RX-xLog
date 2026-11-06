# Candidate 1.5.22 packaged qualification — HELD

The original [all-platform run42139380197](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42139380197), attempt1, **FAILED**. All three build jobs and both Windows fresh-scope jobs passed. Linux runtime acceptance failed an unlabelled assertion, then its evidence upload failed. No complete Linux runtime acceptance is claimed.

Version1.5.22/source `fc7909d63aa0f4d9fd9abf278c2b08bfd557cdd5` is immutable for these packages. Root dispatched `all`, `validation_only=false`, `package_macos=false`, with no older runtime run/source inputs. Actual matrix/package branches and same-run Windows QA bindings agree. There was no retry, cancellation, dispatch, rebuild, installation or application launch by the audit owner.

The [sanitized combined receipt](ci-1.5.22-original.json) is SHA256 `5529b533ecb7baeb92b944acd955f8811af80f5fbe12bb88844b1b6c492e9f34`. Raw original logs, API metadata, ZIP bytes and independent audit receipts remain intact in this ignored run folder.

| Original job | ID | Actual result |
|---|---|---|
| Linux build/package |127635563851|PASS |
| Windows build/portable/two EXEs |127635564030|PASS |
| Mac source build/tests |127635564358|PASS; hosted Mac distribution intentionally skipped |
| Linux runtime |127664728886|FAIL; assertion and secondary upload failure |
| Windows currentUser runtime |127664728936|PASS |
| Windows perMachine runtime |127664729139|PASS |

All three frontend suites passed384files/5,258tests. The actual Ubuntu lifecycle regression ran12tests in10.412s, OK, no skips/failures. Its raw block SHA256 is `8b395bb4b5c7a6edb7fae4d2d0b4fd182c77f88fe6061bd4e441dad0e4d818ee`. This is actual Linux source QA, distinct from packaged GUI acceptance. Platform core suites retain their actual skip counts in [source-gates-1.5.22-audit-v2.json](source-gates-1.5.22-audit-v2.json).

## Actual Linux bytes: PASS; runtime: FAIL / reports unavailable

The315,737,277-byte GitHub artifact ZIP matched digest `7c2a9190aaa51c5718a5bf94cabf0cdcac186d6f885533341e910c49f383f64a`. Actual tar/DEB sidecars, every tar member and every DEB data/control member were compared with the complete payload inventories and privacy scans. The shared runtime has1,013files; DEB data has1,016files and its staging scan1,017including control. Zero scan findings. Source/version, x86_64 ELF images, configuration and Cargo lock matched. No packaged file was executed by this byte audit.

| Linux distribution | SHA256 |
|---|---|
| tar.gz | `da408986be0b11e4a276e8a30ba58c30509f6e31cb0037cd7d309992b8bbf825` |
| DEB | `0497e2ba66deeba815949f0b40ff901c9690a166451fc93b2d921846fa731454` |
| Runtime manifest | `0c8fb741077f7cee67b8896d0d3ef9b1a54194aedb1d923edcd2a4b3d98251c1` |
| Host | `c7792597cf96e1990290b665b95d86dd1b6dcf993d986b72785b92d6b19bd612` |
| Worker | `04df0354db564ff1174e853fee20b0fbe0af2c5a700eca9cb83ae3c0264c1fa1` |

At02:09:37UTC the original runtime log records only `<stdin> line5 AssertionError`. That line can identify either the X11 report scope assertion or nested-Wayland report schema/status assertion; no journey label or operand was printed. A specific failed journey/check or application cause is **UNKNOWN**.

The uploader selected47files but failed with EACCES opening `ui-1.process.host.json`. The QA receipt writer makes these files0600 under Docker UID10001, while the host uploader has a different UID. No Linux acceptance artifact is available from the original run. Actual X11/Wayland check tables, host wait/cleanup inventory and worker outcome receipts therefore remain unavailable. No clean worker EOF is inferred. The installed payload scan printed PASS/1,013/zero findings before runtime, which does not qualify the later GUI journey.

The full failed original log is274,603bytes, SHA256 `607f53760bcd8837395822d23d66919698804db83222e401e724bdcf1bbe4c81`. Its failure and the upload failure stay separate. A later root-approved QA-only ownership/labelled-diagnostic follow-up must identify its executor source and reuse these exact S22 package bytes; it cannot erase or relabel this original failure. No follow-up was dispatched by this owner. See [Linux byte audit](linux-package-1.5.22-audit.json).

## Actual Windows hosted scopes: PASS

The198,613,986-byte GitHub distribution artifact matched digest `bfe0046e8a1ca1a264e8c24dabb839464ed94207811d1331e0c95d95e2a74154`. Portable ZIP and both EXEs matched their sidecars. All3,270manifest entries plus the manifest itself (3,271actual payload files) matched exact bytes/inventory and the scan, with zero findings. Both scope configurations are identical except install mode and reference the same manifest/main as the actual portable ZIP. Installed payload checks subsequently passed in each fresh runner.

| Windows artifact | SHA256 |
|---|---|
| Portable ZIP | `ebb18bbc92c096b71c28bfb1fa6a303d0bda0b5f9d1edc3680fc560937dd1f3e` |
| currentUser EXE | `97cf4954326dee9efb6295f275160ee639b58d4813b692e240bea5914d762163` |
| perMachine EXE | `fafeb2f3ff579c05d26e8c65ba8e7987aed0f5e46a68053b52bd922adf013d7d` |
| Payload manifest | `18bea979d87fbd2cb84c7c87903b134e82e61009b5fa627bcf0806b2815ed0c2` |
| Host | `24f965be24ab90689b9f049290ceda956b7aa539d473f11fa5c412471b452967` |
| Worker | `deb7c02b793cb7c21764d52368afa901320a562e35c1276752e6eef5f323c488` |

| Fresh hosted scope | Actual default / registry | Installed result |
|---|---|---|
| currentUser | `%LOCALAPPDATA%\OM0RX-xLog` / HKCU | Default path, shortcut, payload, native runtime, uninstall and owned marker PASS |
| perMachine | `%ProgramFiles%\OM0RX-xLog` / HKLM | Default path, shortcut, payload, native runtime, uninstall and owned marker PASS |

The source harness uses the real silent defaults without `/D`; interactive path chooser acceptance is NOT RUN. Each scope passed the original hard192 local self-test, including backup/restore, under the original nested TEMP (currentUser92/perMachine91 UTF16units), without a shortened diagnostic TEMP. Each installed context ran two GUI journeys with all36checks true; each portable context did the same (four installed and four portable GUI runs total). Direct worker framing/self-test checks retained original stdin EOF/exit0/no extra output and10s response/EOF bounds; GUI timeout stayed100s. These direct-worker outcomes do not invent an app-owned GUI-worker EOF receipt.

Both jobs used elevated Server2022 runners with WebView2 present and fresh no-Swift probe checks. Marker preservation covers only a harness-owned LocalAppData marker; existing contacts, settings and media were not read. These CI receipts explicitly leave ordinary Win11, interactive UAC/default chooser, Finish-token, upgrade/rollback, absent-WebView2, external media and equipment qualification open. Root's ordinary-account version20/21 observations are separate and are not relabelled as manual22 acceptance. Checksums provide integrity, not publisher authenticity for unsigned beta EXEs.

See [Windows byte audit](windows-package-1.5.22-audit.json) and [actual runtime audit](windows-runtime-1.5.22-audit.json). Linux and Windows development executables/locks and portable Swift pin receipts were also verified; Windows source text differs only by exact recorded LF-to-CRLF checkout conversion. Eight owned Linux/Windows artifacts were downloaded once and digest-verified. Mac development-artifact metadata was retained without downloading it.

## Signed Mac evidence is separate

The root-owned [signed Mac native report](https://github.com/oliverbross/OM0RX-xLog/blob/main/docs/audits/quality-2026-11-05/native-1.5.22.md) and [sanitized receipt](https://github.com/oliverbross/OM0RX-xLog/blob/main/docs/audits/quality-2026-11-05/native-1.5.22.json) identify the same S22, signed arm64 ZIP `01dc4cbc5544efa251c3b83f7732ab897c8164da82b85c749767dbf8d8db8fb4`, host `da3d4834421e854454f4d414773cf94b19a52394278ea49d9849406d63d22c7a`, worker `80b4b6da225d4c2a2e1f82d513ed35e02905a9acec1865eab3c03e5579157390` and manifest `12636d537a3fbd06bafa6d6859eec62755f072687fb0e5d1f1c2fc931b3af9b9`.

Its strict signatures, nine signed-worker tests, tiny two-contact native import/export/POTA controls, export bytes, same-root restart and stored-QSO hash passed within that bounded scope. Ordinary Quit was observed twice and process absence checked; actual app-owned worker EOF remains UNOBSERVED. This report does not merge debug-worker expiry/heap or native CPU observations into signed acceptance, and does not close Linux runtime, ordinary Windows, equipment, notarization, daily installation or public release qualification.
