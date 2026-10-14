# Live Wavelog synchronization acceptance — 15 October 2026

## Boundary

This acceptance used the installed alpha.29 worker from
`/Applications/OM0RX-xLog.app` against the existing production integration
workspace. The Windows Remote Station Agent was intentionally off. No radio,
amplifier, tuner, rotor, PTT, Tune or CW command was issued.

Before mutation, a private SQLite backup was created at
`~/Library/Application Support/OM0RX-xLog Integration Updates/20261015-before-live-sync-alpha29-c47dbb5/OM0RX-xLog.sqlite`.
It is mode `0600`, 302,071,808 bytes, passes SQLite `quick_check`, and has
SHA-256 `93113e3911b490579c0f617874ab48038e89165caa426d1f721cad9d5926cf2b`.
The pre-sync database contained 68,024 active contacts, zero dirty contacts,
zero outbox rows, zero conflicts and QSO revision 68,239.

## Read-only preview

The independent remote-history probe reported 68,031 remote IDs: 68,025 were
unambiguous and six were held across three semantic identities. Seven remote
IDs were initially absent locally: four ordinary contacts plus the alternate
member of each held pair. No clean or dirty local ID was absent remotely.

The held identities are:

- `JG1IVI|1782486375|15m|FT8|21075575`, remote IDs 174608 and 174609;
- `K8DLD|1782488895|17m|FT8|18101575`, remote IDs 174610 and 174611;
- `YF3ARV|1782491595|15m|FT8|21075575`, remote IDs 174613 and 174614.

These are genuine same-identity remote pairs, not six unrelated contacts. Their
ADIF details differ. Some differences are empty-versus-confirmed service fields;
JG1IVI and YF3ARV also contain conflicting populated values. The safe behavior
is therefore to hold both members rather than guess an ID or borrow confirmation
data from one record.

## Live result

The persisted automatic-sync authorization was active at a one-minute interval.
The installed worker completed its startup synchronization, after which a fresh
generation/revision/context owner admitted operation
`BDA7DABE-0B26-464F-85CC-98A0532E5C7D`. Its durable receipt is acknowledged.
The explicit run completed at `2026-10-14T18:53:17Z` with completion ID
`A09E7222-06B1-4903-8D31-0E159CF2844D` and reported:

- 68,025 unambiguous remote records processed;
- zero pushed, deleted, failed or conflicted records;
- six remote records held for review.

The aggregate live database delta from the pre-sync backup is exact:

- four new Wavelog contacts imported: G6INI (178873), VE4ZIM (178874), RC8SC
  (178875) and VK3AMP (178876);
- five existing contacts and their remote baselines refreshed from current
  Wavelog data, including LoTW, eQSL, QRZ download, grid and related enrichment;
- 68,028 active contacts, all 68,028 linked to a Wavelog ID;
- zero dirty contacts, zero outbox rows, zero conflicts and QSO revision 68,248;
- SQLite `quick_check` remains `ok`.

## Independent post-sync proof

The same read-only remote-history probe passed again in 112.017 seconds. It still
reported 68,031 remote IDs, 68,025 unambiguous and six held. Only three remote
IDs remain absent locally, exactly the alternate members of the three held
pairs. No safe remote contact remains unsynchronized, and no clean or dirty
local contact is absent remotely.

This closes live Wavelog reconciliation and persisted automatic-start acceptance
for alpha.29. It does not resolve the three source duplicate pairs in Wavelog;
they must be reviewed there before either member is changed or removed.
