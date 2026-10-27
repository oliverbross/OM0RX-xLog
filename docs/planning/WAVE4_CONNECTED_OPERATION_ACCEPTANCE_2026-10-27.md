# Wave 4 — Connected operation acceptance

## Scope and protected baseline

Authorized 27 October 2026: W13 digital, W15 existing multi-operator authority/dashboard, W20 interoperability, and the independently executable W16 qualification slices. Candidate acceptance is in progress; no installation or Wave 5 is authorized by this record.

Canonical `main` was clean and reconciled once with fetch and fast-forward-only pull at `03f401070b1d54ffad26b43b33920e61b02db849`. The active Wave 4 task owns the existing Python host/store, digital bridge, group-authority, operating UI and integration/release files. The task inventory showed no other active xLog task owning these files. Existing Waves 1–3 owners and implementations are reused.

Production **1.3.46 / `ea530290b52901da59d34a8aef4390433af8573e`** remains installed. The eight installed component hashes, four rollback copies, nine recovery refs and fresh Wave 3 backup manifest were independently checked before implementation (`.build/wave4-production-baseline.json`). Production stores, settings, recordings, installation and rollback are outside this software batch. Automatic activity of the already-running production application is not claimed to be immutable.

## Finite acceptance checklist

- W13: instance-scoped decodes and deliberate selection; exact current contest/radio/lane destination; stale/ambiguous inputs fail closed; separate external completion/durable contact and event deduplication/contest duplicates; fldigi received text and explicit descriptor selection. No inferred engine/radio qualification.
- W15: existing authority/serial/replication plus station/operator/role/band/lane/freshness/lag dashboard, directed messages/passes/helper proposals and deliberate handover. Occupied drafts remain protected. Two disposable peers exercise loss, restart, replay, out-of-order and incompatible contexts. No new wire protocol or offline serial guarantee.
- W20: versioned primary protocol definitions, exact identities/units/modes/actual serials/corrections/deletes, independent loopback consumers, optional-output failure isolation, durable uncertainty and reviewed retry.
- W24: early real native layout inspection, focused regressions, coherent relevant gates, clean uniquely versioned signed candidate, actual bundled Python/native compact/expanded/focus, restart/recovery/export and one bounded combined-workload rehearsal. Unaffected Wave 1–3 evidence is reused.

## W20 implementation batch

The existing N1MM output owner now retains per-destination packet hashes/outcomes/attempt counts after the authoritative QSO commit. Successful UDP send is `sent_unverified`, never remote persistence. Failures of one optional destination do not block another destination or undo the QSO. A reviewed retry requires the retained digest and attempt count; changed destinations and superseded contacts are rejected. The existing Info/time surface exposes these outcomes. Historical operator/station identity, known split RX/TX frequencies in 10-Hz units, original correction timestamp and actual sent serial are preserved; unknown historical lane facts stay unknown. Incomplete scores are withheld.

Focused source checks: eight Python N1MM cases and two delivery UI cases passed; TypeScript passed. The first UI test invocation lacked the jsdom environment annotation; adding the annotation fixed the harness failure. These are source checks, not candidate or external-consumer acceptance.

Primary contracts reviewed: [WSJT-X v3.0.2 NetworkMessage.hpp](https://github.com/WSJTX/wsjtx/blob/v3.0.2/Network/NetworkMessage.hpp), [fldigi XML-RPC developer API](https://sourceforge.net/p/fldigi/wiki/api_for_xmlrpc_socket_services/), and [N1MM external UDP broadcasts](https://n1mmwp.hamdocs.com/appendices/external-udp-broadcasts/), accessed 27 October 2026. Protocol fixture/snapshot identities and actual candidate results remain pending. UDP delivery is neither consumer persistence nor contest submission.

## W16 retained qualification — reviewed once

The excluded `codex/cw-skimmer` tip `3a28134caa6c6c981c5f2a564fa22a69d1bc7778` remains preserved and unmerged. Its retained full two-span/32-track synthetic profile at attributed source `b304bb14` inferred all 32 tracks in 15.5959 wall seconds, with 275 events, 13 coalesced jobs, zero dropped jobs, P95 decode age 1,387.73 ms and maximum pending count 32. Strict capacity remains **false**. This is retained evidence, not a fresh run or permission to reduce the launch scope.

Separate unresolved gates: NL-06 capacity/coalescing; NL-07 physical Flex identity/IQ mapping/continuity/LAN-VPN (last TCP attempt failed); NL-08 real SunSDR2 DX/ExpertSDR3 dual-receiver packets, reconnect/sleep and TX quarantine; NL-09 consented real-IQ independent whole-call held-out corpus and false-spot calibration; NL-10 exact-package lifecycle/action receipts/external consumer/8–24-hour soaks. Independent authorized offline fixtures may proceed without closing these gates. CW decoding and automatic local CW spots stay disabled. No second decoder or new Flex/TCI audio transport is introduced.

## Remaining boundaries

No live peers/accounts/providers, uploads, physical radio/PTT/RF/rotor, physical audio capture/playback, production migration/rescore or installation. Only isolated disposable storage and admitted loopback/fake transports may be used. Real external engines require demonstrably absent radio/audio/output configuration; otherwise their acceptance remains explicitly untested. Hardware-dependent checks cannot be inferred from software fixtures.

Retain the unsaved-note tab-navigation limitation: an unsaved editor is view-local until Save. Retain the WebKit IndexedDB `IDBKEY` collation limitation: verified backup bytes do not constitute a successful SQL integrity check. Candidate identity, receipt, native results and exact remaining external gates will be recorded here before readiness is declared.
