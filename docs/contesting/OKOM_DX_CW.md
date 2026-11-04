# OK/OM DX CW 2026

Select **OK/OM DX CW**, separately from OK1WC Memorial. The first-party definition
uses the existing Python contest authority, serial allocator, ESM, log and exports.
It does not run TLF or add another scoring engine.

In New Contest, declare **Operating-country prefix (OK/OM)** using the country
resolved for the station's actual operating callsign. For example, `OM0RX/DL`
operating from Germany must have a pinned Germany resolution and declaration `DL`.
The mailing-address Country field does not select the scoring branch.

- OK and OM entrants enter their official three-letter district as the sent
  exchange, excluding RST. There is no serial reservation for this branch.
- Other entrants select `#`. The existing authority reserves chronological
  serials. Previewing or sending a message does not reserve an additional serial.
- Enter the contacted OK/OM station's district, or a positive DX serial. Unknown
  or country-mismatched districts are rejected; the original received text is
  retained in the raw contact identity while the scoring exchange is normalized.
- The ordinary Run/S&P ESM and F-key roles remain available. Corrected domestic
  exchanges can complete through the same pinned WPX ESM callback with its finite
  OK/OM exchange-admission overlay. Logging stays an explicit ordinary action.

SO and MOST use the existing chronological serial authority. **MO2T submission is
unavailable**: the current owner does not capture actual per-QSO transmitter IDs
or implement its required per-band/per-transmitter serial scope (§5.1.2). New TWO
setup is refused; retained TWO sessions preserve contacts and exchanges but show
an incomplete claim and block Cabrillo. No default lane/Run1Run2 value is treated
as transmitter proof. Completing MO2T remains an open implementation requirement.

The 2026 rules allow everyone to work everyone on 160, 80, 40, 20, 15 and 10 metres,
CW only. For OK/OM entrants, own-country, other-country/same-continent and
other-continent contacts are worth 2, 3 and 5 points. For DX entrants, contacts
with OK/OM are worth 10 points; other own-country, same-continent and
other-continent contacts are worth 1, 3 and 5 points. Maritime-mobile contacts
are worth 5 points and have no multiplier. Russia/Belarus contacts remain in the
log with no points or multiplier under the organizer's clause 14.

Each OK/OM district and each DXCC/WAE country counts separately on each band.
The first valid contact with a callsign on a band scores; keep duplicates in the
log with zero additional points. An invalid first contact does not consume the
later valid contact's credit. Multiplier views read the same scoring records.

The selected 2026 credit period is 14 November 12:00 UTC through 15 November
11:59:59 UTC (12:00 end exclusive). Outside-period rows retain their raw times
and receive zero credit; they cannot consume a later valid duplicate key. A
single-band claim includes only that band's points/multipliers, while other-band
rows remain in the log/export for checking (§3.2). Switching category changes the
claim without deleting contacts. For a retained pre-correction contest, explicitly
use its existing Recalculate action to refresh stored points/multiplier flags;
there is no automatic database-wide rescore or change of edition/sent history.

Saved contacts retain their sent exchange and operating-location/definition
snapshot. Changing setup does not rewrite those historical values. Cabrillo uses
`CONTEST: OK-OM-DX`, saved station calls, UTC, frequencies and sent/received
exchanges. ADIF includes the exchange and original entry fields. Check category,
address and email before any separately authorized submission; export generation
does not establish sponsor acceptance. The sponsor calculates the final score.

The [rule reference](OKOM_CW_2026_RULE_REFERENCE.json) records the official 2026
CW page, all 86 OK and 79 OM districts, source bytes and digest. The retained
HTML is gzip-compressed without alteration. Retrieval used the organizer's
published HTTP endpoint because HTTPS fails certificate hostname validation;
no TLS check was bypassed. Do not substitute the separate SSB page or old
pre-2024 prefix-multiplier rules.

Software checks cover independently calculated domestic/DX totals, portable
operating location, actual ESM, duplicate recovery, edit/delete/rebuild/reopen,
sent snapshots, exact Cabrillo rows and ADIF bytes. New installed operation,
physical CW output and sponsor submission acceptance remain separate checks.
