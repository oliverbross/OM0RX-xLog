# DXpedition Map parity ledger

This feature is an independent native tool window. It does not replace World Map, Band Maps, Cluster, or Chaser & DX, and it does not create another cluster or radio connection.

| Requirement | Implementation | Evidence boundary |
|---|---|---|
| Current/upcoming DXpedition catalogue | Shared opportunity owner combines NG3K ADXO labelled records and the existing 425DXN calendar; only `dxpedition` rows enter this surface. | Parser/model fixtures and source health; live publisher availability is not implied. |
| Multiple calls for one operation | Exact published aliases join one occurrence; substring/base-call matching is not used for cluster admission. | Frozen alias and similar-prefix tests. |
| Independent cluster view | DX Map reads the bounded `contest_spots` projection before ordinary Cluster presentation filters. | Native identity tests prove visible and pre-filter rows share the same retained activation identity. |
| Live/Active/Recent/Upcoming | Derived from cluster observation age and UTC operation dates: `<45m`, `<6h`, `<48h`, or future start. | Boundary model tests; schedule/fetch time is never a live observation. |
| Passive navigation | Card and marker clicks only select details. | Component test proves no activation from card/pin. |
| Tune & load | Explicit frequency-row action uses the existing native spot-activation transaction and exact integer Hz. | UI/native tests; physical radio acceptance remains separate. |
| Callsign-only load | An upcoming operation with no observation uses the existing opportunity draft-only action. | Component and native retained-feed tests; no frequency is fabricated. |
| Selected receiver | Uses the shared station selection/telemetry owner for Flex LAN, Remote Agent, Hamlib, and Direct TCI. | Native admission tests; no DXMap-specific controller. |
| QSO history | Existing opportunity history fields are displayed when available. | Local projection only; this surface does not write a QSO. |
| Club Log totals/rate/watchers | Shown as unavailable. | No supported authenticated provider contract is configured, so values are not invented. |
| Languages and layout | English/Italian controls, keyboard-native buttons, narrow layout, reduced-motion CSS. | Source/UI review; full assistive-technology and multi-monitor acceptance remains open. |

Deferred: provider-backed Club Log totals/rate/watchers, richer coordinate authorities, physical-radio runs, long-session profiling, and packaged candidate acceptance after integration into canonical `main`.
