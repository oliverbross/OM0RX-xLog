# Retained CW track selection

This branch adds retained native evidence and explicit callsign-only loading into
the shared Normal Logging draft and the fenced contest Entry. Separate Tune and
durable receipt recovery use the current owners. Installed recovery acceptance
remains pending; this source work does not qualify CW for release.

A track gets an opaque selection reference only when committed aligned text
identifies one plausible transmitting callsign from two distinct self-ID
occurrences in the last sixty channel seconds.
Provisional text and competing identities do not qualify. Ambiguous/replay tracks
have no reference. The reference pins session, source, stream token, epoch, track,
revision and a generated selection UUID. A different call, qualified frequency,
revision or capture retires the previous reference. Equal evidence keeps its
reference across passive snapshots. Native track UUID case is preserved safely.

`CWDecodeSession.resolveSelection` reads the retained track and existing provider,
then rechecks the actor after the asynchronous provider read. Stop, changed lease,
source, epoch or selection fail closed. Input must be at most 250 ms old and the
selection must have been renewed by a decode within two seconds. Passive
diagnostic resolution may work with unqualified RF; it returns no invented
frequency. Both callsign loading and Tune require qualified mapping and a real
in-passband frequency. The resolver has no side effects.

The frontend projection validates callsign shape and every reference field
against the same track/capture. Renderer-supplied fields cannot become a native
callsign or frequency; action admission resolves the retained native reference
again at its owning draft/control boundary. The native projection withdraws
callsign and control activation tokens when RF becomes unqualified or the track
is muted, including tokens left in a cached projection. Callsign loading requests
fresh RF-qualified readback, then removes frequency from the draft-only command.
Diagnostic calls remain visible without an action grant.

The RF action regression failed before this repair. Afterward, 72 focused native
CW/ownership cases passed; the seven affected selection cases also pass after
checking that a call-less signal never gains a null selection field. These are
source regressions, not installed action acceptance.

Validation: eleven focused session tests passed, including unqualified RF
refusal, invented selection, stale input, changed provider, ambiguity and Stop
during a suspended read. Four projection cases and production TypeScript passed.
The existing automatic-spot production quality refusal remains tested and intact.

Remaining integration: explicit Tune through the durable manual-tune owner with current source
and operating-radio admission; scoped window methods, UI and action recovery tests.

## Scoped read bridge

`cw_decode_resolve_selection` accepts exactly `reference` and the boolean
`require_frequency`. Reference fields must have the exact retained shape; callers
cannot supply callsign or frequency fields. JSON numeric values are not booleans.
Expired/changed evidence and unqualified requested frequency have separate errors.
The disabled-build gate rejects this method before consulting the session.

The Rust worker whitelist admits this read only from main/CW Decode surfaces.
It uses the passive deadline, does not block module transitions and retains the
shared radio/logbook worker on timeout. It adds no draft or radio mutation route.
Seven focused Swift method cases and both Rust CW authority/timeout cases passed.
Rust unit tests used a test-only `TAURI_CONFIG` externalBin-empty override because
this isolated worktree has no staged distribution helpers. No application was
packaged there; canonical production package resource checks remain unchanged.

## Callsign-only durable draft command

`SpotDraftSelection.cwCallsign` carries the exact capture/track selection reference
through the existing draft CAS, durable operation receipt and reservation owner.
Its payload must have no frequency, mode, band, country, reference/comment tags
or opportunity selection. It validates callsign shape, UUIDs and lossless counters.
The caller must still resolve native live evidence; this marker grants no source
authority by itself.

Applying it changes the call, clears lookup identity belonging to a different
previous call, and preserves frequency, mode, reports, operator comment and award
references. The existing automatic/manual start-time and power owners still apply;
an explicitly edited timestamp is retained. It does not insert a logged QSO.
Every tune/rotor staging request is rejected for this draft-only record. Confirmed
completion releases its exact reservation; same-operation retries read its durable
receipt without reacquiring a lease.

All seventeen activation/reservation tests passed, including two new cases for
field preservation, station-effect refusal and malformed/mixed CW payloads.
The explicit Normal Logging action below uses this command through the shared
editor barrier and native window admission.

## Native window identity retention

CW snapshots now receive native activation tokens from a bounded 32-row pool.
Equal evidence keeps its token; a worker generation change, changed evidence or
removed track retires it. All rows are validated before the pool/reply changes.
Ambiguous identities, duplicate tracks, malformed provenance and unqualified RF
are rejected. The reader uses only the existing worker generation and never
starts a service to satisfy a passive snapshot.

