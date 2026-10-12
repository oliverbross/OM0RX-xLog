# Windows credential-store stage — 13 October 2026

This source stage adds a Windows Credential Manager adapter and connects it to
the integrated cluster password path. It is not proof of Linux vault support,
authenticated QRZ/Wavelog parity, or an installed release.

## Storage contract

- Exact service/account access only, using generic credentials. No enumeration,
  migration, domain-password type, plaintext file, configuration embedding or
  remote credential service is used.
- Target names include the application namespace and hexadecimal UTF-8 service
  and account bytes. This preserves case and separator/Unicode boundaries even
  though Windows credential target names are case-insensitive.
- Values are UTF-8 blobs with the SDK's credential-size limit checked before a
  mutation. Empty Save means remove; removing a missing exact identity succeeds.
  Replacement updates the same identity. Persistence is local to the current
  user on this computer, not enterprise roaming.
- Missing credentials and unavailable vaults remain distinct. Access failures
  never report a successful save/removal or fall back to plaintext. The UI receives
  fixed errors, not native descriptions or secret material. Returned C buffers
  are wiped before being freed; this does not promise that Swift strings have no
  temporary copies in memory.
- The existing Mac Keychain implementation is unchanged. Linux remains explicitly
  unsupported by this adapter until a cancellable Secret Service implementation
  and native acceptance are complete. Public/callsign-only features stay separate.

## Verification and safety boundary

Local Mac validation covers invalid/oversized identities and values before vault
access, plus unsupported-backend failure behavior. The Windows native test is
explicitly skipped on Mac, not counted as native evidence. Clang C11 warning-clean
syntax checks cover the non-Windows adapter branch only.

The final full Mac run completed 154 XCTest cases with one Windows-only skip and
zero failures, plus 68 Swift Testing cases and all five worker-process tests.
An earlier run exposed the CAT fixture's bind/close/rebind port race. The fixture
now asks the OS to allocate and retain an ephemeral loopback listener, then reads
its bound port; production zero-port validation remains unchanged. Six focused
CAT tests and three additional consecutive six-test runs passed after the fix.

Windows CI explicitly opts into a native fixture under a random
`com.oliverbross.xlog.ci.<UUID>` service. It checks missing reads, Unicode/NUL value
round trips, case and separator identity isolation, a second service namespace,
the exact size boundary, replacement, deletion and idempotent cleanup. It removes
only those exact test identities; it never enumerates or uses the production
cluster service. Native Windows results remain pending until the exact-source
run finishes. Reopening a wrapper is not an OS logout/restart acceptance claim.

No operator credential was read, written, migrated or deleted during local work.
Installed alpha.9, its logbook and station configuration remain unchanged.

## API basis

The implementation follows Microsoft's [credential structure and persistence
contract](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw),
[CredRead](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credreadw),
[CredWrite](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credwritew)
and [CredDelete](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-creddeletew).
Linux is not implemented by wrapping an indefinitely blocking call: libsecret's
[synchronous store documentation](https://gnome.pages.gitlab.gnome.org/libsecret/func.password_storev_sync.html)
explicitly warns about that behavior. Its cancellation, locked-vault and desktop
session contracts require their own implementation and tests.
