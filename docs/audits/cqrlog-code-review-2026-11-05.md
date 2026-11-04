# CQRLOG C01–C06 follow-up code review

Review baseline: clean canonical main `68d7b02846c94d904cdf3c9452f4c931e7167b48`,
fast-forward fetched/pulled before work. Scope is the complete C01–C06 source
delta from `db4a9ce2739fc8b96371cd432d3b8787e950a45e`, its callers and shared
country/output/storage boundaries. Review is in progress; the entries below
record confirmed defects and completed fixes, not blanket acceptance.

## Country exact-search precedence

The normalized resolver's exact-only search returned an ambiguous-prefix
decision even when no exact exception matched. That prematurely bypassed both
the more specific area rules and the later maritime/aeronautical qualifier
handling. The real pinned pack reproduced unresolved `FT4XZZZ` and `R1ANZZZ`
despite finer rules for ADIF 131/13, and incorrectly returned ambiguous for
`VK2ZZZ/MM` and `3Y0ZZZ/AM`. These are synthetic test calls, not live-location
claims. A genuinely ambiguous `3Y0ZZZ` must still remain ambiguous.

An absent exact match now returns no decision. The existing normal rule and
qualifier precedence then runs unchanged; dated exact matches still win. The
pack bytes, retained QSOs and reference identities are unchanged.

Validation: the new regression initially recorded six failures for the four
affected examples (`/tmp/xlog-cqrlog-review-country-before.log`). After the fix,
all six `CountryFactsTests` methods pass
(`/tmp/xlog-cqrlog-review-country-after.log`). The portable country integration
filter also exits zero, including the twelve prototype methods covering shared
consumers, explicit correction/undo, durable receipt discovery, migrations,
backup/restore, download/304, cancellation and XML rollback
(`/tmp/xlog-cqrlog-review-country-integration.log`). Commands used explicit
Python 3.12, `--jobs 2 --no-parallel`; the portable gate retained its existing
`.build/cqrlog-portable-final` scratch path. No native app, physical output,
production data or installed bundle was exercised or changed.

## Correction UI response and native review lifetime

Five deterministic regressions reproduced late workspace handshakes starting
retired scans, old preview/apply `finally` blocks unlocking a newer scan, and
old Cancel/Already-applied responses replacing a new review or exposing old
receipts. All async UI outcomes now belong to their captured sequence, including
scan cancellation acknowledgements. A retired handshake starts no native read.

Unapplied review tokens also outlived navigation, rejected previews and late
responses. They consumed the native eight-review allowance until its 15-minute
expiry, while the UI no longer offered a way to close them. Scope retirement
now explicitly cancels those tokens. Completed corrections retain their durable
receipts; cancellation still cannot undo an applied correction.

Validation: five real behavior failures before the fix are retained in
`/tmp/xlog-cqrlog-review-ui-before-corrected.log`. All 18 correction/reference
UI tests now pass, including the eight new retirement/ownership cases and
rejected-reference cleanup; TypeScript exits zero. Logs:
`/tmp/xlog-cqrlog-review-ui-after.log` and
`/tmp/xlog-cqrlog-review-ui-tsc.log`. No timers, sleeps, timeout limits, native
mutation checks or workspace generation guards were weakened.

## Immutable country lookup indexes

Every lookup previously scanned all rules sharing its first letter, including
unrelated exact calls. Literal exact exceptions now use full-call buckets;
other rules use their leading literal prefix. Lookup enumerates all prefixes
of the bounded input and retains wildcard-leading rules. Matching, date windows,
ranking, equal-rank ambiguity, provenance and source identities are unchanged.

The opt-in `CountryLookupIndexTests` writes a baseline oracle before the index
change, with representative calls derived from every real rule plus portable
and historical probes. After deduplication/date expansion it retains **21,335
complete Facts results**, all equal after the optimization. Oracle:
`/tmp/xlog-country-index-oracle-20261105.json`, SHA-256
`bd73cdc3a373a33c1cb17a0527ce69c787ebfa466cf2f45cbc326267e912fac0`.
This verifies preservation, independently of the semantic country regressions.