Resolution sends only the retained reference back to the same live worker and
compares its full reply with the retained native target. It rechecks the pool and
worker again after readback, then produces the callsign-only command without RF
fields. This resolver itself grants no draft mutation; the explicit window action
below owns that admission separately.
Three focused native retention/readback cases and four frontend projection cases
passed. TypeScript validation accompanies this boundary.

## Draft admission boundary

The native activation backend recognizes retained CW identities as draft-only.
Its durable receipt must match the canonical draft's frequency, mode and band,
rather than treating the CW command's absent RF fields as replacement values.
The application worker resolves the exact native callsign again inside the
database actor, after any queued disk work and immediately before the existing
CAS transaction. Non-owning or disabled workers cannot commit the CW payload.

Ten activation-backend cases and one application-worker admission case covering
both non-owner and disabled-owner configurations passed. This boundary adds no
automatic draft change or station effect.

## Explicit Normal Logging action

`cw_callsign_request` is restricted to main and CW Decode windows, the production
runtime and native operating-module admission. Apply requests accept four CW UUID
identities plus the exact native operating-module/context fence from the snapshot.
The Normal Logging activation coordinator supplies the shared editor barrier,
CAS, durable receipt and exact reservation release. Live callsign evidence is
revalidated at the database lane. The response projection excludes the draft and
refuses any tune-confirmed or rotor-effect outcome.

The shared panel shows the native callsign and an explicit Use callsign action.
It requires an enabled build, running source and native activation identity.
Mounting and selection do not act. One click creates one operation, retained in
the window session before dispatch. Lost or malformed replies keep that identity;
Check original action reconciles it without applying again. Confirmed closed
results allow another selection. Unknown/uncertain results remain blocked and
direct the operator to Main Logging. Frequency, mode and operator text retain the
semantics described above; no logged QSO or station command is created.

Validation: 48 CW-filtered native cases and 20 frontend cases passed, including
identity-only dispatch, rapid repeated click, passive mount, retained lost reply
across remount, mismatched/uncertain acknowledgement and disabled/contesting
refusal at that milestone. Full live workflow acceptance and native-process
restart recovery remain incomplete. Contest callsign loading is described below. This branch is excluded from
the corrective contest releases, where CW stays disabled.

## Unreadable callsign journal

A missing callsign session journal permits a new explicit action. A present but
malformed identity, including an empty or nil UUID, or a storage read failure
now keeps callsign loading blocked. The unreadable value is preserved, and no
invented identity is submitted for reconciliation. The operator is directed to
review Main Logging. This matches the conservative Tune journal behavior.

Four regression cases failed before the correction and pass afterward. The
combined callsign/Tune suites pass 27 cases, and TypeScript validation passes.
This closes the unreadable-journal admission bug; it does not complete native
process restart, lost-window journal, expired contest intent or receipt-compaction
recovery acceptance.

## Durable Normal Logging receipt read

When the native source pool or activation coordinator no longer retains the
original operation, an explicit status/reconcile request can read the existing
worker's `spot_draft_cw_status`. It accepts only the operation UUID and verifies
the stored command's CW callsign marker, command/receipt identities, current
workspace generation and permitted draft-only phase. A general spot receipt
cannot substitute for a CW receipt. Only the minimal action outcome is returned;
historical draft content cannot overwrite later operator edits.

This fallback does not start a worker, apply a draft, resolve a current signal,
release a lease, write a tombstone, tune or dispatch another action. A missing
receipt remains uncertain; an unfinished live reservation remains active. The
existing workspace-load recovery can already mark interrupted records uncertain.
The read does not promote those records to confirmed or clear the UI hold.

Nineteen Swift draft/reservation cases pass, including service replacement,
retained confirmed receipt, later draft edits, current active reservation,
interrupted recovery, missing/unrelated records and malformed requests. A
subsequent focused case also verifies that a changed workspace generation
refuses the old receipt. Full native Rust validation passed 909 cases; the added
passive-timeout case separately confirms no module-transition hold and retention
of the shared worker after a late reply. Renderer worker surfaces cannot call
the new receipt method directly.

This is source/fixture evidence. Expired contest intents, missing or compacted
receipts, lost-window journals, operator review of uncertain outcomes and full
installed process-restart recovery remain open.

## Track mute

