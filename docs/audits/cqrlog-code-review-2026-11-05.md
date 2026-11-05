# CQRLOG C01–C06 follow-up code review

The [focused release close-out](#release-candidate-close-out-follow-ups--5-november-2026)
adds terminal recording cancellation, cold-read diagnostics and the new signed
[1.5.14 candidate](../releases/v1.5.14-cqrlog-candidate.md). Earlier review and
release-boundary statements below describe their original checkpoint.

Review baseline: clean canonical main `68d7b02846c94d904cdf3c9452f4c931e7167b48`,
fast-forward fetched/pulled before work. Scope is the complete C01–C06 source
delta from `db4a9ce2739fc8b96371cd432d3b8787e950a45e`, its callers and shared
country/output/storage boundaries. Source review is complete. The entries below
record confirmed defects, completed fixes and bounded validation, not blanket
acceptance of all legacy code or physical devices.

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

## Voice edits during settings Save

Voice fields remain editable during Save. Its acknowledgement previously cleared
the dirty flag unconditionally, letting the following snapshot replace newer
unsaved edits. A deferred-acknowledgement regression reproduced the lost label
(`/tmp/xlog-cqrlog-review-voice-save-before.log`). Save now captures the edit
sequence and clears only that sequence. Newer edits retain their dirty state and
audio remains disabled. Their base advances only from the original Save's
verified same-workspace revision; an intervening external revision still conflicts.
All 11 VoiceDesk tests pass, including a second-save conflict retaining the newer
text (`/tmp/xlog-cqrlog-review-voice-save-after.log`).

## Coverage and source lineage

Reviewed the C01–C06 application delta, owning types, integration callers and
tests across Swift, Rust, TypeScript and Python:

* Country rule parsing, dates, qualifiers, whole-pack validation, fallback and
  shared facts consumers; reference publication/download/304/rollback; cluster
  reclassification, alert baselines, map uncertainty and activation revocation.
* Country scan cancellation/workspace retirement, field selection and SQL
  correction/undo transactions, provenance, durable receipts, read projections,
  backup/restore, native surface authority and bounded payload admission.
* TCI command capability/permission, one-TRX CW restrictions, retained original
  PTT/CW release targets and permission-disable coordination; finite WinKeyer
  preferences, typed speed/prosign plans, composition and existing shortcuts.
* Normal/contest native voice admission, immutable PCM preparation, WAV parsing,
  route/profile validation, callback/error/drain boundaries, recording/import
  publication, Stop/Finish ownership, target binding and renderer request lifetime.
* Settings/Logbook/CW/voice integration, detached surfaces and new layout rules;
  public payload guards and pinned country normalization. Existing generated
  visual/100k evidence was inspected for scope, not repeated against an old bundle
  and presented as acceptance of these new source changes.

All confirmed findings from this review are fixed. This does not certify that
the entire pre-existing repository is defect-free. Changes were kept in eleven
logical commits, each tested and immediately pushed:

| Commit | Change |
| --- | --- |
| `5101a2bd` | Country exact-search precedence |
| `5e1637df` | Correction UI epochs and unused review cancellation |
| `4977a210` | Immutable country lookup indexes |
| `fad00172` | Voice intent and reviewed-settings admission |
| `3f8f77bd` | Recording Finish and final publication |
| `d196e8e8` | Contest voice preflight/Stop/target equality |
| `d08be273` | Atomic contest voice batch publication |
| `de8775d7` | Voice snapshot backpressure/retirement |
| `078a80c7` | Pinned Git object normalization |
| `982b289a` | Reference UI transport retirement |
| `9db3d3c0` | Voice Save edit-sequence ownership |

The remote all-platform dispatch uses `982b289a34a0b639570afd7b63bb4b01bb3e2a72`;
the final Save UI fix above follows that dispatch. Final application source is
`9db3d3c089b1b0e5c046fee06f53d4fe108bb779`.
Full Rust/normal Swift/portable Swift gates ran with inputs through `de8775d7`;
their application inputs are unchanged by the final two Python/UI fixes.
Python's final tool/test inputs match `078a80c7`; final frontend/build inputs
include the Save UI fix. Tests run immediately before a fix commit use those
same committed bytes, rather than implying that every command began at that HEAD.

## Full local validation

| Gate | Result |
| --- | --- |
| Native Rust | 1,112 passed, zero failures |
| Python 3.12 | 620 passed |
| Normal Swift | All suites passed: XCTest executables report 26 / 83 / 227; Swift Testing reports 392 / 8, retaining conditional skips |
| Portable Swift | All suites passed: XCTest executables report 24 / 664 / 83 / 227 / 79 / 217 / 66; Swift Testing reports 619 / 8, retaining conditional skips |
| Final frontend | 5,209 passed in 378 files, plus Node 6; final correction/reference filter 19 and VoiceDesk filter 11 also pass |
| Production frontend build | Passed TypeScript, Vite and existing payload/chunk budgets |
| Pinned data reproduction | Byte-identical pack; 21,335-facts optimization oracle agrees |

Swift counts are the test runner's reported totals, include existing conditional
skips, and overlap between profiles; they are not summed as unique passing tests.
Commands use Python `/opt/homebrew/bin/python3.12`, Swift `--jobs 2 --no-parallel`,
portable `XLOG_PORTABLE_ONLY=1 --scratch-path .build/cqrlog-portable-final`,
`cargo test --locked --bin xlog-prototype`, `npm test`, and `npm run build`.
Full logs have the prefix `/tmp/xlog-cqrlog-review-full-`, with the final frontend
repeat at `/tmp/xlog-cqrlog-review-frozen-frontend.log` and final build at
`/tmp/xlog-cqrlog-review-final-build.log`. The normalizer/reproduction and before/after
regressions are named in the findings above. No timeouts, safety admission,
payload budgets or substantive existing tests were relaxed to get a pass.

The final frozen frontend repeat and final build both exit zero. An intermediate
repeat discovered the new Save regression before its fix; it is preserved as
`/tmp/xlog-cqrlog-review-mixed-frontend.log`, not counted as a passing gate.
The [machine gate receipt](cqrlog-code-review-2026-11-05-gates.json) records hashes;
40 logs, the baseline oracle, capture helper and receipt are retained locally in
`.build/cqrlog-code-review-20261105/`. No mixed-source repeat is substituted for
the successful final frozen run.

## Remote validation status

[Regular CI at final application source](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41902985364)
passed. The [all-platform matrix](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41901606176)
and [latest-source macOS matrix](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41902985196)
are still running at the recorded observation. They request validation only,
without application packages. The all-platform run's native inputs are identical
to final source; `git diff --exit-code 982b289a 9db3d3c0 -- Sources Tests
Package.swift prototype/src-tauri python tools .github` exits zero. Only the Save
UI/test and audit changed after dispatch; final local frontend/build gates include
that fix. This is explicit input-equivalence evidence, not a false exact-HEAD claim.

The [contest portability run](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41901614866)
passed Windows and Linux Swift/contest/native jobs and the definition generator.
Both queued macOS jobs were cancelled without a runner. GitHub annotations state
that no hosted runner acquired them after multiple attempts and report macOS
arm64 capacity constraints. A macOS Swift retry was accepted and is running;
GitHub refuses a sibling native-job retry while the workflow is active. Native
macOS remains locally tested, but these remote cancellations are not passes.

The [remote snapshot](cqrlog-code-review-2026-11-05-ci.json) records job identities,
results and limits. Source review, all confirmed repairs and local gates are
complete. Full remote platform qualification is pending; no full green remote
matrix, new signed candidate or physical acceptance is claimed.

## Release boundary

No package was built or installed in this review. Read-only verification still
finds installed version **1.5.9**. The retained **1.5.13** ZIP remains SHA-256
`b21af154b96632159236dda7d4249ff0cc95f377ad9e549f364ac7b2c3867929`, matching its
original release record. It predates these review fixes, including private
voice IPC changes; its prior private acceptance cannot qualify the new source.
A new packaged candidate must use a new version and exact provenance.

No native GUI binding, microphone/speaker/serial/radio output, PTT acquisition,
production data/settings mutation, notarization or installation was performed.
Fake stream/IPC/state tests qualify software behavior only. Physical device,
connected-operation and new signed-package acceptance remain separate work.

## Release-candidate close-out follow-ups — 5 November 2026

Refreshed clean canonical main remains `d39c2ec0`; application baseline is
`9db3d3c0`. The retained 1.5.13 artifact and installed 1.5.9 are preserved.

### C06: explicit recording cancellation is terminal

The prior same-job Finish admission still allowed Stop's `cancel=true,
save_recording=false` to become `save_recording=true` before the worker retired.
A deterministic native regression actually replaced a disposable existing WAV
after Stop → same-ID Finish, reproducing the issue
(`/tmp/xlog-rc14-voice-before.log`). Identity checks alone were insufficient.

Cancelled jobs now reject Finish, and cancellation cannot be reversed by another
save request. Final job-ID/workspace/profile validation and atomic WAV publication
share the same native state lock as Stop/Finish. Thus a Stop admitted before
publication retains the old file; publication already committed before Stop is
not retrospectively undone. Existing output-intent revocation, queue-generation,
PTT/release paths and normal recording Finish remain intact.

The real native admission/publication helpers are exercised with synthetic PCM
and disposable files: Stop → delayed same-ID Finish; Finish → Stop and repeated
Finish; stale ID after Stop; and ordinary Finish successfully writing a slot.
Correction source is `1d6c329ebf0515e829427bbc97ade0a80230a3cb`.
All 15 native voice tests and the full 1,116-test native Rust gate pass
(`/tmp/xlog-rc14-voice-after.log`, `/tmp/xlog-rc14-full-rust.log`). No audio hardware
or production WAV was used. This is source/native-test evidence, not packaged
microphone or RF acceptance.

### Windows DXpedition responsiveness follow-up

The refreshed all-platform run `41901606176` passed macOS/Linux, failed Windows
at `DXpeditionConcurrencyTests.swift:38`, and skipped both optional packaged
runtime jobs. The failure is retained, not relabeled. Windows logs are saved at
`/tmp/xlog-rc14-windows-original.log`. The two-second responsiveness criterion
remains unchanged. Focused phase instrumentation and cold-reference investigation
were added for the repeated Windows gate; actual outcomes follow below.

Focused baseline locally passes (1.123 s overall). Phase instrumentation then
measures workspace/worker setup at 50.6/61.3 ms, feed held at 66.5 ms, read task
start 67.0 ms, aggregate evaluation finish 69.7 ms and reply 1,050.3 ms
(`/tmp/xlog-rc14-dx-instrumented.log`). The held feed remains pending when the
read returns. The demonstrated delay is after aggregate evaluation, not waiting
for the feed or fixture-start signal. `statisticsJSON` cold-loads the country
resolver in that phase. Its constructor validated/compiled every rule and then
compiled all rules again, parsing date windows a third time.

In `e084d54f75b9b42b7cf0e50955257503b1871c8b`, the validator now returns its
fully checked compiled rules to the constructor.
Every manifest/component/country/pattern/date/identity check remains; no partial
pack is admitted. No renderer, timeout, warmup, test skip or responsiveness
assertion changes. The same cold focused run now measures evaluation finish
18.7 ms and reply 513.2 ms (496.3 ms from task start, about half the original
983.4 ms); the response still completes while the feed is held
(`/tmp/xlog-rc14-country-dx-after.log`). All 13 integrated country/DX methods
pass. All 21,335 complete-facts oracle entries still agree and seven core/oracle
methods pass (`/tmp/xlog-rc14-country-oracle.log`). Windows's original log has no
phase stamps, so it does not alone separate cold materialization from runner
scheduling. The repeated Windows gate then failed the same expectation: read
task start 313.871 ms, evaluation finish 330.372 ms, waiter timeout 2,314.316 ms,
reply 2,475.523 ms. The task-to-reply interval is 2,161.652 ms; 2,145.151 ms is
after evaluation. Worker setup/feed synchronization occurred before that budget;
task scheduling and evaluation begin promptly. This demonstrates excessive cold
reply-shaping cost, not serialization behind the held feed. The original
compilation-reuse change alone is insufficient on Windows. Its complete logs
are retained in `.build/releases/1.5.14/evidence/ci-windows-126880466368.log`.
The 1.5.14 bytes remain a bounded macOS checkpoint with a failed required gate;
a further construction correction and a newly versioned candidate are required.

Further correction `7d969f36dd4c6d72740d546d1a208f971f9f49a2` keeps exact/prefix
literal rules as validated strings instead of compiling 13,052 unnecessary
regular expressions, and caches strictly validated UTC dates within one pack
decode (15,699 date fields, 2,386 distinct values). Wildcard expressions,
date-window checks, ranking, identities and whole-pack admission are unchanged.
An independent synthetic-rule test covers literal exact/prefix boundaries,
wildcards/classes, unsupported syntax, oversized patterns, invalid calendar dates
and inverted windows. Its first fixture retained an unrelated real ambiguity
prefix; the fixture now owns its ambiguity set. The corrected test and full normal
Swift gate pass (393 reported Swift Testing methods/53 suites plus 8/2). All
21,335 original full-Facts oracle entries still match. The local focused read is
331.452 ms; no timeout, startup warmup or skip was added. Focused Windows
`41928552588` and complete native-core platform gate `41928560129` are dispatched
at the exact correction source. Their actual outcomes will qualify a separately
versioned successor; they do not relabel 1.5.14's failed gate.

Contest run `41901614866` retained six passing jobs and one native macOS
runner-acquisition cancellation. Only that missing job was requeued; all seven
jobs now pass at original source `982b289a`. Earlier cancellations and successful
jobs retain their separate states. The release-source contest run `41918608531`
also passed all seven jobs after retrying only its macOS Swift runner-acquisition
cancellation. Regular release-source CI `41918608659` initially ended with a
cancelled job/no runner and workflow-level failure; its single-job retry passed.
Neither infrastructure cancellation is represented as a test failure or an
original-attempt pass.

### Signed successor and acceptance boundary

The [1.5.14 candidate](../releases/v1.5.14-cqrlog-candidate.md) is built from clean
canonical source `5d92260f2db8f18ec90421c39d98a00d222d9283`. It includes both
corrections and clarified capability documentation. Its ZIP is SHA-256
`a2375545ce836fe6934feed9c1eb7c1d38ce56bd0c8910be98af5acd78407767`.
Arm64 host/worker Developer ID signing, strict ZIP-roundtrip verification,
3,546-file privacy audit (zero findings) and unchanged first-signed-worker gate
(9/9, no skips, five-second deadline) pass. Full normal and portable Swift gates
were repeated and passed, retaining existing conditional skips. Exact native/
test/workflow input comparison supports validation-source `e084d54f` reuse at
candidate `5d92260f`; frontend/Python inputs match `9db3d3c0`. No earlier package's
acceptance is relabeled for these new bytes.

Actual native private acceptance used fresh marked storage and two process-verified
launches of the signed ZIP-extracted bundle. CQ-only selected apply, ordinary
Quit/restart, saved receipt rediscovery, revision-checked Recover and Already
recovered passed. Post-Quit signed-worker reads verified 12 contacts, unchanged
other 11 contacts/protected context, retained extra fields, settings/preferences
and WAV. Saved unarmed CW settings/literal preview and reachable voice/library
controls were observed. Offline voice/CW guards remained intact; recording
admission/publication regressions are native component tests with disposable WAVs,
not physical microphone or station acceptance. Both Quits were verified only
through process inspection, without a post-Quit GUI binding.

The [machine receipt](cqrlog-implementation-2026-11-04/candidate-1.5.14-gates.json)
pins sources, input manifests, current CI states, package/native/protection
receipts and retained raw log checksums. Installed 1.5.9 and its rollback ZIP,
old signed 1.5.13 bytes/receipts and the CW-skimmer worktree are unchanged.
Physical TCI/keyer/audio/PTT qualification, Windows/Linux packaged-runtime
acceptance, notarization and controlled OS-cache-cold measurement remain pending.
Later SunSDR qualification must observe the real advertised TRX count before
claiming native TCI CW availability; selecting one receiver is not that evidence.

### Definitive Windows phases and current closure gates

The finer `1f77871b` Windows diagnostic (`41931381091`, job `126928853546`)
rules out the earlier scheduling/lock uncertainty: GCD and task probes run
immediately after evaluation, locks enter in about 0.007 ms, and aggregate
publication takes about 12 ms. Resolver construction then takes 1,919 ms and
canonical entity metadata another 499 ms. This is cold application reference
work while the catalogue response is held, not serialization behind that feed.

`aa6fa467` removes repeated annotation-regex construction, repeated token cleanup,
unneeded per-character escaping and an unused display sort when building the
ADIF-name dictionary. Every applicable label is compared with the full legacy
catalogue; all 21,335 retained complete Facts still match. `8fb0d12a` uses fixed
unlocalized resource paths, safe mapped reads of immutable bundle data and exact
ASCII digest formatting. Its Windows breakdown isolates another 361 ms in
SHA-256 itself (hex formatting is only 0.082 ms); the real read is 2,091.839 ms,
still failing the unchanged two-second limit.

`4a5c6dd21ab4798ec407f3b99cb1f02b00091d72` adds a Windows-only CNG SHA-256
adapter with complete per-call cleanup, exact 32-byte output, invalid-buffer
rejection and unchanged Swift Crypto fallback. Tests compare empty, small and
multi-block inputs against the existing implementation. No reference bytes,
identity format, validation, deadline, warmup or skip changed. The implementation
uses Microsoft's [native hash API contract](https://learn.microsoft.com/en-us/windows/win32/api/bcrypt/nf-bcrypt-bcryptcreatehash),
without keys, credential access or persistent state.

The broader `7d969f36` Windows gate did pass DX (1,669 ms), but failed an
independent operator-action fixture. Deterministic reproduction with a historical
automatic timestamp proves the affected field is start UTC: first callsign
capture correctly refreshes automatic time. The old fixture incorrectly expected
manual-time retention and flaked when the action crossed a whole-second boundary.
`ea6e8884` now seeds explicit manual start/end, asserts manual provenance, keeps
all field/replay/revision/later-typing checks, and separately tests bounded
automatic capture/replay. No product clock behavior changed. The before patch/log
and three passing corrected tests are retained under `/tmp/xlog-rc15-operator-*`.

Current local code passes full normal Swift (394 reported methods/53 suites plus
8/2), complete portable Swift (620/85 plus 8/2, existing conditional skips), all
21,335 full-Facts comparisons and the 12-test portable pin guard. Earlier
331/340 ms read observations had warmer process-level metadata; fresh-process
focused samples are separately labelled. OS caches and concurrent load are not
controlled, so these are not a clean pairwise/cold-disk benchmark.

Regular CI `41939913053` passed at `4a5c6dd2`. Focused Windows `41939914399`,
full native-core `41940075023` and contest `41939912873` are pending/in progress
at this checkpoint. Older superseded gates retain actual pass/failure/cancel/skip
states and pre-supersession snapshots. No 1.5.15 package is built until applicable
required gates finish. The [1.5.15 record](../releases/v1.5.15-cqrlog-candidate.md)
will pin the new source/artifact/native receipts; 1.5.14 remains a retained failed
qualification checkpoint, and installed production remains 1.5.9.

### Final statistics identity path and independent CW fixture correction

Focused Windows `41939914399` at `4a5c6dd2` passed both native SHA-256 tests
and all three operator-action tests, but the real read still took 2,218.741 ms.
The native hash took 4.005 ms; JSON decode took 1,098 ms, and unrelated entity
display metadata took another 331 ms. `0c454411` makes statistics request the
same entity ADIF set directly, avoiding display-name normalization, legacy
catalogue construction and sorting. The full entity API is unchanged. Parity
assertions cover bundled packed/legacy, custom and combined fallback references.
The real focused local read passed in 366.112 ms with uncontrolled OS caches.
No deadline, warmup, source bytes, reference identity or validation was changed.

The full `4a5c6dd2` macOS job `126958582075` exposed a separate CW fixture
race: after advancing the fake clock beyond the stale-IQ threshold, it reused
a track that the monitor could legitimately retire. The failure came from the
initial stale-reference guard in `mute`, after a successful stale-IQ rejection.
`c0bcf897` gives mute and stale-IQ rejection independent fresh tracks. All 34
CWDecodeSession tests pass locally; production freshness/monitor checks are
unchanged. The old full run retains Linux pass, macOS failure and superseded
Windows cancellation as separate outcomes.

Current functional/test source is `c0bcf897be59d5d265fd7e03690ce911dee943b0`.
Focused Windows `41942409273` tests identical application code at `0c454411`;
complete three-platform native-core `41942524586` tests `c0bcf897`. The preceding
contest run `41939912873` completed all seven jobs successfully. Final candidate
qualification will record actual results rather than promoting a pending gate.

Focused Windows `41942409273`/`126966228362` has now passed all six tests.
The real read measured **1,688.338 ms**, with the catalogue response still held
and the original two-second deadline. Entity ID collection took about 6 ms.
The final full local normal and configured portable gates pass, as does the
21,335-entry complete-Facts oracle (10,000 warm checksum `2322232`). The first
local portable invocation omitted required `XLOG_CONTEST_PYTHON`; its one
precondition failure is retained separately from the configured passing rerun.
Regular CI `41942506389` passes at `c0bcf897`; complete native-core and the
remaining Windows contest Swift job still run at this release preparation point.
