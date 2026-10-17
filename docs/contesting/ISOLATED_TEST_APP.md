# OM0RX-xLog Contesting Test isolation

## Scope and provenance

This P1 test flavor is implemented on `codex/contesting-foundation` from base
`c5059ea5798edc6e3094e3d204fd9270de34916f`. It reuses the current Tauri UI and
Swift worker lifecycle. It does not install, replace, launch, migrate, copy, or
read the production OM0RX-xLog application or its operator data.

The flavor is intentionally opt-in at build time:

```sh
prototype/scripts/package-contesting-test-macos.sh
```

That command produces `OM0RX-xLog Contesting Test.app`. It is a test-build
command only. Installation, launch, signing acceptance, hardware use, and
release remain separate review gates.

## Immutable identity boundary

| Resource | Production | Contesting Test |
|---|---|---|
| Product/display name | `OM0RX-xLog` | `OM0RX-xLog Contesting Test` |
| Bundle identifier | `com.oliverbross.xlog.integration` | `com.oliverbross.xlog.contesting-test` |
| URL scheme | production app contract | `om0rx-xlog-contesting-test` |
| Tauri/WebKit storage identity | production bundle identifier | test bundle identifier |
| Swift support root | existing production paths | `Application Support/OM0RX-xLog Contesting Test` |
| Workspace | existing production/integration workspace | empty test-only integration workspace |
| Defaults/Keychain prefix | `com.oliverbross.OM0RXXLog.Integration.` | `com.oliverbross.OM0RXXLog.ContestingTest.Integration.` |

The native host is compiled with Cargo feature `contesting-test`. It passes the
typed `--runtime-profile=contesting-test` argument to its bundled Swift worker.
The worker accepts that profile only when its containing application has bundle
identifier `com.oliverbross.xlog.contesting-test`. An environment variable or a
renderer request cannot select this profile. Missing, repeated, unknown, or
unbound profile input fails before shared logbook/service owners initialize.

The test support root is standardized and symlinks are resolved before use. A
root that aliases the production application-support or integrated-preview
directory is rejected. Test workspace creation permits only `mode=empty`, calls
`IntegrationWorkspaceBootstrap.createEmpty`, starts with local logbook mode,
and does not inherit native preferences or credentials. `copy_native` is
rejected in this profile.

## External-I/O policy

The test profile does not start automatic sync, online-log delivery, reference
downloads, WSJT-X listeners, station power capture, radio, rotor, CW/PTT,
cluster, opportunity, weather, propagation, remote-backup, or credential
services. The Rust host also skips its saved station/rotor/cluster startup
owners. Explicit renderer requests for those lanes are rejected by the host or
worker with a fixed disabled-policy error. Persisted enabled settings therefore
cannot reactivate those services on a later test-app launch.

Local health, workspace, settings, contest-core, and logbook operations remain
available. Renderer/worker framing stays the existing bounded JSON line
contract: `{id, method, params}` and `{id, ok, result|error}`. Test health
reports `mode=contesting_test`, `platform_services=false`, and no station or
network authority.

## Verification

Focused checks cover:

- default production behavior and rejection of unknown/unbound profiles;
- rejection of a test support root that resolves through a symlink to the
  production root;
- empty-only test workspace creation and exclusive defaults/Keychain identity;
- worker rejection of explicit external-service calls;
- Rust compile-time flavor and method admission behavior;
- shell, plist, JSON, and package metadata validation.

Latest pre-package evidence: `AppRuntimeProfileTests` passed 11/11, the
contesting-feature native admission tests passed 2/2, the production-profile
Rust test passed 1/1, and the full contesting-feature Rust run passed 594 host
tests plus 22 helper tests. The `XLogPrototypeSupport` target and release worker
both build successfully. `git diff --check` passes. Repository-wide
`cargo fmt --check` is not a clean baseline gate because it reports extensive
pre-existing formatting drift in unrelated Rust files; no formatting sweep was
applied as part of this isolation change.

The package script also verifies the built bundle name, bundle identifier, URL
scheme separation, nested signature, and final app signature before reporting
its path. It never installs or launches the bundle.

Current acceptance limit: source and automated boundary tests do not prove a
Finder launch, WebKit directory observation, Keychain prompt behavior, device
silence, RF safety, signing/notarization, or production-data nonaccess under a
running packaged app. Those require the separately reviewed exact-bundle test.
