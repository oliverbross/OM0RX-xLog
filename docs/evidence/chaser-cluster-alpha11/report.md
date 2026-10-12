# Chaser and full-cluster UI acceptance

Date: 2026-10-13. Scope: local fixture browser checks, not installed app or hardware proof.
Targets: http://127.0.0.1:1420/chaser-preview.html and /cluster-preview.html.
Session: xlog-chaser-cluster-alpha11.

## Summary

One low-severity visual issue found and fixed; no open blocking findings in
this bounded fixture pass. Synthetic data only; no station commands.

## Issues

### ISSUE-001: Chaser action column clips the end of the Load QSO button

Low severity, visual. Repro video: N/A (visible on load).
Open the Chaser fixture at 1440x900. The action column is 88px, which is too
narrow for the button and cell padding. Evidence: `chaser-1440.png`.
Fixed the column to 104px; confirmation screenshots follow.

Column visibility and width edits were checked interactively: hide Comment,
set Callsign width to 180, reload the fixture, reopen Columns. Width remains
180 and Comment stays hidden. `cluster-1440.png` captures the resulting table.
Newest is visibly the same height as adjacent filter buttons.

Confirmation: `chaser-map-1280.png` and `chaser-map-2560.png` show the uncut
Load QSO button, height-adaptive pagination and optional map filling its panel.
`cluster-columns-2560.png` shows the full-column controls at wide size. No browser
JavaScript errors were reported. The deliberately dense synthetic marker line
is fixture data, not real activation locations. Native WebKit, packaged app,
Windows/Linux and RF acceptance are separate gates.
