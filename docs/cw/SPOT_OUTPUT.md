# Native accepted CW output

`CWDecodeSession` reconciles committed, sample-aligned copy, extracts transmitting
identity occurrences and evaluates `CWSpotPolicy` under the current source lease,
stream token, epoch, track revision and fresh IQ receipt. Provisional text cannot
become an automatic spot. Observation UTC is derived from the original sample
position/host receipt with channelizer delay accounted for; replay is excluded.

Eligible output enters one 16-item queue. A single `LiveCWDecodeMethods` consumer
rechecks source evidence before direct typed ingress into the existing cluster
classifier/history, and again before the local TCP listener. It does not create a
localhost inbound cluster connection, a QSO, a tune request or a public-cluster
publication. The local server banner and emitted provenance share an instance
UUID. A failed output is dropped and reported separately from the IQ decoder.
Retired epochs and Stop prevent queued output from being admitted later.

Production `CWSpotPolicy()` starts unqualified. Its quality flag has no worker or
renderer setter. Both current live IQ adapters also report unqualified RF mapping.
Neither a saved automatic-spot preference nor an operator handoff changes these
gates. Tracks expose their withholding reason. The fixture-only qualified policy
constructor is internal to the policy module and used through `@testable` in
tests; the application module cannot construct that policy.

Session fixtures cover positive committed identification through the bounded
accepted-output queue, queued-spot rejection after source invalidation, and zero
production output despite an enabled preference and qualified *fixture* RF.
Separate classifier/archive and real loopback listener tests exercise the typed
accepted record. These are software integration checks, not G4's real held-out
whole-call precision/false-spot scorecard, real radio mapping, or a release gate.

## Distinct transmitting identity — 31 October 2026

Deliberate **Use callsign** and automatic spots now require the same minimum of
two distinct, completed, aligned self-IDs. Repeated model windows of one
transmission cannot create a loading action. Connected overlapping alternative
sample ranges count once; the retained range is an original observation, not a
fabricated union. Committed text itself is unchanged by this identity policy.

Repeated `DE` self-IDs remain evidence across separate overs. A `DE` can discard
earlier CQ candidates only within its current phrase; it cannot erase earlier
stations from the track history and silently switch identity. CQ/TEST begins a
phrase. K/AR/SK/BK, intervening non-context words, and an inter-word sample gap
over one second separate phrases. Existing DX context is preserved. Different
sender calls in retained recent evidence withhold identity as ambiguous. These
are explicit engineering grammar rules, not language-model filling or lookup
evidence, and are fixed before any held-out RF evaluation. A token gap used for
phrase attribution never repairs an uncertain IQ discontinuity.

The new regressions first fail on one-ID loading, lost DE repetitions, erased
earlier senders and overlapping range chains (`138002b8bda334aa`,
`2fb16b248bc5f397`). After repair, **28** session/policy cases pass
(`158769d13754be00`), including positive two-ID loading and output, and **27**
callsign/panel cases pass (`504f379118951e5a`). The view explicitly names its
Normal Logging or Contest Entry target; native operating-context and draft-owner
fences remain authoritative. These source fixtures do not supply held-out RF
precision/recall, negative band-hours, or production qualification.

## Frequency tied to the self-ID — 31 October 2026

Spot frequency now uses a carrier measurement at or before the final required
self-ID, on its channel clock, rather than the later decode window's frequency.
The track keeps five recent isolated FFT observations and selects an actual
median observation with its original sample time. Gapped keying can make a
sideband win one FFT window; that outlier must not relabel earlier Morse. No
frequency is backdated or interpolated across missing evidence. A bounded
256-point history and immutable per-job copy carry those observations into
native token metadata. Ambiguity clears both histories. FIR delay is included
in the source-to-channel clock conversion.

Aligned committed tokens preserve this metadata. Two distinct contributing
self-IDs need measured carrier evidence, and the newest ID must have an
observation no later than its end and at most 1600 channel samples / 0.5 seconds
earlier. Unknown/future/stale evidence withholds output as
`frequency_evidence_unavailable`; the current window cannot substitute for it.
The RF mapping and production-quality gates still apply independently. Original
UTC continues to follow the self-ID sample position, while the track inspector
and deliberate Tune use the current track frequency.

The bounded publication proof now retains the exact accepted typed spot. A later
carrier drift does not rewrite its historical frequency, and a copied spot ID
cannot authorize a modified frequency or provenance. Source/stream/epoch,
continuity, identity, freshness and ownership are still rechecked before and
after provider awaits; Stop, mute and revision loss withdraw proof.

Regressions first reproduce a +600-Hz self-ID being spotted at the later +800-Hz
window and an accepted spot without measured identity RF (`895d4577288be66c`).
All **32** session/policy cases pass after repair (`87ce094973f3c16b`), including
payload tampering, missing/future RF and fresh post-loss recovery. Native chirps
first expose a 13.159-Hz keyed-edge outlier; the observation selection repairs it
without relaxing the fixture's 10-Hz limit or withholding completed test IDs.
For +8/−8 Hz/s drift, all completed test IDs retain final-character RF, with
maximum historical-token errors **0.672855 / 0.512208 Hz** (16 observed tokens per
direction, two decoded windows). Native CTest passes 2/2 (`51af146d5bf9a415`).
These are synthetic checks; real RF p95, held-out precision/recall and negative
exposure remain unqualified.

The actual Swift → child → Swift replay also verifies RF metadata on each
decoded call's final character (`a496e38c7869dc7c`), using byte-identical paced
IQ and the original 250-ms admission limit. Ten wire-parser cases reject partial,
future, stale and malformed observation pairs. Twenty-two frontend projection/
panel cases pass with the specific withholding reason (`725d01930f8a197e`).
