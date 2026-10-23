# CQ WW SSB — final operator-readiness completion plan

**Owner:** Oliver Bross / OM0RX  
**Prepared:** 23 October 2026  
**Purpose:** Finish the existing xLog contest desk for actual CQ WW SSB operation. This is the execution handoff, not a new architecture project.  
**Reviewed executable source:** `cb708501d781dafc5517e51c6a8c6b341ec2fa55`  
**Priority order:** contact correctness and immediate operator feedback → usable window geometry → one integrated candidate and acceptance.  
**Event:** 24–25 October 2026, beginning 00:00 UTC on 24 October (09:30 Australia/Darwin). Use the transmitter's configured station location for contest information, not the computer's physical location.

## 0. Read this first: the assignment and the stop condition

Keep the pinned executable Not1MM Python plugins and SQLite behavior, xLog's styling, separate operating windows, existing radio/cluster/audio/rotor services, and durable command/data ownership. Do not restart the port. Use the supplied **N1MM Logger+ manual printed 3 October 2026** for the operator behavior explicitly referenced below. N1MM is the reference for this finishing work; it is not a request to replace Not1MM with a second contest engine.

The user stopped the prior task because repeated implementation/review/build cycles were not producing a finished operating desk. The supplied screenshot is the acceptance problem to solve. A passing test count, registered route, or window that merely opens is not completion.

**Finish line:** the selected CQ WW SSB session can be operated rapidly from Main Logging; dupes and failed logging are unmistakable; every required window resizes without lost controls or needlessly wasted space; contacts, scoring and export survive restart; and one exact-source installed candidate demonstrates these behaviors. Stop after the final acceptance report. Preserve broader Not1MM parity as post-contest backlog, rather than silently dropping it or starting it again now.

**Do not claim READY while DUPE feedback is absent, accepted keystrokes are lost, a failed log looks successful, required content is inaccessible at supported sizes, or an export is wrong.** Recorded voice and physical-radio acceptance must be reported separately and cannot be inferred from macro rendering.

### Reconciliation report intake

Expected report: `docs/contesting/CQ_WW_SSB_RECONCILIATION_2026-10-23.md`.

At publication, the report had not yet appeared at the announced main-branch path (repeated reads returned 404). It has **not been reviewed** and no claims from it are treated as verified. This plan is grounded in the pinned code, screenshot and attached manual. A follow-up reconciliation section should identify the report commit/blob and only change findings for which it supplies newer evidence; do not silently rewrite the original review baseline.

On resumption, first read that report and current HEAD. Preserve all newer work. For each finding below, record: still present, fixed with a cited commit and evidence, or not reproduced with a stated reason. Do not rerun already accepted unrelated work just because this document is newer. If the report describes a different installed source, explicitly reconcile source commit, packaged commit and installed commit.

### Permission and scope boundaries

This document authorizes software implementation within the existing project scope, not new live RF/PTT tests, rotor movement, production restore, real-provider writes or synthetic contacts in Oliver's real contest/normal log. Use disposable sessions and intercepted transports. Do not delete the four screenshot contacts, change real exchanges, reset all layouts, replace saved radio configurations or auto-enable voice/network output. An operator-controlled hardware check remains a separate step.

## 1. Evidence and what was actually reviewed

The review used the user-supplied desktop screenshot, selected full-text and rendered pages of the attached 823-page indexed N1MM manual, current repository code, and current official CQ WW rules. Source references below are pinned to the reviewed commit; symbol names are more durable than line numbers when rebasing.

This was **not** a full application build, a full test-suite run, an installed macOS session, or hardware verification. Two small independent artifacts were prepared: an isolated reproduction of the matrix helper and a deterministic expected-score fixture. They are not represented as full xLog test results.

### Evidence-based findings

