# HRDLOG upload-contract review

Date: 15 October 2026

## Outcome

HRDLOG remains a useful optional online-log target, but xLog must not implement
or enable an upload adapter from undocumented or third-party-inferred behavior.
The current official public material confirms real-time upload support and a
dedicated upload code associated with the operator's callsign/username. It does
not publish a stable machine contract sufficient for xLog's durable delivery
owner.

No HRDLOG credential was requested or stored and no provider request was made.

## Official evidence reviewed

- [HRDLOG automatic upload](https://www.hrdlog.net/docs/autoupload.aspx) confirms
  that supported logging applications can send QSOs in real time.
- [HRDLOG Log4OM instructions](https://www.hrdlog.net/docs/Log4Om.aspx) describe
  a callsign/username plus a dedicated upload code, rather than the account
  password.
- [HRDLOG resources](https://mobile.hrdlog.net/Resources.aspx) lists compatible
  logging applications and service capabilities.
- [HRDLOG contact](https://www.hrdlog.net/Contact.aspx) is the official route for
  obtaining missing integration information.

The reviewed official pages do not specify the endpoint, HTTP method, byte-level
payload/schema, success and error responses, idempotency behavior, rate limits,
retry rules, or whether a request whose response is lost may be safely replayed.
Those omissions are material: guessing them could duplicate a QSO, leak a
credential, or cause repeated provider traffic after an ambiguous outcome.

## Required contract before implementation

An HRDLOG adapter can be implemented after current provider-owned documentation
or direct provider confirmation establishes:

1. the production HTTPS endpoint and method;
2. exact credential fields and their transport/storage requirements;
3. exact ADIF or structured payload encoding and size limits;
4. success, rejection, authentication, throttling and transient-failure
   responses;
5. idempotency or duplicate semantics, especially after a lost response;
6. retry and rate-limit requirements; and
7. a non-production or explicitly authorized acceptance path.

## Intended xLog boundary

Once documented, HRDLOG should follow the existing QRZ and Club Log principles:
separate Keychain credentials, default-off prospective enrollment, immutable
one-contact claims, durable receipts before network I/O, no automatic replay of
ambiguous outcomes, aggregate-only renderer health, immediate credential
removal, and no backfill of imports, Wavelog pulls, edits or confirmation-only
refreshes. It remains independent from Wavelog's richer two-way reconciliation
and receives no radio, Tune, PTT, CW, rotor or amplifier authority.