The same 10,000-lookup warm debug corpus took **12,501.937 ms before** and
**5,391.716 ms after** (about 2.32× faster, 56.9% less elapsed time); checksum
2,322,232 agrees. Logs: `/tmp/xlog-cqrlog-review-country-index-before.log` and
`/tmp/xlog-cqrlog-review-country-index-final.log`. Both use explicit Python 3.12
and `swift test --jobs 2 --no-parallel`; the opt-in oracle environment variables
are recorded in `CountryLookupIndexTests`. Seven core/oracle methods pass;
the later portable country filter also exits zero, including twelve prototype
methods (`/tmp/xlog-cqrlog-review-country-index-integration.log`). This is a
controlled source-level lookup comparison, not a new signed-package, 100k UI,
disk-cold or RF latency measurement. The expensive oracle is disabled in ordinary
test runs unless explicitly requested by environment.

## Native voice intent and reviewed settings admission

Normal voice preparation checked its intent journal only before decoding PCM.
Two concurrent requests could both observe a missing intent, then publish two
different sendable action IDs. Preparation also lacked a second scope check
when publishing decoded audio. Publication now rechecks the captured native
scope and intent under the same state lock; duplicate requests return the one
original action and cannot mint another token. Existing Stop-generation,
capacity, expiry, consumed-action and immutable PCM guards remain intact.

Normal Prepare, monitor Preview, Record-start and Import also accepted only a
slot, using whatever settings happened to be current natively. A desk displaying
another revision/workspace could consequently select a different route or WAV
library from the one the operator saw. These requests now require the displayed
settings revision and workspace generation before audio preparation or library
access. The renderer captures that scope before asynchronous file decoding.
Save already had its own revision/generation guard. Stop/record-finish retain
their independent cancellation paths and require no settings revision.

Validation: nine native voice tests pass, including a barrier-controlled
concurrent duplicate, retired-scope publication, stale reviewed settings and
all four strict request schemas. Seven VoiceDesk tests pass, including exact
binding for send, preview, recording and import; TypeScript exits zero. Logs:
`/tmp/xlog-cqrlog-review-voice-prepare.log`,
`/tmp/xlog-cqrlog-review-voice-ui-prepare.log`,
`/tmp/xlog-cqrlog-review-voice-ui-tsc.log`. Tests use pure fake state; no microphone,
speaker, radio or PTT was operated. The installed app and retained signed 1.5.13
bundle have not been changed; these are source fixes for the next candidate.

## Recording finish and final publication

Record-finish previously used the global voice cancellation path without a job
identity. A delayed Finish could cancel or prematurely finish a different newer
job. It now carries the recording action ID shown by the native snapshot and
only finishes that recording. Global Stop remains independent and available.

Recording publication previously compared only the voice profile after capture;
an identical profile in a replacement worker/workspace could pass. Stop could
also arrive during the last settings read after its earlier cancellation check.
The final write admission now checks the original worker/workspace/profile and
the current cancel/save flags. Explicit Finish is still permitted, while global
Stop cancellation retains the original WAV.

The capture loop also checked its error flag only while running. Failure or
overflow arriving at its deadline/Finish/stream-teardown boundary could therefore
publish partial audio. The final drained capture now checks that flag after the
stream is dropped, before producing a WAV for publication.

Validation: the complete voice filter passes **37 native tests**, including the
new late-Finish, post-settings cancellation/workspace and teardown-failure cases;
**8 VoiceDesk tests** and TypeScript pass. Logs:
`/tmp/xlog-cqrlog-review-voice-finalization.log`,
`/tmp/xlog-cqrlog-review-voice-ui-finalization.log`,
`/tmp/xlog-cqrlog-review-voice-ui-tsc.log`. Fake state/stream teardown and PCM
round-trip tests qualify these software boundaries; physical recording/audio
device failure remains unrun.

## Contest voice preflight, Stop and target identity