| ID | Priority | Status at reviewed source | Finding and narrow remedy |
|---|---|---|---|
| CQ-01 | P0 | Confirmed source + screenshot | Python computes duplicate state and the shared Entry projection carries it, but detached `Entry` never renders it. Connect that state to a prominent, persistent DUPE strip and semantic call styling. Do not invent another duplicate database. |
| CQ-02 | P0 | Confirmed presentation gap; exercise actions | Main Logging has keyboard log/clear routes but no visible compact Log/Wipe/Stop row. Errors are generally routed to Messages. Add visible local validation, failed/uncertain-save feedback and existing action buttons. Do not make manual SSB logging depend on voice availability. |
| CQ-03 | P1 | Confirmed source + screenshot | Check Partial forces Call History into a full-width second row at its wide breakpoint and has nested vertical overflow. An empty pane consumes usable candidate height. Use proportional optional source panes; let the candidate pane use the actual available height. |
| CQ-04 | P1 | Confirmed source + isolated helper probe | `multiplierMatrix` hardcodes six HF bands and cannot receive the configured display set. Apply the selected contest/display scope consistently; never filter stored/exported contacts as a side effect. |
| CQ-05 | P1 | Confirmed source + isolated helper probe | Matrix current-country matching compares country text such as `SLOVAK REPUBLIC` with row labels such as `OM`. Use a stable country key/prefix consistently. |
| CQ-06 | P1 | Confirmed implementation + screenshot | Zone/DXCC matrices currently contain only worked rows, with no explicit view selector. CQ WW needs a useful view of all 40 CQ zones and needed/worked status. Add explicit scope/view choices and responsive repeated table blocks. |
| CQ-07 | P1 | Confirmed source; installed geometry required | Fixed/minimum heights, `width:max-content`, several `overflow:hidden` ancestors and independent native constraints can make resizing ineffective. Fix the layout chain and native minimums together; do not shrink fonts or hide overflow to pass a screenshot. |
| CQ-08 | P0 verification, small fix if reproduced | Confirmed behavior difference from N1MM | CQ WW Space currently follows ordinary tab progression, whereas the manual's CQ WW workflow uses Space as smart tab to the zone. Make the chosen N1MM-compatible CQ WW behavior explicit and test it; preserve normal Tab access to both reports. |
| CQ-09 | P1 | Confirmed UI state distinction | In SSB, unavailable function keys are disabled and their unavailable reason is suppressed in Entry. Show concise setup guidance and preserve direct logging. Disabled does not mean verified or ready. |
| CQ-10 | P1 | Confirmed source + screenshot mismatch | Callsign Details shows only provider fields and can display blank CQ/ITU zones while Entry has resolved CTY zones. Present the current effective CTY context as a labeled fallback; do not overwrite the received exchange or confuse home-call data with portable operation. |
| CQ-11 | P1 verification | Screenshot observation, not proven malfunction | Band Map is pinned to 40 m while Entry shows 20 m. Make Follow active radio versus Pinned band explicit. Do not assume a deliberately pinned map is a tuning defect. |
| CQ-12 | P1 verification | Not independently reproduced | Exercise rapid typing, Run/S&P clicks, delayed replies, band changes, duplicate recalculation and Enter together. Preserve current local input buffering and receipt ownership rather than replacing them. |

**Do not invent a scoring failure from the screenshot.** Its shown four contacts have 4 points and six band multipliers, giving 24. Domestic zero-point QSOs can still provide country/zone multipliers. The important failure shown is that re-entered OM0A on the same band has no DUPE indication.

### Source map

Base: `https://github.com/oliverbross/OM0RX-xLog/blob/cb708501d781dafc5517e51c6a8c6b341ec2fa55/`

- `python/contest_host/host.py`, approximately 810–1005: `is_dupe`, `projection`, `dupe`, `dupeExplanation`, `callContext`, and original plugin scoring.
- `prototype/src/contesting/Not1MMContestWorkspace.tsx`, approximately 1785–1945: `surfaceProjections`, Entry duplicate/validation data, plugin fields and spot projections; 1940–2010: Messages, matrices and tracker context; 560–580: `multiplierMatrix`.
- `prototype/src/contesting/DetachedContestSurface.tsx`, approximately 382–430: `useEntryIntents`; 430–595: keyboard and focus handling; 602–684: Entry rendering; 685–720: Check; 733–757: Matrix; 800 onwards: log rendering/editing.
- `prototype/src/contesting/DetachedContestSurface.css`, approximately 125–220: Entry sizing, Check grid/scrolling, Stats/Rates and log panes; 80–125: matrix geometry; 245 onwards: overflow overrides.
- `prototype/src/contesting/ContestPresentation.tsx`: `ContestCandidates`, whose partial-call labels become individual span children without a whole-callsign wrapper.
- `prototype/src/contesting/DetachedContestQRZDetailsSurface.tsx`: field fallback and auto-fit behavior.
- `python/vendor/not1mm/upstream/not1mm/plugins/cq_ww_ssb.py`: dupe type 2; RS/zone exchange; `next_field`, tab maps, point and multiplier logic.
- Existing native surface protocol/registry/state files: trace them from `contestSurfaceNative.ts` and the invoked commands. Adjust only the real size limits and affected projection fields. Do not create another window registry or generic layout engine.

## 2. Reference contract: what to copy and what is an xLog improvement

Use these manual sections, not an open-ended audit of all 823 pages:

| Printed pages | Required behavior used here |
|---|---|
| 53–55 | Visible `Dupe!` beside Entry; semantic call colors; Space as smart tab to exchange; Tab reaches reports; valid completed contact logging and clear validation. |
| 57–58 | Representative Run and S&P operating trials, not merely unit-test counts. |
| 67–69, 285–287 | Check sources, exact/partial matches, highlighted differing characters, optional panes; two-pane log and resizing. |
| 295–298 | Focus visibility, optional Entry rows, band display options, action row and function-key behavior. |
| 342–346 | Two-pane log, resizing/dividers, editing and column management. |
| 349–353 | Country/zone multipliers, needed/worked visibility, CQ WW's 40 CQ zones, space-efficient multi-column rearrangement. |
| 140–143 and the relevant single-operator/ESM section | Verify the specific keyboard shortcuts actually chosen for the CQ WW SSB desk. Do not replace all xLog shortcuts wholesale. |

