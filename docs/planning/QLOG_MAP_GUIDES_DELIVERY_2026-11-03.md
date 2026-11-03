# Heard me and band-map guide delivery

EP-12 and EP-16 implementation record, 3 November 2026. This is source/test evidence; it does not claim an installed candidate, live receiver accuracy, radio hardware qualification or cross-platform package acceptance.

## Operator workflow

World Map → **Heard me** enables a passive receiver layer (off initially). Its scope follows the selected radio band, or an explicit band/all-band display filter. It shows the exact station callsign, ten-minute source window, located/unlocated counts and provider status. Diamond receiver labels open report details; only **Frame receivers** changes the viewport. Reception reports cannot identify a physical transmitting radio or antenna. RBN call-info numeric coordinates are deliberately not treated as receiver coordinates because their receiver-specific provenance is unverified; valid four/six/eight-character Maidenhead locators supply labelled locator centres. Missing location stays unlocated.

Map, propagation panel and sidebar reuse the existing RBN endpoint. A process-wide native retained cycle deduplicates concurrent requests across webviews for 120 seconds, including failures. No background fetch task lives independently of visible consumers. Rendered reports expire by source timestamp even during failures. The native request always uses the existing bounded 200-report/hour endpoint window; the map derives a ten-minute, maximum-200-receiver projection. Exact on-air suffixes and receiver identifiers remain distinct. SNR zero remains zero; absent or nonfinite SNR/speed is unknown.

Band Maps → **Guides** keeps **Original appearance** until an operator chooses a published guide. Desk and detached choices, visibility and IBP toggles are independent; shared custom guide data lives in the existing revision/generation-checked workspace preference and backup document. Choose a reference and **Duplicate as custom**, or **New custom guide**. **Edit / rename / markers** opens labelled name/region/band, range/color and personal-marker fields, including Add/Remove controls and an explicit Save/Cancel boundary. Built-in references cannot be edited or deleted. Export produces a `.xlog-guide.json` file. Import parses and previews the name/range/marker counts before **Import as new copy** or deliberate **Replace matching custom ID**. A failed import makes no preference change; a rejected save retains the editor contents.

Each range button inspects label, Hz bounds and source; markers inspect first and offer a separate **Tune selected radio** action through the retained manual-tune owner. A marker with no declared mode retains the selected radio's current observed mode. No spot/callsign or draft write is issued. Existing radio telemetry and Follow Radio remain authoritative.

## JSON and bounds

Version 1 profile keys: `version:1`, `units:"Hz"`, stable `id`, `name`, `region`, `origin:"built-in"|"custom"`, `sourceURL`, `reviewed`, `supportedBands`, `ranges`, `markers`. Ranges contain integer `startHz < endHz`, `color` as `#RRGGBB`, `label`. Markers contain integer `frequencyHz`, `label`, `category` and optional explicitly declared `mode` (`CW`, `USB`, `LSB`, `FM`, `AM`). Source URLs remain plain metadata; import never fetches or executes them.

Limits: 16 custom guides, 128 ranges plus 128 markers per profile, 128 KiB per imported file, 512 KiB aggregate persisted JSON. The aggregate ceiling is deliberately below a naïve 16 × 128 KiB import allowance to keep the existing workspace/backup IPC bounded. Integer frequency admission follows the existing manual-tune boundary of 100 kHz–1 GHz. Labels are bounded and control characters rejected. The additive `bandMapGuidesJSON` backup preference defaults to the legacy appearance when absent. Native validation runs before preference mutation or restore; field-level compare-and-swap rejects stale document writes without copying unrelated settings.

## Published source review

Reviewed 3 November 2026 using official sources:

- [IARU Region 1 index](https://www.iaru-r1.org/on-the-air/band-plans/) links [HF plan effective 16 October 2020](https://www.iaru-r1.org/wp-content/uploads/2021/06/hf_r1_bandplan.pdf), table pages 1–2. The shipped Region 1 profile is **HF only** (160/80/60/40/30/20/17/15/12/10 m). 6 m, 2 m and 70 cm are explicitly unsupported by this HF profile and show that label; there is no borrowed Region 3 table.
- [Region 3 standard-document index](https://www.iaru-r3.org/reference/standard-documents/) identifies R3-004 rev. 2, November 2024, and links the [adopted 2024 PDF](https://www.iaru-r3.org/wp-content/uploads/2025/01/R3-004-Band-Plans-IARU-Region-3.pdf). Tables on PDF pages 5–15 cover all 13 existing map bands. The separate Region 3 “Band Plans” page still links an older September 2019 interim PDF; the standard-document index and dated adopted revision control this bundled profile. The source's 30 m CW start is 10110 kHz and is preserved without inventing 10100–10110 kHz guidance. Condensed strips combine adjacent identical descriptions; overlapping source segments remain deterministic overlapping strips. National permissions, bandwidth limits and mode classification are not inferred from strips.
- [IARU beacons](https://www.iaru.org/on-the-air/beacons/) confirms IBP marker frequencies 14.100, 18.110, 21.150, 24.930 and 28.200 MHz. [NCDXF/IARU schedule](https://www.ncdxf.org/beacon/) describes Morse identification; the optional reference markers explicitly declare CW. The marker set is off initially and makes no current-audibility claim. No emergency-frequency defaults were added.

## Verification boundary

Focused frontend regression run initially passed 101 tests across map, band map, HF propagation, sidebar, parser, guide validation and receiver projection. Additional controls/tune-owner tests exercise explicit import choice and no tune on inspection. Native fixtures cover guide bounds and concurrent native RBN cache deduplication. The integrator records final full TypeScript/native results after shared-file integration. Browser/native visual and exact-package smoke remain separate acceptance evidence.
