# CW and SSB macro status — 2026-10-25

Read-only audit of canonical source `bb521509`, following installed 1.3.14
(application source `0c2b564868cc7999f7674b65b1643b56c10a18c0`).

## Result

Core macro functionality is implemented; full hardware acceptance is incomplete.
This is not a claim of complete N1MM macro compatibility.

| Area | Evidence and limits |
| --- | --- |
| Substitution and operation | Saved F1–F12 definitions, Run/S&P mappings, ESM and logging actions are implemented. Nine focused Python CW/SSB macro tests passed in isolation. |
| CW | Native radio and independent WinKeyer output paths include Arm/Stop and output ownership. Actual connected keying and Stop remain operator-controlled acceptance checks. |
| SSB recordings | Microphone recording, overwrite confirmation, WAV validation, preview and Run/S&P mapping are implemented. Installed microphone recording was not tested in this audit. |
| SSB routing | Fourteen simulated frontend voice tests passed. Selected-device output requires runtime `setSinkId` support; there is no native routing fallback. Actual installed output routing is unverified. |
| SSB PTT and audio | Ordered playback and PTT release are implemented. PTT operation and actual transmitter audio are distinct, unverified hardware results. |

## Explicit limitations

- `python/contest_host/upstream.py` rejects `{MARK}`, `{SPOT}`, `{TX}`, `{RX}`,
  `{TX/RX}` and `RI:` CAT commands. `{VOICE1}`–`{VOICE10}` select managed WAV
  files, not hardware radio memories.
- Configured Multi-Op clients disable ESM/function keys pending master-authorized
  logging support (`Not1MMContestWorkspace.tsx`).
- CW radio output supports the direct agent, direct Flex LAN and Hamlib paths;
  Hamlib requires both Send and Stop Morse. WinKeyer firmware support is bounded
  to revisions 23, 30 and 31.
- Dim function buttons alone do not establish a macro defect: output availability,
  arming and operating-role state govern their availability. This audit did not
  establish which condition applied to the operator's screenshot.

No new defect was demonstrated by this bounded audit. No production QSO edits,
radio commands, PTT, audio playback, RF, rotor actions or packaging were performed.
See also [1.3.14 acceptance](CQ_WW_SSB_1_3_14_BUILD.md) and
[CW implementation acceptance](../CW_IMPLEMENTATION_STAGE.md).
