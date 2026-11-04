# CQRLOG C01–C06 follow-up code review

Review baseline: clean canonical main `68d7b02846c94d904cdf3c9452f4c931e7167b48`,
fast-forward fetched/pulled before work. Scope is the complete C01–C06 source
delta from `db4a9ce2739fc8b96371cd432d3b8787e950a45e`, its callers and shared
country/output/storage boundaries. Review is in progress; the entries below
record confirmed defects and completed fixes, not blanket acceptance.

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