Important distinctions:

1. N1MM's lower Check pane is **Reverse Call History**, not a mandatory empty full-width ordinary Call History pane. Ordinary Log/Master/Telnet/Call History are upper source panes and can be hidden.
2. N1MM documents configurable band display; page 297 says selecting a single-band category does not itself hide other band buttons. Oliver's requested automatic configured-band presentation is an **intentional xLog improvement**, not a claim about N1MM's exact default.
3. N1MM supports rearranging multiplier blocks when the window height changes. Reuse that visual idea; retain xLog theme and accessible text rather than copying its Windows chrome or shrinking cells until unreadable.
4. N1MM's semantic colors are configurable. Use xLog tokens for duplicate/workable/new country/new zone, and always pair important states with text or symbols.
5. Duplicate QSOs must remain loggable and retained. The official CQ WW FAQ says to log all contacts, including dupes. A duplicate warning is not permission to discard a real QSO or to count it twice for score.
6. New geometry preferences must not change scoring or Cabrillo contents. The official rules require single-band entrants to submit all contacts; only their category band is scored.

References: attached `N1MMPlus.pdf` (printed 2026-10-03); `https://www.cqww.com/rules/`; `https://www.cqww.com/rules/faq.htm`; `https://cqww.com/blog/2026-rule-changes/` (checked 23 October 2026). Current rule deadline for SSB submission is 27 October 2026 at 23:59 UTC. Keep frequency changes, calls and QSO commits operator-initiated; do not add autonomous operating behavior.

## 3. Batch A — close the operator-critical paths

### A1 / CQ-01: live duplicate and worked-status feedback

**Reuse:** host `projection.dupe`, its reason, and the already published Entry `draft.dupe`. The original CQ WW SSB plugin already checks once per band and returns zero points for a duplicate.

Implement:

- Reserve a compact, high-contrast line immediately beside or directly beneath the callsign/exchange row: **`DUPE — OM0A already worked on 20 m`**. Keep it visible without scrolling. Include prior UTC/band information when available from the current contest log; lack of that optional detail must not suppress the warning.
- A duplicate call must not remain visually identical to a new double multiplier. Use the existing duplicate color/token, an obvious border/badge and readable text. No flashing, no modal on every keystroke, no color-only warning.
- Distinguish blank/incomplete input, checking, clear, duplicate, and unavailable check. A delayed result for the previous call, session, band or mode must never label the new entry clear or duplicate.
- Tie classification to the authoritative normalized call, contest/session, band/mode, relevant log revision and current draft identity. Use existing identity/revision fields where sufficient; add only the minimum missing presentation context. While locally typed input is ahead of the checked projection, show Checking rather than the preceding result.
- Re-evaluate on call change, spot/candidate selection, band change, contact commit/correction/deletion and session reopen. The same call on a different contest band is not a CQ WW duplicate.
- Use contest-local history, not general DXCC awards or an old contact in the ordinary logbook. Partial/fuzzy SCP matches are suggestions, not exact duplicates.
- Preserve exact portable-call semantics used by the plugin; do not casually strip slash suffixes to create false duplicates.
- Keep manual logging of a genuine repeated contact possible, with zero added duplicate points/multipliers and an identifiable duplicate row. Do not require destructive cleanup of dupes.
- Show known candidate multiplier state only from the existing contest evaluator. If no authoritative candidate evaluation exists for a typed call, prioritize correct DUPE feedback now; never fake green/new-mult from a generic country lookup.

**Acceptance:** log OM0A on 20 m; clear; retype OM0A; see DUPE before logging. Change to another permitted band and see the status update. Change to an unworked call during a delayed duplicate reply and never see an old result attached to the new call. Correct/delete the original contact and observe a refreshed result. Confirm actual repeated contacts remain in Cabrillo and do not increase score.

### A2 / CQ-02: direct logging, visible errors, and output separation

Add a compact action row using existing handlers: **Stop/Esc, Wipe, Log It, Edit last**. Optional Mark/Spot actions can remain in existing shortcuts/context menus. Do not introduce a duplicate command implementation.

- `Log It` and manual Enter logging remain available with no recorded WAV profile. A voice configuration problem must not prevent the user logging a QSO he spoke manually.
- Flush buffered call/exchange edits before action admission. Preserve the current queue, operation identity and ambiguous-outcome handling. A delayed response is not a reason to send a second commit with a fresh identity.
- On confirmed commit, show one unobtrusive saved indication, update the log/score/matrices, reset the next draft appropriately and return focus to Callsign. Never report saved from a mere request acknowledgement.
- On invalid exchange, put a concise error beside Entry and retain the text. For example: `CQ zone must be 1–40 — contact not logged`. Do not force the operator to discover an error in a hidden Messages window.
- If outcome is uncertain, state that it may already be logged and use the existing reconciliation path. Do not clear the draft, blindly retry or tell the operator to log it again.
- Other messages can still be mirrored to Messages. Do not replace the underlying error journal with UI toasts.
- Run/S&P changes via click and keyboard must preserve the same current buffered fields. Exercise the existing click path specifically; do not assume keyboard tests establish click behavior.
- Esc must retain the existing output-stop/release behavior. Do not turn Esc into a destructive wipe. Wipe is explicit and separately labeled.
- Keep the macros visible only when useful; unavailable buttons need a concise explanation and link to their existing setup. Never remove all phone-output guidance while leaving twelve unexplained dim buttons.

