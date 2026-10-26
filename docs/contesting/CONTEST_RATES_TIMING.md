# Contest Rates timing

Rates shows UTC, Local and Remaining in one compact row, with the finish timestamp
in UTC below. Start UTC and End UTC in contest setup describe the full contest
period, not an individual operator's allowed operating hours.

- Explicit End UTC uses the configured period and takes precedence.
- CQ WW SSB/CW otherwise uses the organizer's last full weekend of October or
  November, 00:00 Saturday to 24:00 Sunday, following
  [CQ WW rules](https://cqww.com/rules/) and the [calendar](https://cqww.com/index.htm),
  verified 26 October 2026. For 2026 SSB that is 24 October 00:00 through
  26 October 00:00 UTC; CW is 28–30 November.
- The CQ WW calendar year comes from a session QSO within that year's actual
  contest period. Without QSO evidence, an exactly matching configured organizer
  start is accepted; an arbitrary creation timestamp is not. Ambiguous dates
  remain unconfigured. Rates labels the organizer calendar and year explicitly.
- Other plugins require an explicit End UTC; no duration is guessed.
- Legacy StartDate can be session creation time. The display never adds 48 hours
  to that timestamp. No saved settings, QSO data, migrations or scores change.
- New Contest and a contest-type change clear the previous explicit finish.
- Before the start, Rates shows the full duration and “Not started”. At the end,
  it stops at 00:00:00 and shows “Finished”. Missing or invalid schedules show a
  dash and a setup hint. Saved logs and QSO timestamps are unchanged.

Since last QSO interpolates from green at zero through amber at 7 minutes 30
seconds to red at 15 minutes, then stays red. No QSO means a neutral dash. A newly
logged QSO returns it to green. Elapsed time remains readable without color.

Validation: 144 focused frontend tests pass, including schedule/date edge cases,
setup save/reload, countdown lifecycle, idle reset and transport compatibility.
Native projection tests cover timestamp validity and reversed/missing boundaries.
The production frontend build and Rates visual checks at 640px/320px passed,
including the organizer source/year label and the corrected 2026 SSB finish.
This source change does not package or install an application candidate.
