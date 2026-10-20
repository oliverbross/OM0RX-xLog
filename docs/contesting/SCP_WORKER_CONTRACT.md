# Offline callsign assistance backend contract

This backend slice exposes the accepted Super Check Partial engine through a
small read-only actor. It ships no `MASTER.SCP` bytes or resource. An explicit
operator action may either import a local file or download the current official
`MASTER.SCP`; neither path performs an automatic launch-time update.

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
log a contact. Official provider download/update and packaging remain later
integration slices.

## Operator-managed local import

The contest test app can open a native file chooser for a local `MASTER.SCP`
file. The renderer never receives or supplies its filesystem path: the native
command passes the selected path through a private worker method that the
generic renderer worker bridge rejects. No dataset is bundled and this flow
does not download, update, or authenticate a provider dataset.

The worker reads at most the 16 MiB cap plus one byte, validates the exact raw
bytes with the immutable core importer, and records the selected basename and
import time as operator-managed provenance. Explicit operator policy admits the
core's `computedOnly` digest; the digest proves byte identity after import, not
provider authenticity. One bounded cache envelope stores that metadata and the
unchanged raw bytes under the private contest profile. Atomic replacement is
attempted only after the new index is valid, so a failed read, parse, or write
keeps the previous in-memory index and cache.

The cache path is revalidated through the contest database's private-root
boundary before directory creation and every publication step. Existing cache
ancestors and the cache leaf must not be symbolic links. An unreadable or
malformed regular cache is reported as `invalid_cache` with no active dataset;
the operator can replace it through a later valid import. The bounded envelope
is checked before decoding.

Replacement shuts down the prior assistance lane before publishing the new
index. Its pending work cannot publish results into the new dataset, and old
selection evidence is unavailable after replacement or restart. Worker query,
cancel, and selection methods are namespaced under `contest_scp_`; the contest
lane verifies session and workspace generation against its store before and
after each search. Selection returns only the authoritative indexed callsign.
The UI applies that value through the existing contest draft mutation owner and
does not change a typed exchange. Selection is also bound to the active owner
lease, session, workspace generation, draft identity and original typed
callsign. It patches the current fields after those checks, preserving later
exchange edits and a reserved serial.

## Official provider download

`Download latest` uses the native Swift worker transport. It discovers the
current file and metadata from `https://www.supercheckpartial.com/api/v1/files`,
requires exactly one case-sensitive `MASTER.SCP` entry, and downloads only
`https://www.supercheckpartial.com/downloads/MASTER.SCP`. The transport accepts
HTTPS GET to that fixed host only, refuses redirects, cookies, credentials and
URL caching, and bounds the catalog to 64 KiB and dataset to 16 MiB. It sends an
identifying User-Agent and uses `If-None-Match` when the active official digest
matches discovery metadata.

A 200 response must agree with the catalog on byte count and ETag. The ETag is
treated as the expected lowercase SHA-256 and the unchanged raw bytes must pass
the core importer before provider admission. A 304 is accepted only when the
active official dataset already owns that exact digest. Provider, HTTP, size,
digest, format, storage or admission failure retains the active dataset and
cache. A successful replacement is atomically written before the old query
lane is retired. The UI reports the provider release date, abbreviated digest,
verification status, whether a new release was activated or the cache was
already current, and a retryable error without hiding the retained dataset.

Status, query, cancellation and selection are bounded non-retiring worker
reads. Import is a state-changing operation. The native chooser pins the
already-running worker generation before presentation and rechecks the main
window, process-exit state and exact generation before dispatch. Its exclusive
lease belongs to the blocking chooser-to-dispatch operation, so cancellation
of the invoking UI waiter cannot admit a second import while that operation is
still settling. A timeout or lost import reply is an uncertain replacement
outcome: the operator must use status recovery before choosing another file.
There is no mutation receipt for this private reference-data replacement.
