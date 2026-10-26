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
