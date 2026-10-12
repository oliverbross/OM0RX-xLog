# CW source UI review — 13 October 2026

Independent fresh-context Impeccable finish reviewer, scoped to the CW extension.
The six screenshots under `.impeccable/review/cw/` are browser component fixtures
with synthetic state and no worker/hardware connection. No installed-app, RF or
alternate-OS acceptance is implied. No visual detector ran for this desktop-shell
stage. New work inherits PRODUCT.md, DESIGN.md and docs/CW_UI_DIRECTION.md.

## Initial review: fix

- Persistence: product/design/contract/surface brief agree. Narrow code-led
  extension does not require a new identity, comp or quality board.
- Fidelity: system type, monospace data, navy ground, compact controls, state text,
  separate preparation/Save/connection/arm, and single-row overflow match.
- Ceiling: reached for the operating console; more decoration is not useful.
- Material finding: editor and desk tooltip incorrectly imposed 80 characters on
  all radios, while station providers support 128. This contradicted the preview.
- Keep: compact row, visible Arm/Stop, no-send preview, keyboard editor and
  retained Stop obligation after uncertain output.

## Fix and verdict

`cwOutputLimit(output, radioProvider)` now governs both previews and the controller.
The active provider is passed from LiveApp through ServiceSettings and CWDesk.
Nine tests verify accepted and rejected 80/81/128/129-character boundaries across
Hamlib, remote agent, direct FLEX and WinKeyer, without I/O. Full frontend suite:
344 tests passed; TypeScript and Vite production build passed.

All six same-view captures were regenerated and opened before review. A temporary
capture of the wrong settings tab following development hot-reload was discarded
and replaced before sending the review packet.

Reviewer verdict: **resolved** for the single preview-limit finding;
**disposition: ship** at verdict-pass scope. All six captures valid; no visual
regression from that fix evident. This is not a new whole-app or hardware pass.

## Open acceptance

Exact installed native-shell behavior, persistence across real app restart,
armed/error-state accessibility, physical keyer/driver operation, supported radio
acceptance, alternate OS packages and app-wide performance remain separate gates.
No additional claims are inferred from these component fixtures.
