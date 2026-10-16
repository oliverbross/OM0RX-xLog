# OpsLog v0.51.10 supplementary reference audit

Reviewed: 16 October 2026. External reference order is **RUMlogNG #1, QLog #2,
OpsLog #3**. OpsLog is a documented supplementary product/behavior reference,
not a current-source-reviewed implementation or a verified licensing source.
This reference decision does not change xLog's implementation checkpoint,
installed alpha.31, acceptance evidence or safety boundaries.

## Provenance and access limits

- Official [v0.51.10 release](https://github.com/GregTroar/OpsLog/releases/tag/v0.51.10),
  published 15 October 2026, points to mirror commit
  `b30bd55c3de979edc76a965034e8d2f7fd5fdc12`.
- The read-only local mirror is `/Users/oliver/Documents/Projects/OpsLog-reference-v0.51.10`.
  `git ls-tree` at that tag lists only `README.md` and `README.fr.md`.
  The [pinned English README](https://github.com/GregTroar/OpsLog/blob/b30bd55c3de979edc76a965034e8d2f7fd5fdc12/README.md)
  is product documentation, not the application source tree.
- The actual source authority is [the Gitea repository](https://git.rouggy.com/rouggy/OpsLog)
  (`https://git.rouggy.com/rouggy/OpsLog.git`). The access audit encountered Git
  credential requirements, sign-in for web/archive access and API HTTP 403.
  Current application source at v0.51.10 was therefore not reviewed.
- The supplied GitHub API audit reports `license: null`; no application source
  licence was found in the mirror. README mentions of third-party font/flag
  licences do not establish the application's licence or permission to reuse code.
- The operator reports that Greg Troar directly authorized mutual feature and
  code reuse. That permission is the collaboration context for future review;
  exact source/version provenance still needs to accompany anything reused.
- No OpsLog code, assets, credentials, settings or log data were copied. No app
  was installed or run, and no provider, station, audio endpoint or RF test was made.

## Documented product scope

These are README claims, not verified source/runtime results.

| Area | Documented behavior | xLog comparison boundary |
| --- | --- | --- |
| Stack/storage | Wails 2.11, Go, React/TypeScript with Vite; local SQLite configuration and a local SQLite or optional shared MySQL logbook | Do not adopt a second log owner or infer durability/concurrency guarantees. |
| TCI | Push-driven SunSDR console, bidirectional network audio, QSO recorder and digital voice keyer | Telemetry, audio transport, endpoint selection, key/release and RF authority remain distinct. |
| Flex | Native TCP control and UDP discovery/meters, slice/split/spots, per-band antennas and DSP controls | Capability, transport, observed state and action/readback need separate acceptance. |
| Awards/references | Configurable built-in/custom definitions, reference detection/import, worked/confirmed/validated band-mode matrices and locator/map context | Documentation does not prove sponsor credit or rule correctness. Preserve manual definitions and sponsor-specific evidence. |
| Logbook/ADIF | ADIF extras, standard/all export modes, filtered/selected export, duplicate choices and profile editing | A field dictionary is not round-trip fidelity proof; standard interchange and full backup need different contracts. |
| Workspace | Configurable panes, themes and per-profile settings | Native detached lifecycle, per-map preferences, resize and restoration still need xLog-specific tests. |
| Activity | Multiple clusters, status filters, alerts and WSJT-X/JTDX/MSHV UDP decodes | No inferred tune/reply/transmit authority from activity or notification. |
| Confirmations | ClubLog, LoTW, QRZ, eQSL, Cloudlog/Wavelog and HAMLOG upload/confirmation workflows with award refresh | Delivery, confirmation evidence and sponsor credit remain separate. |
| Contest/devices | Contest exchange/dupe/score workflows, keyers, amplifiers, switches and rotor control | Neither xLog contest parity nor physical device/RF acceptance follows from documentation. |

## Release-derived acceptance cases

The v0.51.10 release notes suggest the following independent xLog checks. They
are not claims that these xLog paths are implemented, defective or accepted:

1. Flex PC-audio selection must not be confused with radio mixer outputs; test
   their distinct ownership and readback.
2. A direct FT reply must not disappear under display/activity filtering.
3. QSO edits and round trips must retain seconds.
4. LoTW county validation must distinguish an invalid value from duplicate or
   upload errors, without silently losing a batch.
5. Closable tabs must retain preferences under independent stable keys.

## Independent xLog priorities

1. Separate standard ADIF interchange from full-backup export; document field,
   privacy, restore and compatibility semantics without changing ADIF_VER 3.1.7.
2. Use one authoritative award/spot-status projection across confirmation and
   reference refresh; never infer sponsor credit from delivery or a local count.
3. Fence derived caches by canonical contact/reference revisions; invalidate
   stale evidence instead of silently treating it as current.
4. Keep capability, transport, observed state and requested action separate;
   no notification or connected socket grants control/readiness authority.
5. Treat TCI audio endpoints and explicit key/release validation as a separate
   opt-in acceptance programme. Do not add audio/PTT authority through comparison work.
6. Preserve per-map preferences and explicitly resize after layout/restoration;
   test compact, large and mixed-display geometry with the existing window owner.
7. Preserve user award customizations across catalog upgrades; keep sponsor
   rules, user overrides and migration provenance distinguishable.

These are planning and acceptance priorities, not a new implementation owner,
automated correction, bulk migration or authorization for device/provider calls.

## Open gate and retained limits

Obtain legitimate access to the actual versioned application source and retain
the reported direct permission plus exact source/version provenance before any
source-level audit or proposed reuse. Until then, OpsLog stays #3 and
documentation-only. Source access is not required to retain the independently
stated behavioral acceptance cases above.

RUMlogNG remains #1 and QLog #2 with their existing dated audits intact. The
comparison workbook retains all xLog source/test evidence and its distinction
from package/native/live provider/network/station/RF acceptance. Installed
alpha.31 is unchanged. The recurring closeCount lifecycle failure, correction
apply/undo, full ADIF 3.1.8 audit and package/native/live gates remain open.
