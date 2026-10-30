# Retained CW track selection

This branch adds retained native evidence and explicit callsign-only loading into
the shared Normal Logging draft and the fenced contest Entry. Tune and complete
action recovery remain pending. This work does not qualify CW for release.

A track gets an opaque selection reference only when committed aligned text
identifies one plausible transmitting callsign in the last sixty channel seconds.
Provisional text and competing identities do not qualify. Ambiguous/replay tracks
have no reference. The reference pins session, source, stream token, epoch, track,
revision and a generated selection UUID. A different call, qualified frequency,
revision or capture retires the previous reference. Equal evidence keeps its
reference across passive snapshots. Native track UUID case is preserved safely.

`CWDecodeSession.resolveSelection` reads the retained track and existing provider,
then rechecks the actor after the asynchronous provider read. Stop, changed lease,
source, epoch or selection fail closed. Input must be at most 250 ms old and the
selection must have been renewed by a decode within two seconds. Callsign-only
resolution may work with unqualified RF; it returns no invented frequency.
Requesting an RF target additionally requires qualified mapping and a real
in-passband frequency. The resolver has no side effects.

The frontend projection validates callsign shape and every reference field
against the same track/capture. Renderer-supplied fields cannot become a native
callsign or frequency; future action admission must resolve the retained native
reference again at its owning draft/control boundary.

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
CW Entry intents are retained by a native process; exhaustion refuses new actions.
Cross-process/expired-context recovery remains a separate open gate: unknown old
operations stay blocked for review in Main Logging, without automatic replay.

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