### A3 / CQ-08: CQ WW SSB keyboard behavior

Define one mode of operation explicitly: manual logging versus ESM, with its current setting visible in existing setup/Entry UI. Do not change the user's ESM preference silently.

For the N1MM-compatible CQ WW SSB entry workflow:

- Callsign → **Space** selects the received CQ-zone value for replacement, skipping normal 59 reports. The plugin already names `other_2` as `next_field`; adapt this CQ WW presentation path narrowly rather than altering every contest's tab map.
- **Tab/Shift+Tab** still visit sent report, received report and zone in order, so a genuine 57 report can be entered.
- **Enter with manual logging** logs a valid completed QSO once. With ESM enabled, the next action must be predictable and output readiness must be explicit. No simulation claim may stand in for actual phone output.
- New draft focus returns to Callsign. An asynchronous lookup must not steal focus from a report/zone or replace a manually entered exchange.
- Candidate/spot selection returns focus appropriately to Entry without submitting a contact. Preserve typed input when a spot operation fails.
- Document the supported Mac shortcuts and conflicts; do not globally trap application quit/close or text editing shortcuts. Preserve the existing F-key mechanism rather than inventing a keyboard service.

**Focused checks:** rapid callsign typing then immediate Space/zone/Enter; both Run and S&P; a non-default RS report; invalid zones 0/41; delayed host replies; entry still usable with SCP or QRZ unavailable. No RF required.

## 4. Batch B — make each window usable at the operator's chosen size

### Shared sizing contract

Inspect the whole chain: native window minimum → webview root → outer main/section → grid/flex track → list/table. A resizable native frame with a fixed inner layout is not accepted.

- Use `min-width:0` / `min-height:0` deliberately at flex/grid boundaries and `minmax(0,1fr)` where content must shrink. Remove the Check grid's unconditional 220 px inner minimum where it defeats a smaller supported window.
- Give each list/table one intentional scrolling viewport. Do not place a second independent scrollbar around the same content.
- Do not ban scrollbars universally. A long list needs scrolling. The defect is a short list scrolling while an empty fixed pane consumes half the available area, or content being clipped with no way to reach it.
- Outer chrome/headings stay compact; active content grows. Use xLog typography at a readable size. Do not solve layout by global browser zoom, 7 px text or blanket `overflow:hidden`.
- Measure CSS viewport dimensions separately from macOS logical/physical pixels. Test 1×/2× display scaling with the actual Tauri window.
- Preserve user resize/position choices across restart. Clamp off-screen placement to an available display without resetting unrelated windows. Auto-fit may offer a default or explicit command; it must not continually undo a user's drag.
- Test expanded and compact sizes against real window minimums. Suggested content-area targets below are acceptance probes, not immutable pixel specifications. If essential controls cannot fit, use a justified native minimum or compact presentation, not invisible controls.

### B1. Main Logging

**Compact probe:** about 500×260 CSS pixels; **expanded:** about 800×360. Check the actual screenshot-sized window as well.

- Callsign receives more width than the two short report fields. Use compact report widths and a modest CQ-zone width; do not distribute all four fields equally.
- Add DUPE/validation/action rows from Batch A without pushing them below an inaccessible boundary.
- Header: readable frequency and units, mode, selected radio identity, contest and operator. Add UTC clock only through an existing lightweight clock path; it must not cause entry state churn.
- Keep Run/S&P and ESM/output state legible. Distinguish the active operating radio from whichever settings tab is open.
- Footer: country and effective zones, optional known bearing/distance, current QSOs/multipliers/score. Never display a fabricated heading; blank/unknown is preferable to confusing target and observed rotor direction.
- Optional macro bank can be collapsed by the operator. With macros shown, labels remain readable and disabled-state help is available. Do not hide basic log controls with the macros.
- Large height need not stretch fields into huge controls, but should not produce an unexplained empty region while essential actions are missing.

### B2. Check Partial / SCP

**Compact probe:** about 440×200; **expanded:** about 800×360, plus the supplied screenshot geometry.

