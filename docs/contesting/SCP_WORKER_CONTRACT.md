# Offline callsign assistance backend contract

This backend slice exposes the accepted Super Check Partial engine through a
small read-only actor. It ships no `MASTER.SCP` bytes, resource, downloader, or
provider updater. Packaged-dataset redistribution has not been evaluated. A
later explicit import or provider-update flow may populate private workspace
reference data and construct the immutable index.

The actor accepts either no dataset or an already imported `ContestSCPIndex`.
The caller must explicitly admit that index through one of two trust paths. An
`expectedDigestMatched` admission requires `matchedExpectedSHA256`, proving the
caller's expected SHA-256 matched the exact raw import bytes. An
`operatorOrProviderPolicyApprovedComputedDigest` admission requires a
`computedOnly` index and records only that a trusted caller approved those
bytes under external operator or provider policy. It does not authenticate the
provider or turn a self-computed checksum into authenticity evidence. The index
retains its source ID, version, optional URL and retrieval time in the dataset
metadata returned with each query. An absent index produces the specific
`dataUnavailable` result; it never falls back to a network request.

Every query is bound to canonical session, workspace-generation and request
UUIDs. Raw query input is limited to 2 through 32 ASCII bytes before the actor
retains it or awaits authority. A private monotonic admission token is recorded
before the first authority suspension and checked after every suspension. The
injected contest authority validates the session and generation before and
after computation. Search parameters are fixed at 20 results and 100,000
evaluations. The core checks cooperative cancellation throughout the bounded
search. Only one query per session and generation remains current; a newer
request retires the older request for that scope.

Validating, running, and retired operations all retain capacity and exact
request-ID ownership until their token-matched caller settles, including when a
producer ignores cooperative cancellation. This bounds total admitted work and
prevents a delayed older completion from removing or replacing newer state.
Request UUIDs additionally pass a bounded recent replay fence; once an ID ages
out it can be reused only when no operation or cached result still owns it.
Other scopes remain independent up to the configured total-operation bound.

Cancellation names the complete context and can retire only that exact admitted
request or cached result, including a request still awaiting authority. Query
results remain server-held in a bounded cache.
Selection supplies only the exact context and a match ID; the actor retrieves
its cached result, resolves the digest and ordinal through the immutable index,
and rechecks session and generation before returning the authoritative callsign.
It accepts no candidate text from the client and returns no exchange, draft
patch, commit intent, or station action.

Shutdown retires all admitted work, clears selection evidence and rejects new
work. Retired ownership remains until each suspended caller actually settles.
The actor owns computation and ephemeral result evidence only. The existing
contest store remains the session, generation, draft and revision authority;
the existing mutation owner remains the only path that may change a draft or
log a contact. Worker wire methods, client types, UI, operator-managed import,
official provider download/update and packaging are later integration slices.
