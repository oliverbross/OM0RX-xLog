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
