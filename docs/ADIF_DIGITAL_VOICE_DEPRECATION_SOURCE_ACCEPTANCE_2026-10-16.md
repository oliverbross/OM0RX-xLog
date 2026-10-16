# ADIF digital voice deprecation source acceptance — 16 October 2026

This bounded R04 stage fixes native QSO export of the import-only `C4FM` and
`DSTAR` MODE values. Both now export as `MODE=DIGITALVOICE` and, when the
contact has no explicit submode, `SUBMODE=C4FM` or `SUBMODE=DSTAR`.

## Primary source

Reviewed 2026-10-16: [released ADIF 3.1.8 specification](https://adif.org.uk/318/ADIF_318.htm),
updated/released 2026-10-12, sections II.B Deprecation, Mode Enumeration
and Submode Enumeration. The Mode Enumeration explicitly prescribes these two
export pairs. The source is pinned by version URL and publication date; this
note does not claim an archived byte-for-byte specification snapshot.

## Scope and preservation

`QSOADIF.swift` extends the existing FT4/FT2/JTTY export projection using the
same owner. The existing QSO initializer still normalizes mode/submode case;
export does not mutate the stored contact. Explicit submodes remain authoritative,
including unrecognized values; unknown modes and field bags remain preserved.
This stage does not resolve a conflicting explicit MODE/SUBMODE pair.

`ADIF.swift`, frontend parser/validator implementation, semantic identity,
duplicate/update policies and Wavelog mappings are unchanged. The native exporter
and ADX writer continue to advertise `ADIF_VER=3.1.7` pending the full audit.

## Focused verification

- Swift `ADIFPlanningTests` (18/18): native import-to-export projection for uppercase
  and lowercase input, explicit/unknown submode preservation, opaque field and
  RX data retention, duplicate-safe reimport, repeat export, snapshot export,
  and unchanged ADIF version.
- Frontend `adifTransfer.test.ts` (1,096/1,096): both required digital voice pairs retain
  their values and international text through ADI and ADX export/reimport;
  existing parser, field-preservation and schema regression cases also run.
- TypeScript `tsc --noEmit` and `git diff --check` complete the source checks.

## Remaining gates

The full enum/deprecation audit is still open. In particular, the strict ADX
validator's acceptance of import-only MODE values, other deprecated MODE/field
export conversions, all remaining parent/submode mappings, and conflicting
explicit pairs need separate bounded review. These tests accept the already
normalized native frames; they do not claim strict ADX import acceptance of raw
`MODE=C4FM` or `MODE=DSTAR`.

Exact-package, disposable copied-log, live-service and hardware acceptance have
not been exercised. No station data, installed application or external service
was modified; the only network read was the official specification.
