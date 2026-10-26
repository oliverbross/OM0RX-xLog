# Retained CW track selection

This branch adds retained native evidence and explicit callsign-only loading into
the shared Normal Logging draft. Tune, contest entry integration and complete
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

Remaining integration: fenced contest `entry_set_text` through its sole main
consumer; explicit Tune through the durable manual-tune owner with current source
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
runtime and Normal Logging admission. Apply requests accept four UUID identities
only. The existing activation coordinator supplies the shared editor barrier,
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
refusal. Full live workflow acceptance, native-process restart recovery and
contesting callsign loading are not yet complete. This branch is excluded from
the corrective contest releases, where CW stays disabled.

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
