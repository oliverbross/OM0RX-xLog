# Signed macOS 1.5.26 candidate — bounded build evidence

**Candidate HELD; quality OPEN.** Exact source: `8acc236c32fb31d58c86c4d673e0ed57fe76fdad`. The owned build exited
zero with its original child and clean source verified; artifact-only extraction
checked the signed archive and matching arm64 host/worker. See the
[numeric record](signed-mac-1.5.26.json) for source tree, actual parent, chronology
and complete receipt pins.

The signed worker passed **9/9**, with zero failures, cancellations, skips or
todos. The privacy scan checked **3,546 files** with zero
findings. The archive is **129,564,455 bytes**. Developer ID
signatures passed the retained deep/strict checks; notarization is not claimed.

| Artifact | SHA-256 |
|---|---|
| zip | `0fe181c1efcdc0371875a0d23456b0f050454642f34b24a63f9724e692ee444e` |
| host | `434c24e2c1779fb214a4492978274f29fe74cb064ef1283c98660ba20ffee693` |
| worker | `6a22d720a3874cfff96492f20cb44a3a5be2bcf07c3eed831d821e918044ab88` |
| manifest | `6ef32a3ae0ad488557dee373db6c6e9efe4b8eee0b7d420c7b5951bb314e8f99` |
| seal | `88325228426ca3309039ff7bb33922cf3186ddf20a34bd3ae41db675775009ce` |
| extraction | `0db2e18eb98445005a0b68721750ffc6bf9b6cde6dd87f638d6950100a6efd0b` |

An attempted PATH override was rejected before execution, so it was not a build
failure. The actual build inherited the recorded environment: host Python 3.9.6,
v24.11.1, and the recorded Cargo/Swift toolchains.
The receipt runner used absolute Python 3.14; the actual contest runtime manifest
records Python 3.12.4. The earlier proposed PATH is not presented
as the build environment.

This record proves the bounded build, signed-worker, privacy and extraction
results. Desktop ownership, memory/idle CPU, ordinary Quit/data preservation,
source CI and other platforms require their separate records. It does not replace
the daily application, publish a release or establish physical-device acceptance.
