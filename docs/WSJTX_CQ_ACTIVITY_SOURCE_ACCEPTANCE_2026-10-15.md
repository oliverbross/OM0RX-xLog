# WSJT-X receive-only CQ activity — 15 October 2026

This source checkpoint extends the existing default-off Logged ADIF receiver
with bounded FT8/FT4 CQ activity for the existing passive Alerts owner. It does
not establish live WSJT-X, installed-app or notification acceptance.

## Receive contract

The activity parser is xLog-owned code derived from the official protocol field
specification at
[WSJT-X NetworkMessage.hpp](https://github.com/WSJTX/wsjtx/blob/master/Network/NetworkMessage.hpp).
No QLog or RUMlog source, assets or implementation were copied.

- Activity accepts schemas 2 and 3 and parses the documented minimum Status,
  Decode, Heartbeat, Clear and Close fields. Unrecognized message types are
  ignored; appended fields are ignored as required by the protocol's extension
  convention. Unsupported schema, truncated required fields, invalid booleans,
  non-finite timing, oversized strings/datagrams and control-bearing messages
  are rejected. The existing Logged ADIF parser keeps its earlier positive-schema
  compatibility, with a schema-1 regression test.
- The existing loopback/multicast IPv4 socket remains receive-only. Sender
  endpoint plus WSJT-X instance identifies each session. The listener/workspace
  epoch changes when the receiver is stopped or replaced. Close/Clear affects
  only the named session; malformed input invalidates that sender's retained
  context rather than reusing an earlier frequency.
- Only live, new, confident CQ decodes with a recent FT8/FT4 Status and decode
  time within 60 seconds enter activity. Replay, non-CQ, low-confidence and
  off-air decodes cannot enter it. Unsupported modes invalidate earlier mode
  context. UTC day rollover is resolved to the nearest day.
- Retention is bounded to eight sessions, 200 CQ reports and 4,096 remembered
  decode identities. Reports expire after 60 seconds; Status expires after
  120 seconds; abandoned sessions expire after 180 seconds. Repeat packets keep
  their original identity and cannot refresh a report's age.
- Activity message handling has no contact-import callback, outbound socket,
  reply/highlight builder, CAT, PTT, Tune, CW or rotor capability. Logged ADIF is
  still the only contact-save path in this receiver.

## Alert integration

The existing native projection loop reads retained activity from the already
running worker. It does not create a second timer/socket or start the UDP
receiver. Activity sampling runs before cluster refresh even when that refresh
is unavailable or busy. Worker generation is checked before observation.

The existing named-rule matcher, semantic repeat merge, dashboard, popup/sound
adapter and delivery limits are shared. Activity has an independent source
baseline and seen set; its first retained snapshot, reconnect or settings
revision cannot replay reports as alerts. Entry provenance is visible in the
dashboard. Existing saved rules migrate to DX Cluster only; choosing WSJT-X CQ
or both sources requires an explicit rule edit. Saving/re-enabling rules
baselines retained reports again.

At this checkpoint call and DXCC novelty remained `Unknown`. That limitation is
superseded in source by commit `2fab507`, which reuses the local logbook/CTY
classification with a separate no-replay revision fence. See
[the classification follow-up](WSJTX_CQ_CLASSIFICATION_SOURCE_ACCEPTANCE_2026-10-16.md).
Callsign, comment, band and data-mode conditions remain available, and old
cluster-only rules still cannot silently acquire a new source.

## Verification

- Swift: 14 focused tests pass across `LiveWSJTXBridgeTests` and
  `WSJTXActivityTests`, including legacy Logged ADIF behavior, two instances and
  endpoints, CQ/non-CQ, replay/duplicate identity, period expiry, malformed and
  incompatible packets, schema-2/3 activity, source bounds, mode invalidation
  and zero importer calls for activity.
- Rust: 30 focused tests pass across DX alerts and cluster sessions, including
  independent baselines, cluster-unavailable scheduling, repeat merging,
  stale-report rejection, legacy rule migration, malformed projection rejection
  and the existing delivery/authority boundaries.
- Renderer: 37 focused tests pass across alerts, WSJT-X settings and window
  routing; source choices remain explicit and expose no station actions.
- Production TypeScript/Vite/window-bundle checks pass. Native installed-window,
  live WSJT-X UDP and actual notification/sound observations remain open.

No provider credential, station command, live cluster or live WSJT-X application
was used for this source checkpoint.
