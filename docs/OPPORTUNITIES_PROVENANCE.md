# Chaser and calendar source boundary

This read-only integration uses contracts and operator workflow observations from
Oliver Bross's ShackCQ Web checkout at
`/Users/oliver/Documents/Projects/RigWeave-Web`, revision
`f5bdbd9186f33d3a257971a08a222ae622a9c66e` (GPL-3.0-only):
`services/hosted/src/hostedPortableProvider.ts`,
`services/hosted/src/services/portableCatalogue.ts`,
`services/hosted/src/hosted425Dxn.ts`,
`packages/425dxn/src/index.ts`, and the corresponding
`web/src/portable/PortableWorkspace.tsx` and
`web/src/operations/OperationsWorkspace.tsx` UI contracts. The new Swift parser
and React panel are independent implementations for xLog's worker contract;
the TypeScript source, fixtures, raw provider bodies, and hosted credentials
are not copied into xLog.

The fixed public spot endpoints are POTA `api.pota.app/spot/activator`, SOTA
`api2.sota.org.uk/api/spots/50/all/all`, WWFF
`spots.wwff.co/static/spots.json`, and WWBOTA
`api.wwbota.org/spots/?age=3`. The DXpedition/special-event source is the
425DXN Worldwide DX Calendar at `425dxn.org/dx4win.php`, with visible
425DXN attribution and a link to its human calendar. Public source refresh
is explicit; last-good normalized items retain age, stale state, and a safe
error when a check fails. An item is evidence of an observation or scheduled
operation, never evidence that a contact is possible or that the radio moved.
Each provider's data remains governed by that provider's terms; re-review
before distribution or changing fetch cadence.

ShackCQ Desktop has a WA7BNM RSS contest panel at
`/Users/oliver/Documents/Projects/RigWeave/shackcq-desktop-nexus-20260925/ui/src/components/ContestCalendarPane.tsx`
and `src-tauri/src/lib.rs:5798`. That is a behavioral reference only. The
publisher's [terms](https://www.contestcalendar.com/terms.php) allow ICS for
personal calendar use, limit RSS display to club or nonprofit websites, and
reserve XML/JSON software access for written agreements. xLog does not fetch
or represent a contest schedule until its use and distribution terms are
resolved; the official calendar can be linked from settings meanwhile.

The native local logbook alone supplies worked/confirmed claims, and installed
xLog activation directories alone supply `verified` reference names. Missing
directories and stale feeds are labelled, not converted to unworked or active
claims. No opportunity API performs RF, sync, or external spot posting.