Every live track, including a call-less signal, has a separate native control
reference. `cw_decode_track_mute` accepts only that exact retained reference,
rechecks its provider and 250-ms input freshness after suspension, then suppresses
selection/output before queuing compute control. Disabled builds reject it.

The bounded XCW1 kind-8 frame carries the capture token/epoch and sixteen-byte
track UUID only. The child cancels that track's pending job, skips future
channelization/inference and discards queued or completing decode results. An
already running ONNX inference may finish, but its result cannot escape. Other
tracks and radio control remain independent. A missing native track is a no-op;
the parent suppression remains conservative if acknowledgement is lost.

Muting lasts for this track's lifetime. Last text remains readable; it is no
longer a callsign action target. The UI states that retirement or decoder restart
clears this mute. Up to 4,096 muted track UUIDs are retained per decoder session
so a queued accepted spot cannot escape after its row retires. Exhaustion refuses
another mute until decoding restarts; memory does not grow without a bound.

Validation: fourteen session cases and seven live-method cases pass; accepted
spot readmission is rejected after mute. Fourteen real-child/wire harness cases,
native CTest 2/2, one Rust receive-only authority case, twenty-two frontend cases
and TypeScript pass. Native replay continues IQ after muting and verifies other
tracks, exact capture targeting and no subsequent muted decode output. This is
source/replay evidence, not live-radio, capacity or release acceptance.

## Qualified signal read

`cw_decode_resolve_signal` accepts the exact retained control reference and can
resolve a signal with no callsign. It returns only its native reference, source
radio/provider and qualified in-passband RF frequency. It rechecks the provider
after suspension, requires IQ at most 250 ms old and track evidence at most two
seconds old, and refuses replay, ambiguity, mute, changed capture and Stop.
The disabled-build gate and narrow window roles remain in force. This is a
passive read with the five-second, non-retiring deadline, not radio authority.

Seventeen focused session cases, seven live-method cases and the Rust
receive-only authority case pass, including call-less qualified RF, stale IQ,
unqualified mapping, muted target and Stop during readback. Native target
retention, durable Tune admission/readback and its UI remain separate pending
integration; no RF action has been performed by this milestone.

The native snapshot pool separately retains up to 32 qualified signal targets,
with independent opaque activation versions. A signal needs no callsign to enter
this pool. Muted/ambiguous/unmapped rows have no RF activation token, and a worker
change rotates the token. The resolver sends only its retained control reference
to that exact worker, compares the full native reply and rechecks the pool and
worker after readback. Callsign-only and RF tokens cannot substitute for each
other. Five native pool/readback cases and strict frontend RF-token projection
checks cover this boundary. The RF resolver is intentionally not yet called by
an operating action. It grants no RF authority by itself; the explicit durable
Tune integration below owns that admission separately.

## Fenced contest callsign loading

The same explicit Use callsign button routes by the native selected module.
Contesting creates an identity-only `entry_cw_callsign` envelope for the existing
sole Entry consumer. Native code freezes the active contest/session/workspace,
Entry draft ID and semantic draft revision. Dirty, busy, uncertain or armed Entry
state refuses admission. The renderer supplies no callsign, frequency or mode.

When the sole owner takes the action, a separate native resolver checks the
retained operation, the unchanged draft scope and current CW evidence again.
Only `contest-setup` can call this resolver. The owner rechecks the scope and its
latest output state after asynchronous readback, then performs the existing
draft CAS with only the updated callsign field set. Reports, exchange and operating
fields remain under their existing owners. It does not record an automatic heard
spot, insert a QSO, tune, stop output or turn the rotor.

Native CW output must be idle, without a retained/uncertain output lease, at
admission and readback. A queued/taken CW callsign action also vetoes new native
CW arm/send/contest output until the sole owner completes it. Operator output is
refused rather than stopped by callsign loading. Follow Radio and automatic rotor
permission are revoked through their existing owners; no station command is sent.

Queued/taken receipts remain pending and never claim the draft was applied.
Only the owner’s applied receipt confirms loading; rejection closes the action.
Checking the original operation reads its receipt and never submits it again.
Definite failures before queue admission return a closed failure. At most 4,096
CW Entry intents are retained durably; exhaustion refuses new actions without
discarding history. Installed cross-process/expired-context recovery acceptance
remains open. Unknown old operations stay blocked without automatic replay.

