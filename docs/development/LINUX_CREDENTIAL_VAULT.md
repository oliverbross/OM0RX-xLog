# Linux credential vault

The Linux worker stores Wavelog and other integration credentials through
libsecret's Secret Service API, using the exact service/account identity and an
application-specific schema. Values are binary blobs with a 2560-byte limit;
UTF-8 and embedded NUL bytes retain their exact byte lengths. Credential values
are never written to settings JSON or a fallback file by xLog.

Linux builds require the `libsecret-1` pkg-config module (`libsecret-1-dev` on
Debian/Ubuntu; `libsecret-devel` on Fedora). Installed Linux workers require
`libsecret-1.so.0` (`libsecret-1-0` on Debian/Ubuntu) and an available Secret
Service provider on the user's session D-Bus, such as GNOME Keyring or a desktop
wallet that implements that API. Package dependencies supply the native library;
the desktop session owns the keyring and its unlock policy.

Background load/status/contains calls do not request an unlock. A matching
credential in a locked keyring reports `credential_unavailable`; it is not
reported as missing. An explicit user-started operation may opt into a system
authorization dialog. Save and removal are explicit mutations and may also
require the provider's authorization. A missing session bus/provider or refused
authorization never triggers plaintext persistence or a successful mutation
receipt. A headless session needs an explicitly configured Secret Service
provider and an unlocked collection before saving can succeed.

The native acceptance fixture runs without the user's session bus or keyring:

```sh
python3 prototype/scripts/test-linux-vault.py
```

It requires a C compiler, pkg-config, libsecret development headers, `dbus`, and
`gnome-keyring`. It creates a private child HOME and XDG directories, starts a new D-Bus session,
feeds a synthetic keyring password through stdin, and starts its own foreground
keyring process. It verifies exact case/Unicode/service-account identities,
embedded NUL and size boundaries, replacement and idempotent deletion, unavailable
service errors, persistence across a daemon restart, and locked reads completing
without Unlock or Prompt method calls. On failure it retains fixture evidence
and prints its directory; successful synthetic fixtures are removed. Startup
failures distinguish D-Bus ownership from a failed default-collection probe and
include bounded private probe/daemon stderr, without printing the inherited
environment or daemon environment assignments. The readiness probe passes an
explicit service proxy to avoid libsecret 0.21.4's synchronous alias lookup
passing a null proxy into an internal method that requires one.

The runner's isolation and readiness/error diagnostics can also be checked
without a live keyring on any development platform:

```sh
python3 prototype/scripts/test-linux-vault-harness.py
```

After building the portable Swift tests, add `--swift-tests` to run the existing
credential-store round trip tests inside that same isolated unlocked keyring:

```sh
XLOG_PORTABLE_ONLY=1 python3 prototype/scripts/test-linux-vault.py --swift-tests
```

When the existing build uses a custom Swift scratch directory, pass the same
directory to the fixture. Relative paths are resolved from the repository root;
the fixture passes the path through its private D-Bus child to `swift test
--skip-build` without rebuilding the test bundle. CI uses:

```sh
XLOG_PORTABLE_ONLY=1 python3 prototype/scripts/test-linux-vault.py --swift-tests --swift-scratch-path .build/prototype-tests
```

The ordinary Swift suite skips native Linux writes unless both the explicit
native-vault opt-in and the isolated runner's D-Bus/XDG coordinates are present.
macOS retains its existing Keychain implementation; Windows retains Credential
Manager and its existing dedicated fixture opt-in.

API references: [search flags and locked items](https://gnome.pages.gitlab.gnome.org/libsecret/method.Service.search_sync.html),
[binary value lengths](https://gnome.pages.gitlab.gnome.org/libsecret/method.Value.get.html),
[default-collection storage](https://gnome.pages.gitlab.gnome.org/libsecret/method.Service.store_sync.html),
[synchronous alias implementation](https://github.com/GNOME/libsecret/blob/0.21.4/libsecret/secret-collection.c#L2055).
