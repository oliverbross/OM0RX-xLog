# CW Decode

Primary target: `prototype/src/live/CWDecodePanel.tsx`
Related targets: `CWDecodePanel.css`, `DetachedCWDecodeSurface.tsx`, `cwDecode.ts`, `useCWDecode.ts`.
Mode: Operate. Extend the incumbent OM0RX-xLog console; preserve DESIGN.md.

The operator monitors up to two IQ spans and reads independent signal copy.
Frequency/offset, source and transcript carry the hierarchy; a selected signal
has a secondary detail inspector. Flat source rows and the existing compact
controls precede the dense table. Source/server settings open inline without
blocking observation or implying that saved preferences start capture.

Committed and provisional copy are visibly distinct. Unknown RF, speed and SNR
remain explicit. Source interruptions clear old copy. Automatic spot quality is
not an operator override. Stop remains usable during pending Start. Main and
detached windows share one native owner and never gain CW transmit authority.

One batched synthetic visual review covered 1360×900 and minimum width 640.
One corrective batch aligned settings labels/controls, themed the native
textareas and applied attention colour to qualification text; confirmation
covered both widths. The table scrolls horizontally within its own region,
without document overflow. No installed app, radio or actual IQ was exercised.
See `docs/cw/DECODE_UI.md` for the exact software evidence and open gates.