- Source panes are Log, Master/SCP, Telnet, and Call History. Put enabled ordinary sources side by side when width permits. Offer the existing-style context menu or small view menu to hide/show sources and adjust proportions.
- Do not reserve a full-height second row for empty/unloaded Call History. If no history is loaded, use a compact status or hide it by default while making it discoverable. If preserving a loaded pane's width is useful, allow the operator to choose it.
- Reverse History, if already implemented and enabled, is a separate optional region; do not imply ordinary Call History is reverse lookup.
- Allow the Master pane to occupy available height. At narrow widths use a compact source selector or an intentional responsive arrangement; do not trap it in a small fixed top row.
- Keep pane headings visible; scroll candidate content only. Place corpus status/download/refresh in a compact toolbar or disclosure, not a large permanent setup area.
- Wrap each candidate's complete callsign in one inline element containing its difference spans. Preserve exact spelling and remove the visually spaced `O M 0 R X` effect. Use bold/italic for exact matches, contrasting spans for changes/additions, and accessible whole-call text.
- Exact match first; deterministic near-match ordering. Preserve the existing search backend and result limits. Do not run a new global fuzzy-search indexing project.
- Show duplicate/worked status only when tied to this contest and band; a log partial match alone is not proof of dupe.
- Selecting a suggestion populates the current draft through the existing owner. It does not transmit or log. An old query reply cannot replace newer suggestions or input.
- Corpus missing/error state is nonblocking for manual entry. Download only on the existing explicit update action; do not introduce silent network fetches each keystroke.

### B3. DXCC / country multipliers

**Compact probe:** about 340×220; **expanded:** about 720×420. A single-band view may be narrower if readable.

Use three separate concepts: (a) bands allowed by the contest, (b) entry/category band, and (c) operator's display subset. Reuse current configuration. Do not infer single-band entry just because the radio is on 20 m.

- Default the displayed columns to the applicable saved contest/display bands. Offer `Configured`, `Current band`, and `All contest bands` where useful. Changes here are display preferences, not edits to Cabrillo category or the database.
- Fix `multiplierMatrix` to accept this band set and consistent band definitions. No fixed six-band constant inside a general matrix renderer.
- Identify countries with a stable key/primary prefix and carry a separate display name. Fix current-country highlighting accordingly; compare OM with OM, not with SLOVAK REPUBLIC.
- Provide explicit All / Needed / Worked filtering rather than quietly presenting only worked entities. Use the existing loaded contest country/reference set; no new country-data downloader or invented entity list.
- At wider sizes, pack repeated blocks of country label + displayed band cells + optional total. Read down a block then continue to the next, with repeated band headers. Reflow based on usable height/width, never split one country's row across blocks.
- Use available width without enlarging every cell to absurd size. Provide sensible gutters and enough country-label width. At a truly small size, one scroll region is acceptable rather than clipped columns.
- Distinguish QSO counts from multiplier counts. Label unique countries versus country-band multipliers and keep totals consistent with the score scope.
- No forced scroll-to-center on every background projection. Follow the typed country only when its identity changes or the operator enables follow; do not steal the user's scroll position during manual inspection.

### B4. CQ Zones

**Compact probe:** about 300×220; **expanded:** about 620×380.

- For CQ WW, default to the **40 CQ zones**, with clear needed/worked cells for the displayed bands. Do not make an empty contest look like there are no possible zones.
- Remove the misleading active CQ/ITU radio choice from the CQ WW scoring matrix. The current switch changes only which numeric row is targeted; it does not transform CQ counts into ITU counts. ITU information belongs in labeled Callsign Details, or in an actual ITU-scoring contest's own matrix.
- Respect the same displayed-band scope as DXCC, with independently persisted view size/filter only where useful.
- Pack the 40 rows into repeated blocks when space permits, as the manual illustrates. For a small single-band window a compact grid of numbered zone tiles can be an optional presentation, but retain a clear band label and accessible worked state.
- Use no horizontal clipping, squeezed final column or huge empty lower area. Needed/worked/all is explicit and persistent; new/empty sessions remain informative.
- Highlight the current **received zone** as the contact's exchange when it differs from CTY's suggestion. Show the suggested zone separately; never overwrite an operator-entered exchange merely to match CTY.

### B5. Log Display

**Compact probe:** about 680×250; **expanded:** about 1000×480.

- Preserve chronological log and current-call partial matches. Make their divider adjustable, or supply a compact proportion control using the existing preferences. Empty matches should not consume an arbitrary large minimum.
- Keep column headers and units readable. Display time in UTC, frequency in explicit kHz/MHz, short labels such as Zone mult / CQ zone / Country mult / Country / Pts with full tooltip names where necessary.
- Preserve column resizing and values; do not reintroduce lossy editor reconstruction. Double-click and full Edit Contact must operate on authoritative raw fields from both panes.
- Ensure all records in the current page remain reachable: do not leave a non-scrolling table clipped by `overflow:hidden`. Use existing paging/virtualization; do not create a new global table implementation.
- Newly logged contact becomes visible without discarding an intentionally inspected older page. Use a small “new contacts” indicator when appropriate, rather than resetting selection/scroll continually.
- Existing duplicate-row badge remains, but it is not a substitute for pre-log DUPE in Entry. Retain actual repeated contacts and accurate zero scoring.
- Correction/deletion updates duplicate state, per-band multipliers, statistics and export together. Retain audit/history and idempotent receipt safeguards.

### B6. Statistics / claimed score

**Compact probe:** about 300×170; **expanded:** about 520×300.