The Entry consumer now uses the original native CW request ID for the existing
`contest_draft_apply` operation and its uncertainty record. Previously it generated
a second ID at this boundary, preventing an original-operation receipt lookup
from finding the committed draft change. Other contest mutations keep their
existing ID allocation. The focused callsign regression failed before this fix;
all four CW Entry controller cases and TypeScript pass afterward. This corrects
receipt correlation. The durable routing implementation below follows this fix;
installed restart acceptance remains open.

### Durable contest intent routing

The existing CW Entry owner persists its original operation, native source/track
identity, contest/session/workspace, draft fence and callsign before queueing.
Its private atomic journal is bounded to 4 MiB / 4,096 operations, with no automatic
compaction. Persistence failure retains an uncertainty hold and queues nothing.
Missing storage starts empty; unreadable, oversized, unsupported or symlinked
storage is preserved and refuses admission. Native uppercase track UUIDs remain
valid. One unresolved intent blocks another callsign action and CW arm/send;
Stop remains independent. The existing output admission lock closes the race
between output acquisition and callsign admission, with a recheck under that lock.

An original-operation check first uses its live surface receipt. After source,
surface or process loss it reads the existing contest host's durable operation
receipt, including the original stored request. It verifies method, operation,
session, workspace, draft, callsign, consecutive revision and absence of output
actions. RF fields and unrelated receipts cannot substitute. Only the minimal
confirmed/uncertain outcome reaches the CW view; no historical projection is
published, draft restored, QSO inserted or mutation retried. A taken live surface
receipt can be completed from this correlated proof through its existing owner.
Missing receipts remain uncertain. Status checks require no current signal or
expired detached-window mutation context; Apply still requires both.

Validation: eight journal/Entry native cases and all 68 CW-filtered native cases
pass. The original-request host regression failed before the change and passes
afterward; all 67 host tests pass. These cover storage reopening, later edits,
nil/wrong identities, unrelated/RF receipts, absent receipts, corrupt storage,
symlinks and failed persistence. Full installed process restart and recovery from
missing native evidence remain acceptance work. Unknown evidence never authorizes
replay or clearance.

### Finding an original action after window loss

The explicit **Find original action** control reads unresolved operation IDs from
the existing native Contest journal and CW-marked Normal Logging receipts. It
works while capture is stopped and does not start a worker or decoder. A bounded
Normal read scans at most 64 unresolved draft receipts and checks their command,
receipt, phase and current workspace generation. Excess or malformed evidence
fails visibly; it is not reported as an empty history. Raw renderer worker calls
cannot access this native-only read. Its passive timeout preserves the shared
worker and does not hold a module transition.

One discovered original is retained for **Check original action**. Multiple
originals require an explicit target/operation choice and keep Use callsign
blocked. No recovery click creates a mutation ID or re-applies a callsign. Before
replacing an unreadable window ID with verified native evidence, its exact old
value is retained under the unreadable backup key; an occupied differing backup
refuses replacement. A historical confirmation directs the operator to inspect
the current entry instead of claiming its old fields are current.

The new discovery regression first failed with method_not_allowed. All 20 Swift
draft/reservation cases, 69 focused native cases, 27 callsign/panel cases and
TypeScript pass, including stopped capture, a lost window ID, two original draft
owners, malformed discovered data, preserved corrupt storage and changed workspace
generation. Installed process/window-loss qualification remains open.

### Explicit reconciliation of an interrupted Normal original

`spot_draft_cw_status` remains a read. The explicit original-action reconciliation
can additionally close only the original CW receipt's metadata after worker
replacement. It requires a validated callsign-only command, matching non-nil
operation/workspace/draft/lease identities, the immutable draft-applied receipt,
the exact callsign and consecutive draft revision, and an allowed non-RF phase.
The receipt's indexed phase must agree with its stored payload. These checks
are shared by status, discovery and reconciliation.

That durable receipt proves the callsign-only draft transaction committed; CW
records cannot stage Tune/rotor effects. If its original lease is still live,
reconciliation leaves it active. Otherwise only the same operation's interrupted
phase may become confirmed. The command and original receipt remain intact;
no current draft fields, revision, timestamp, power state or unrelated lease are
changed. Missing, substituted, malformed and wrong-generation evidence cannot
authorize completion. No new operation ID or tombstone is created.

This native-only metadata route blocks a module transition while admitted but
keeps the shared worker after a lost reply, so checking the same original is
safe. An unrelated unreadable Contest journal still vetoes new actions and ID
discovery; it cannot prevent an identified Normal original from proving its own
receipt. Stop remains independent.

