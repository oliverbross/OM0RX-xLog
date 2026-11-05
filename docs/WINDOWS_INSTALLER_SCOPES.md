# Windows installer scopes and acceptance

The canonical recipe `prototype/scripts/package-windows-installer.ps1` creates two NSIS wrappers around one already audited x86_64 portable directory. It does not rebuild or patch the application for either scope. Candidate version/source rules still apply before invoking the recipe; this source change alone does not produce a new qualified package.

| Download suffix | NSIS mode | Fresh-install default | Registration / Start Menu | Installer privilege |
|---|---|---|---|---|
| `-windows-x86_64-current-user-setup.exe` | `currentUser` | `%LOCALAPPDATA%\OM0RX-xLog` | HKCU / current user's Programs | Ordinary user; no administrator request |
| `-windows-x86_64-all-users-setup.exe` | `perMachine` | `%ProgramFiles%\OM0RX-xLog` (64-bit) | HKLM / common Programs | Administrator approval required |

Choose the current-user download for **Just me**, or the all-users download for **All users**. There is no scope chooser inside one EXE. Tauri's `both` mode requests elevation even for Just me, so it cannot supply the required no-admin route. The [Tauri configuration reference](https://v2.tauri.app/reference/config/#nsisinstallermode) describes those modes; the [bundler template matching the currently pinned CLI 2.12.2](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.2/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi) supplies privilege, known-folder and shortcut handling. Recheck the template when the CLI lock changes.

Both downloads embed the Microsoft Evergreen WebView2 bootstrapper. It needs network access when the runtime is absent; the current-user route must also be exercised with WebView2 absent under a standard account. Managed Windows policy can restrict prerequisite installation. The app and bundled Swift, SQLite and Hamlib runtimes require no developer toolchain.

Each EXE has a checksum and schema-2 provenance receipt containing its source commit, version, explicit scope, privilege, expected default directory and registration hive, bundler version, configuration hash, main-executable hash and payload-manifest hash. Both scopes must have identical main-executable and manifest hashes. Configuration files and the payload privacy report accompany the installers. Checksum/provenance files do not supply publisher authenticity; these remain unsigned internal candidates unless a separate signing/release gate says otherwise.

## Scope changes and retained data

Same-scope upgrades retain the existing installer-selected location through Tauri's normal registration. Fresh-install path tests use a disposable account/VM without either registration, old installer-location keys or existing installation files. A restored old location is upgrade behavior, not proof of a fresh default.

For this configuration, the pinned bundler derives manufacturer `oliverbross` from the second identifier component. The saved location is the default value at `HKCU\Software\oliverbross\OM0RX-xLog` or `HKLM\Software\oliverbross\OM0RX-xLog`. Tauri retains it after uninstall when app data is retained. Acceptance checks both before launching any installer and rejects a nonempty retained location without deleting it, even if the old directory, uninstall registration and shortcuts have disappeared.

Scope changes use an explicit uninstall/reinstall sequence; automatic cross-scope migration or supported coexistence is not claimed. Close xLog normally and preserve the disposable test workspace, settings and external media inventory. Uninstall the old scope with **Delete app data unchecked**, confirm its EXE/shortcuts/registration are gone, then run the other scope installer. Start the app as the original ordinary user, select the retained workspace and verify settings, synthetic QSOs and external-media hashes after restart. The all-users installer changes shared program files; each operator continues to use their own profile/workspace permissions. Do not copy user data into Program Files or an administrator's profile.

Use the retained known-good same-scope installer and data backup for rollback. Record downgrade prompts and the actual resulting version/path. Never infer successful rollback or external-media preservation from the harness's single profile marker.

## Repeatable native checks

Host-independent policy/parser check:

```powershell
pwsh -NoProfile -File ./prototype/scripts/test-installer-syntax.ps1
```

On a disposable Windows desktop, from a **non-elevated PowerShell 7** shell, pass one exact EXE with its adjacent provenance receipt:

```powershell
./prototype/scripts/accept-windows-installer.ps1 -Installer <exact-current-user-or-all-users-setup.exe> -EvidenceDirectory <new-evidence-directory>
```

The harness uses `/S` with **no `/D` override**. It checks the actual known-folder default, expected uninstall hive/version/path, Start Menu shortcut target, complete audited installed payload and isolated native runtime, then uninstalls and checks owned files, registration and shortcut removal plus retention of its own profile marker. All-users installation/uninstallation requests UAC from the ordinary harness; runtime checks run from that ordinary harness after installation. Failures preserve the receipt and installed state for diagnosis; cleanup never forcibly removes an unknown installation. The harness refuses pre-existing installations/default directories/shortcuts and retained installer-location values. Use a separate fresh VM snapshot for each scope, and retain both evidence directories. CI likewise runs one scope per fresh matrix runner, checking the two downloads' shared payload hashes before accepting its selected scope.

Hosted CI explicitly passes `-AllowElevatedHarness` because its Windows Server account is elevated. Such receipts label ordinary-user runtime and interactive UAC/default-path acceptance **NOT RUN**. CI does not prove a standard-user install or Windows 11 interactive behavior. The existing runtime fixture is also separate from radio/rotator first-run qualification.

## Q03 acceptance ledger

Status at this source change: host-independent policy/parser checks pass; **no new Windows EXE was built or installed**. All native cells below remain **NOT RUN** until exact version, source SHA, EXE SHA-256, Windows build/WebView2 version, user/elevation and observed paths are attached. The repository currently exposes hosted `windows-2022` CI and no registered self-hosted runner; this is not a desktop acceptance result.

| Cell | Required observation | Next evidence step |
|---|---|---|
| Standard user, current-user interactive defaults | No UAC; default resolves to LocalAppData; HKCU/user shortcut; ordinary app/helper launch | Build one integrated candidate; run the exact current-user EXE in a fresh Windows 11 standard account with no `/D` |
| Standard user, current-user without WebView2 | No administrator credential required for supported prerequisite path; useful failure if policy prevents it | Repeat on a snapshot without Evergreen WebView2; retain bootstrapper result and actual runtime origin |
| Standard user, all-users interactive defaults | UAC accepted/cancelled separately; Program Files x64; HKLM/common shortcut; first launch non-elevated | Run exact all-users EXE using separate admin credentials; then ordinary shortcut launch and process-token/helper checks |
| Packaged default-path regression, each scope | Harness receipt passes for exact package and records account elevation | Run the supplied harness for each scope; hosted CI remains a narrower elevated-account result |
| Upgrade previous per-user package | Same scope/path, saved synthetic workspace/settings/voice references retained, one active EXE/worker | Install retained previous package on disposable VM, save fixtures, upgrade interactively without `/D`, restart and compare |
| Change from per-user to all-users | Explicit old-scope uninstall with data retained; new common shortcut; original user profile restored | Follow scope-change procedure above; capture old/new registration, resolved shortcut and actual worker |
| Reinstall and rollback | Known active candidate/previous version, retained fixture contents and usable restart | Reinstall current scope, then supported rollback; hash the fixture/media before and after |
| Uninstall/data retention | Program files/registration/shortcuts removed; workspace and external voice/media unchanged | Test ordinary interactive uninstall with Delete app data unchecked, then compare private fixture inventories |
| Second ordinary user on all-users | Shared EXE available; independently writable user data, no profile leakage | Launch from a second standard account with synthetic identity and verify distinct profile/workspace |

Run the packaged first-run radio/rotator procedure separately. A valid catalogue, saved provider settings and explicit read-only device connection are different outcomes; installer scope evidence cannot close those cells.