- Use operator-facing band labels such as `20 m`, not the internal band value `14.0` without explanation.
- Keep QSO, Pts, Zones and Countries aligned. Totals and claimed score remain visible without unnecessary header duplication.
- State the score scope: all-band or the selected single-band category. A display filter does not silently change the official category score.
- Counts must come from the existing authoritative score/statistics path. Never calculate a second independent client-side score to make the screen look right.
- For empty rows, decide consistently whether to show configured bands with zeros or collapse them; the choice must not conceal a band with contacts.

### B7. Rates

**Compact probe:** about 300×200; **expanded:** about 460×300.

- Keep labels left/value right or aligned columns without a fixed value width forcing the label out of the window.
- Distinguish a legitimate zero from unavailable/insufficient sample. Explain last 10/100 rate denominators; retain the intended original calculation.
- Label current hour in UTC and preserve Run/S&P counters. Exercise a controlled clock so an idle or pre-contest screenshot is not mistakenly “fixed” by fabricating activity.
- Rates must age when time passes, not only on QSO entry. Reuse a bounded visible-window tick if needed; no global 100 ms polling, full database reread per keypress or update loop after the window closes.

### B8. Band Map

**Compact probe:** about 250×400; **expanded:** about 400×700.

- Show `Follow active radio` or `Pinned: 40 m` prominently enough to explain the screenshot's 40 m map versus 20 m Entry. The default for a new CQ WW session can be Follow; preserve an explicit saved pinned selection.
- Changing the viewed band is not permission to tune the transmitter. Spot selection/tuning remains an explicit operator action through the existing station owner.
- Reuse the implemented click-to-load/tune and Confirm/Mark/Delete context menu. Do not recode those simply because the layout changed.
- Frequency scale and spot labels grow with height, maintain readable spacing, use actual zoom/scroll and retain selection. Needed/worked colors come from this contest and band, not lifetime normal-log status.
- If no spots are shown, state the cause when knowable: no spots on pinned band, mode filter, marked-only filter, age, or disconnected feed. Do not call an intentionally filtered view a failure.
- Preserve available band-plan context. Region-specific transmit restrictions depend on the physical station, not the operator's laptop timezone. Do not newly widen radio capability/authorization because the view displays a frequency.

### B9. Cluster / available contacts

**Compact probe:** about 650×260; **expanded:** about 1000×500.

- Keep connection status and compact filter controls; let rows occupy remaining height, with one list scroll region and useful resizable columns.
- The screenshot has only eleven rows: blank space below a short list is not itself a defect. Fix constraints that would prevent a long list from filling that space; do not pad with invented rows.
- Use contest-scoped duplicate/multiplier/point previews; distinguish unknown/unresolved from already worked. Maintain one shared cluster connection, not one per window.
- Incoming spots must not steal keyboard focus, reset a selected row or move the operator's view unexpectedly. Preserve current selected-spot identity across a safe refresh.
- Keep comments/spotter/age readable, all-band/current-band selection clear, and time-filter effects understandable.
- Explicit Post Spot must use the existing owner; no automatic self-spotting or public posting from synthetic tests.

### B10. Callsign Details

**Compact probe:** about 300×280; **expanded:** about 500×400.

- Merge presentation, not authority: show provider profile data with source labels and use already resolved CTY CQ/ITU context as a labeled fallback when that provider omits zones.
- If numeric strings are supported in the native response, normalize them at the existing boundary; the current component accepts only numeric zone values. Verify the actual response before blaming the service.
- Do not modify the logged/received zone or replace a portable operation's location with the QRZ home address. Show conflicts clearly when material.
- Honor user resizing. Auto-fit must stop adjusting once the operator sets a size. Use a single details scroll region only when the content genuinely exceeds the window.
- Bearing/distance may reuse an existing location calculation with explicit station and destination provenance; they are not a reason to build another geospatial service before the contest.

### B11. Rotator

**Compact probe:** about 280×260; **expanded:** about 420×380.

- Label current observed heading separately from requested/short-path/long-path target. A number in the dial is not proof of movement or automatic mode.
- Scale the compass to the available content area. Keep Stop and existing manual controls reachable at the supported minimum.
- If automatic rotor control is unavailable, show one compact explanation and an existing configure/retry route. Do not fill the window with redundant warnings or pretend the feature works. Retain important failed/uncertain movement warnings.
- No real rotor commands in acceptance without separate authorization. A missing optional rotor feature must not block manual QSO entry or become this release's new project.

### B12. Remote VFO, Setup, Messages and score reporting

These were not all visible in the supplied screenshot. Do not claim a visual inspection that was not performed.

- Remote VFO identifies its radio and observed frequency; existing typed/fenced stepping remains unchanged except a demonstrated blocker.
- Setup preserves real station call, CQ zone, category, start UTC, current radio, saved audio and data sources. Surface incompatible choices, but do not reset them silently.
- Messages supplements immediate local feedback; it is not the only place a rejected Log action is reported.
- Existing score reporting can remain optional and honestly labeled; no scoreboard/network expansion is part of this finishing batch.
- Every required window reopens to a real renderer, with saved geometry clamped safely. Do not reintroduce retired Alerts or indiscriminately erase stored layout state.

## 5. Contest logic and data acceptance

