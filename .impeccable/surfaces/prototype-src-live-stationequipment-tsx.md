# Station equipment — Operator Desk / Settings

Operate mode. Ordinary extension of the established xLog console, not a new visual identity.

## Direction contract

THESIS: Equipment earns its dashboard space. An unconfigured rotor disappears; a fixed-antenna station may show its saved antenna instead. No simulated operational state.

OWN-WORLD: Inherit the navy panels, system typography, cyan measurement accent, existing compact controls and spacing in DESIGN.md. Antenna drawings are small geometric schematics, not decorative product illustrations.

STORY: The operator chooses equipment in Station settings and explicitly saves. The desk then shows either rotor controls, the described fixed antenna, or no equipment track. An owned rotor always retains Stop until disconnected.

FIRST VIEWPORT: Equipment stays alongside Active QSO and intelligence. The antenna schematic and name share one compact row, with configured bands beneath. With no equipment, the other panels claim the released width. Long names wrap and bands remain visible at laptop widths.

FORM: Narrow code-led extension, directly specified by the user; no concept seed applies. No new motion or hardware side effects.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Finished extension evidence — 2026-10-12

Review verdict: **ship within source/fixture scope**, with no material findings. `StationEquipment.tsx`, `StationEquipment.css` and `equipmentPreferences.ts` preserve the incumbent navy console, cyan/secondary colour roles, system typography, compact fields and panel structure. The extension adds no global token or design-system change. Saved antenna identity and bands remain explicitly “Configured · no telemetry”; an owned rotor retains its controls regardless of display preference, and an unconfigured station releases the equipment grid track. Settings changes require the existing explicit Save action.

Visually checked synthetic captures in `.impeccable/review/`: `equipment-desktop.png` (1920×1080), `equipment-laptop.png` (1000×720), `equipment-none.png` (1920×1080) and `equipment-settings.png` (1000×1008). These show the fixed antenna, wrapped laptop band labels, released equipment space and Station settings. They are browser layout fixtures with synthetic data and no hardware connection. The parent validation run reports 307 frontend tests, TypeScript checking and 67 Swift core tests passing; the equipment test source covers display selection, retained rotor ownership, reference-only antenna content and explicit saving without hardware requests. No shipping raster assets were added; antenna artwork is inline schematic SVG.

This documentation completes the ordinary extension only. The application was not installed, and packaged persistence/relaunch, high-DPI rendering, assistive-technology operation and physical hardware behaviour remain unverified. Existing documentation drift is recorded without repair: `DESIGN.md` uses legacy headings and has no token frontmatter; `.impeccable/design.json` is absent. `PRODUCT.md`, `DESIGN.md` and global design artifacts are preserved.
