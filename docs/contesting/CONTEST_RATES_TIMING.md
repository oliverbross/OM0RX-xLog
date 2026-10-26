# Contest Rates timing

Rates shows UTC, Local and Remaining in one compact row, with the finish timestamp
in UTC below. Start UTC and End UTC in contest setup describe the full contest
period, not an individual operator's allowed operating hours.

- CQ WW SSB/CW defaults to 48 hours after the configured Start UTC, following
  [CQ WW rules](https://cqww.com/rules/). An explicit End UTC overrides the default.
- Other plugins require an explicit End UTC; no duration is guessed.
- Set Start UTC to the actual contest start. Calendar dates are not inferred from
  a session name or its first QSO.
- New Contest and a contest-type change clear the previous explicit finish.
- Before the start, Rates shows the full duration and “Not started”. At the end,
  it stops at 00:00:00 and shows “Finished”. Missing or invalid schedules show a
  dash and a setup hint. Saved logs and QSO timestamps are unchanged.

Since last QSO interpolates from green at zero through amber at 7 minutes 30
seconds to red at 15 minutes, then stays red. No QSO means a neutral dash. A newly
logged QSO returns it to green. Elapsed time remains readable without color.

Validation: 141 focused frontend tests pass, including schedule/date edge cases,
setup save/reload, countdown lifecycle, idle reset and transport compatibility.
Native projection tests cover timestamp validity and reversed/missing boundaries.
The production frontend build and Rates visual checks at 640px/320px passed.
This source change does not package or install an application candidate.