### Separate category, display and operating context

Inspect the saved session before changing anything. Do not assume Oliver is single-band or all-band from the screenshot. The operator's selected **category** controls the claimed entry; the **display band set** controls visible columns; the **radio/draft band** controls the next QSO and duplicate check. Preserve all actual contacts on allowed contest bands in the export even for a single-band submission.

If the chosen single-band category currently shows an all-band total, make the scope explicit and compute the correct category total through the existing authoritative aggregation path. Do not silently change the category to make a test pass or filter records out of Cabrillo.

### Golden fixture (disposable only)

Station fixture: `OM0RX`, country `OM`, continent `EU`, CQ zone `15`. All remote call/country/zone tuples below are **explicit deterministic test data**, not claims about live callbook records. Use a disposable session with a fixed reference snapshot and timestamps inside the contest period. No packets are published.

| Step | Call | Band | Country/zone/continent | Duplicate? | Added points | Cumulative points | Country-band mults | Zone-band mults | Claimed ALL score |
|---|---|---|---|---|---:|---:|---:|---:|---:|
| 1 | OM0A | 20 m | OM / 15 / EU | No | 0 | 0 | 1 | 1 | 0 |
| 2 | DL3AG | 20 m | DL / 14 / EU | No | 1 | 1 | 2 | 2 | 4 |
| 3 | VK2AAA | 20 m | VK / 30 / OC | No | 3 | 4 | 3 | 3 | 24 |
| 4 | OM1AA | 20 m | OM / 15 / EU | No | 0 | 4 | 3 | 3 | 24 |
| 5 | DL3AG | 20 m | DL / 14 / EU | Yes | 0 | 4 | 3 | 3 | 24 |
| 6 | DL3AG | 40 m | DL / 14 / EU | No | 1 | 5 | 4 | 4 | 40 |
| 7 | DL2ABC | 20 m | DL / 14 / EU | No | 1 | 6 | 4 | 4 | 48 |
| 8 | K1ABC | 20 m | K / 5 / NA | No | 3 | 9 | 5 | 5 | 90 |

Final: 8 stored contacts, 7 distinct call/band pairs, 1 duplicate, 9 points, 10 multiplier instances, score 90. Label total stored QSOs versus scoring/unique contacts consistently rather than silently dropping the duplicate from the log. With category 20M, the same eight contacts remain exported, with category points 8, countries 4, zones 4 and claimed score 64. This expected-value calculation is independently prepared; it is not a report that current xLog passed it.

After the fixture, exercise correction of a zone and a band, deletion of the first occurrence of a multiplier, duplicate promotion/recalculation where applicable, restart and export. Compute expected deltas from the fixed data; verify the original plugin and current host rather than installing a second scoring implementation.

### Export and recovery

- Save an actual Cabrillo file via the installed application's native Save panel. Inspect `CONTEST: CQ-WW-SSB`, correct station/operator/category, UTC, actual frequency, `PH` mode, sent and received RS/zone, record count, and retained duplicate/off-category contacts as applicable.
- Save an ADIF copy and verify intended values without using ADIF as a substitute for Cabrillo acceptance.
- Restart the app, reopen the same disposable session and confirm contacts/score and resized window geometry. Do not auto-rearm output on recovery.
- Preserve a recoverable prior application bundle and verified normal/contest backups before an operator-authorized replacement. Do not perform production restore to prove the UI.
- Record installed source receipt, application version, source dirty/clean status and packaging result. A reused version string is not enough.

## 6. Implementation sequence and ownership — prevent another loop

Follow `AGENTS.md` and `docs/DEVELOPMENT_WORKFLOW.md`. Fetch current main with fast-forward-only semantics, preserve uncommitted/unrelated work, commit logically and push completed work. Do not package from another worktree.

### Checkpoint 0: one baseline reconciliation

Read Codex's report, current HEAD and the installed source receipt once. Mark prior accepted behaviors to preserve. Identify the current category/radio/output configuration without changing it. Translate this plan into the existing issue/acceptance checklist; do not create a new planning framework.

### Checkpoint 1: operator-critical batch

Implement A1–A3 and any demonstrated correctness blocker from the controlled fixture. One owner handles Entry and its shared projection to avoid overlapping edits. Use focused host/UI boundary checks for duplicate timing, failed logs, Space/Tab/Enter and output-independent manual SSB logging. Push the logical changes; do not sign/install for each small patch.

### Checkpoint 2: responsive desk batch

Implement B1–B11 using existing components, with B12 as a check of already implemented routes. A second worker may handle layout/matrix work only when file ownership is non-overlapping. Both Entry and matrices live in large shared files: coordinate those edits explicitly. At most one independent final review of the combined batch, with a recheck restricted to genuine findings it identifies.

### Checkpoint 3: one integrated candidate

Run affected tests/typecheck/native checks once the batch is coherent, complete the relevant macOS release gate against the exact source, and build/sign one candidate. Reuse unaffected acceptance evidence with its original commit clearly marked. Cross-platform work that is already deferred must not become a new deadline-blocking project, but never represent a failed relevant macOS job as passed.

