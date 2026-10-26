# Statistics duplicate counts

Both the compact CQ WW SSB table and generic Statistics table show DUPES after
QSO, for each band and TOTAL. QSO remains the existing logged-contact count;
points, multipliers and claimed score retain their existing authority.

The host classifies the complete current-contest snapshot in timestamp/row order
before applying a selected score-band filter. Ordinary plugin duplicate scopes
are once per contest, per band, per band/mode group, or disabled. Special plugins
use their existing historical time-block/rover callback against a read-only view
of prior rows. CQ WW matches the existing log's duplicate projection. Zero points
alone are never duplicate evidence.

No log rows, audit entries, revisions or scores are rewritten for this read. A
corrected/deleted original is reflected on the next score/statistics refresh.
Missing old transport evidence, or incomplete special-rule time/rover evidence,
displays a dash rather than an invented zero. Known totals must equal band sums;
unknown evidence propagates to TOTAL.

Validation: 20 Python unit/disposable-host checks; 471 focused frontend checks;
two native Statistics validation checks; TypeScript/production build; visual
inspection at 640px and 360px without horizontal overflow. The host tests protect
read-only behavior, zero-point nondupes, mode/band scopes, deletion promotion and
Trans Tasman's two-hour boundary.

Include this change and Rates timing commit `e585e56c` in the next jointly accepted
canonical candidate. Installation is authorized by the user after readiness and
CW release-scope/package gates; no intermediate candidate is installed by this
source change.