The interrupted-original regression failed with method_not_allowed before
implementation. All 22 Swift draft/reservation and 70 CW-filtered native cases
pass afterward, including live-lease refusal, process-owner replacement, later
operator edits, idempotent original completion, missing evidence and substituted
identity/callsign/revision/RF phase. Full installed recovery acceptance remains.

Validation: 57 CW-focused native cases, 25 callsign bridge/response/projection UI cases,
four sole-Entry controller cases and TypeScript pass. The controller fixture
checks field preservation, no Tune/Stop and refusal of a stale semantic revision;
the other cases refuse armed, pending and uncertain output. These are source and
fixture results, not installed app, hardware or complete CW acceptance.

Both Normal Logging and Contesting clicks carry the exact native operating
context observed in their snapshot. Native admission holds that module/context
through the normal transaction or contest queue admission. A late click after a
module switch cannot silently target the other entry. Missing/invalid module or
context disables the UI action, and normal/contest operation identities cannot
substitute for each other's retained routes.

## Explicit durable Tune

The separate Tune button accepts a qualified signal without a callsign. It
identifies the source radio and target frequency in its label. An inactive source
requires an explicit Radio Settings selection first; the action never switches
the active radio. Selection, mounting and transcript updates remain passive.

The renderer sends only native source/track/version identities and the observed
operating module/context. A dedicated native command resolves the RF target,
requires its source slot to be active with the matching direct Flex/TCI provider,
and constructs a CW simplex descriptor from current native selection, connection,
control and worker epochs. It refuses retained or armed CW output. No renderer
frequency, mode, PTT, rotor or QSO fields are accepted.

The existing Station Control journal persists the operation before dispatch.
Native-only `cw_signal` provenance survives a process restart; ordinary renderer
Station Control parameters cannot add that marker. The existing manual tune
owner checks fresh receive telemetry and authoritative readback. Additional
guards revalidate exact CW evidence and the active slot inside selection admission
and immediately before the one transport send. Follow Radio and automatic rotor
permission use the existing manual tune behavior. The logging draft is untouched.

One native CW apply gate prevents simultaneous duplicate clicks from racing the
original receipt lookup. A repeated identity reads its original durable receipt
before consulting live evidence. A lost reply is retained in the renderer journal;
Check original tune only reads that operation's minimal status. Confirmed or
durably reviewed outcomes close the intent. Missing, pending and unknown receipts
remain blocked without replay; the operator reviews unknown radio state through
the existing Station Control owner. Definite pre-admission refusal closes without
claiming a tune occurred. Receipt compaction, malformed renderer storage and an
expired contest-window context still require complete recovery qualification.

Source/fixture tests cover identity-only admission, inactive/provider refusal,
native target construction, minimal correlated projection, durable provenance and
restart deduplication, passive UI selection, lost replies and unverified receipts.
No live tune, installed CW UI or RF acceptance is established by these tests.

Validation on this source: all **904 native tests** passed, including the existing
manual tune and selection-owner regressions; **31 focused frontend tests** passed.
TypeScript, Vite and every configured window graph check passed. CW Decode's
startup graph measured **302,032 bytes**, still separate from the main logging
controller, map and CW transmit bundles. No application candidate was packaged.

### Timed current RF evidence

An acquiring track's diagnostic offset cannot authorize Tune or callsign loading.
A regression reproduced that grant despite missing carrier timing. Native IQ
decode events now retain their latest actual carrier observation, with its own
channel sample. Current RF targets use that measurement, qualified mapping and
at most two seconds of receive-relative age, including FIR delay and elapsed
local time. Metadata-only notifications preserve the original measurement age;
they cannot renew it or substitute a new offset. Expiry withdraws the displayed
RF frequency and native action grants. Mute/focus remain available for diagnostic
tracks. Tune still does not require a decoded callsign.

The parent pins capture descriptor, source sample origin and FIR delay for each
retained track UUID, including revision changes. A changed clock retires that
track's evidence. Focused session/policy checks pass **35/35**; native CTest is
2/2 and projection/panel checks are 25/25 with TypeScript passing. The subsequent
real-child suite has 18/19 passes: real-rate replay misses input freshness at
sample 1048576, sequence 128, **279.6405 ms** lateness, child failure nil. Its
250-ms guard is preserved; exact-package/live acceptance remains unclosed.
