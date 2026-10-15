# SFTP backup configuration foundation acceptance — 15 October 2026

## Outcome

Source `ab112a301cc0a51e00f76f35800e70567799475c`, tightened by
`f533cde`, adds the first fail-closed SFTP configuration boundary for
BACKUP-01. It validates a
canonical SSH host-key pin, endpoint, username, destination directory,
credential revision and workspace/account identity before any future SFTP
driver may use them.

This is configuration and identity acceptance only. It does **not** add an SSH
or SFTP client, dependency, Settings surface, credential-vault owner, network
operation, upload, download, restore, retention action or scheduler path.
Existing FTP/FTPS code still rejects SFTP.

## Contract

- The pin is the SHA-256 digest of the complete SSH public host-key blob in
  canonical OpenSSH `SHA256:` form: exactly 43 unpadded Base64 characters that
  decode to 32 bytes and re-encode without aliases.
- The deliberately narrow initial algorithm allowlist is `ssh-ed25519` and
  `ecdsa-sha2-nistp256`. RSA, DSA, MD5, trust-on-first-use and generic
  `known_hosts` fallback are not accepted by this foundation.
- Endpoints must use `sftp://`, contain an ASCII hostname and optional port in
  `1...65535`, and contain no user information, password, query, fragment or
  non-root path. Hostname case, the default port 22 and an optional root slash
  canonicalize to one identity. An explicitly empty port is rejected instead
  of being silently normalized to port 22.
- The destination directory reuses xLog's strict absolute remote-path
  validation. It rejects traversal, dot segments, duplicate separators,
  trailing separators, backslashes, controls and overlong paths.
- Account identity binds workspace generation, account handle, credential
  revision, canonical endpoint, username, host-key algorithm and fingerprint.
  Destination identity additionally binds the directory. No changed authority
  field can inherit an older destination identity.
- The password value is bounded, ephemeral and non-Codable, with redacted
  descriptions and empty reflection. The complete configuration is also
  non-Codable. No secret persistence or renderer boundary was added.

## Verification

- Focused native configuration suite: **4/4** tests pass with warnings as
  errors.
- Focused portable-mode configuration suite: **4/4** tests pass with warnings
  as errors.
- Full native suite: **238 tests across 32 suites** pass with warnings as
  errors.
- Full portable-mode gate passes Swift Testing **414 tests across 56 suites**,
  XStation **17**, XLogPrototype **209** with four established skips, and
  XCluster **56**, all with warnings as errors.
- An independent post-commit rerun passed the native **4/4** and portable-mode
  **4/4** focused suites.
- `git diff --check` passes. No external network, credential, trust store,
  operator data, installed app or station I/O was used.

## Remaining gates

- Select and approve an exact-source-pinned SSH/SFTP library and its crypto
  backend, with package and licence provenance for every target.
- Implement a separate native transport that verifies the configured raw
  host-key SHA-256 before authentication, without TOFU, SSH agent, proxy or
  ambient `known_hosts` authority.
- Add exclusive-create upload, bounded independent verification download,
  exact receipt/restore identity, connection/low-speed/total deadlines and
  durable unknown-outcome no-replay behavior.
- Add native vault ownership and an explicit prepare/check/approve/Start
  presentation. Saving configuration or a credential must remain passive.
- Prove success plus wrong-key, wrong-algorithm, wrong-host, lost-
  acknowledgement, partial-write, timeout, oversize and replay-refusal cases
  against a disposable SFTP server before any live-provider or installed claim.
- Windows and Linux implementation/package evidence remains deferred until the
  operator accepts the Mac programme.