Capability/target discovery had been moved ahead of the renderer's cancellation
owner. Stop during that await could miss the operation, and two Plays could
both enter. The operation is now reserved before any await, with cancellation
checked after both asynchronous preflight steps. Supplied target evidence is
cloned before those awaits, preserving the original QTC/provider binding.

An independent native Stop error also bypassed the legacy playback/PTT release
path. Release is now attempted even when that Stop fails; the error is still
reported. Finally, target comparison used JSON property order rather than field
identity, rejecting equivalent Agent/TCI objects after serialization. The
comparison now checks all scalar route/observation fields and nested TRX/channel
values; changed targets still fail before PTT.

Five regressions failed before these fixes
(`/tmp/xlog-cqrlog-review-contest-voice-before.log`). All **17 contest voice
renderer tests** now pass, including a further delayed-preflight target-freeze
case; TypeScript passes. Logs:
`/tmp/xlog-cqrlog-review-contest-voice-after.log` and
`/tmp/xlog-cqrlog-review-contest-voice-tsc.log`. Tests mock native IPC/audio/PTT;
they do not claim connected playback or physical release acceptance.

## Atomic contest voice preparation publication

A concurrent collision on a later batch member left earlier members published
even though the request failed. Exceeding the 256-entry cap also cleared all
other valid preparations. Both regressions reproduced against the old code:
one new row survived a two-row collision, and a capacity failure erased 255
existing preparations (`/tmp/xlog-cqrlog-review-voice-batch-before.log`).

Publication now checks the complete incoming key set, replay state and journal
capacity before inserting any member. Failure preserves the prior journal;
Stop remains the explicit way to retire preparations. The full voice filter
passes **39 native tests** (`/tmp/xlog-cqrlog-review-voice-batch-after.log`).

## Voice snapshot backpressure and retirement

The 250 ms voice poll started another native snapshot even when the previous
settings/device read was still pending. A delayed old transport response could
also overwrite a replacement desk. Two deterministic tests reproduced six
requests in 1.25 seconds and replacement settings overwritten by an old result
(`/tmp/xlog-cqrlog-review-voice-poll-before.log`).

One promise per active transport now coalesces snapshot reads; late success and
error results from retired transports are ignored, and an old completion cannot
clear a newer flight. The same slow-backend test now observes two calls (initial
load plus one in flight), with the 250 ms interval unchanged. All **10 VoiceDesk
tests** and TypeScript pass (`/tmp/xlog-cqrlog-review-voice-poll-after.log`,
`/tmp/xlog-cqrlog-review-voice-ui-tsc.log`). No output is started by polling.

## Pinned country generator provenance

The generator checked HEAD but read editable working files, allowing an
uncommitted source change to be labeled as the pinned upstream revision.
Its assertions also disappeared under optimized Python, including the revision
check. Two regressions reproduced both failures
(`/tmp/xlog-cqrlog-review-normalizer-before.log`).

The six components now come directly from the pinned Git objects with replacement
objects disabled. Explicit validation survives `python -O`, and canonical UTF-8
LF output is independent of platform text translation. Both regressions pass
(`/tmp/xlog-cqrlog-review-normalizer-after.log`). Regeneration from the retained
upstream checkout is byte-identical to the bundled resource: SHA-256
`c04689ac8cf530672a98df3d1ecd132a150d13e7583f88037928b75a09ff1731`
(`/tmp/xlog-cqrlog-review-normalizer-reproduction.log`). No pack bytes changed.

## Reference control transport retirement

A pending country snapshot read kept controls disabled after transport
replacement, and its late response could display the retired provider or unlock
a newer operation. The regression fails before the fix
(`/tmp/xlog-cqrlog-review-reference-scope-before.log`). Request replacement now
retires the old epoch, clears its status/busy state, and guards finalization.
Operator-entered file/URL drafts remain intact. All 19 correction/reference UI
tests pass (`/tmp/xlog-cqrlog-review-reference-scope-after.log`). Native reference
publication still owns admission and validation; UI retirement does not cancel
an already admitted import or download.