If a check fails, diagnose its actual cause and rerun the affected checks; broaden only when the change invalidates broader evidence. Do not cycle independent reviewers on unchanged code, repeatedly audit the full manual, add label/source-string assertions instead of behavior tests, or rebuild for every minor heading adjustment.

### Checkpoint 4: installed operation and decision

Complete the finite checklist below through the real installed Tauri windows. If a blocker appears, fix that blocker, recheck the affected journey and its direct dependants, and produce a replacement only when necessary. Do not re-enter the entire parity project.

Deliver exactly one final status: **READY**, **READY WITH SPECIFIC OPERATOR-ACCEPTED LIMITATIONS**, or **NOT READY**. Missing prominent duplicate status or wrong saved/exported data is NOT READY. Untested physical voice/RF output cannot be called ready; state precisely what software-only/manual-microphone operation was verified and let Oliver accept that boundary. Then stop implementation until the next instruction.

## 7. Finite acceptance checklist

Record pass/fail and evidence per item, not just test counts. All synthetic work is in the disposable session.

- [ ] AC-01: Existing station and normal-log data were preserved; no unwanted output/network activation.
- [ ] AC-02: Main Logging shows an obvious live DUPE for OM0A on its already worked band, with no stale warning attached to another call/band/session.
- [ ] AC-03: Valid rapid Run and S&P keyboard entry logs once, retains corrected RS/zone and returns focus. Space, Tab and Enter match the documented chosen behavior.
- [ ] AC-04: Invalid and uncertain commits retain the entry and produce clear local feedback. Manual SSB logging works without a voice profile.
- [ ] AC-05: Check Partial uses the available height, optional empty panes do not reserve half the window, candidate calls read as whole calls, and a selected suggestion reaches the intended draft.
- [ ] AC-06: DXCC/CQ-zone matrices honor displayed bands, show meaningful needed/worked views, reflow into blocks and have correct entity/zone highlighting. Changing a view does not change stored QSOs or export scope.
- [ ] AC-07: Each visible screenshot window works at compact and expanded probes without clipped controls, nested duplicate scrollbars, unreadable font reduction or resizing that immediately springs back.
- [ ] AC-08: Log Display keeps current/new/older contacts reachable; editing from either pane preserves unrelated values and recalculates dependent views.
- [ ] AC-09: Band Map clearly identifies Follow or Pinned mode. Spot click/candidate selection uses the current session/radio; no actual tuning occurs in automated tests.
- [ ] AC-10: Golden fixture matches points, duplicate behavior and per-band multipliers; single-band category/export scope is correct when that category is tested.
- [ ] AC-11: Actual Cabrillo/ADIF files were saved and inspected, including duplicates and other-band QSOs where applicable.
- [ ] AC-12: Restart preserves contacts, score and operator-chosen window positions/sizes; no lost/ghost/retired panel and no automatic output rearming.
- [ ] AC-13: Exact source and installed candidate identity agree. Relevant integration gates are complete; skipped/failed checks are stated accurately.
- [ ] AC-14: Recorded voice status separately identifies macro rendering, WAV resolution, device routing, playback, PTT/release and physical RF. No synthetic “passed” label for unperformed layers.

### Minimal evidence to retain

1. Exact source/application identity and baseline report reference.
2. A short capture or ordered screenshots of retyping an already logged call and changing band, plus an invalid-zone attempt.
3. Compact and expanded screenshots for Main Logging, Check, DXCC, CQ Zones and Log; one desktop view covering the rest.
4. The controlled fixture's expected/actual score table and generated Cabrillo file.
5. Restart/geometry result, normal-log protection evidence and rollback path.

Keep evidence in the existing acceptance location. No new dashboard, recorder framework or massive test corpus is required.

## 8. Post-contest backlog — retain scope, do not start now

Full 94-plugin acceptance, optional advanced multi-op/remote operation, broader N1MM macro grammar, new audio-stream transports, exhaustive rule certification, extensive settings redesign, new layout engines and unrequested all-platform installers remain separate. Preserve their existing tasks and honest status. They are not prerequisites for fixing the demonstrated Entry/SCP/matrix problems unless the selected actual operating configuration specifically needs one.

Do not use “deadline” as a reason to fake output readiness or lose data; do use it as a reason to finish the finite requested workflow instead of expanding scope.

## 9. Final Codex report format

- **Verdict:** READY / READY WITH SPECIFIC OPERATOR-ACCEPTED LIMITATIONS / NOT READY.
- **Source and binary:** commit, version, installed receipt, signing/notarization status as actually checked.
- **Closed findings:** CQ IDs with implementing commits and focused evidence.
- **Installed acceptance:** AC IDs, actual outcomes, screenshots/export locations.
- **Remaining limits:** exact unavailable behavior, operator-controlled checks and whether it blocks Oliver's intended setup.
- **Rollback:** previous bundle and backup locations.
- **Stopped scope:** list retained post-contest tasks; no further automatic compatibility batch.

The next deliverable is the corrected operating application and its evidence, not another open-ended analysis report.
