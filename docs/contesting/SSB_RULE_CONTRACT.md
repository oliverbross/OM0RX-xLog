# SSB pilot rule and entry contract

Status: implementation candidate for focused review. This document does not claim current sponsor approval, packaged-app acceptance, or three-platform runtime evidence.

## Versioned rules

The existing `cq-ww-cw` and `cq-wpx-cw` identities, versions, evaluation behavior, Cabrillo admission, and durable session, QSO, operation-receipt, and canonical mutation-payload shapes remain unchanged. The bounded registry adds:

- `cq-ww-ssb` / `1.0.0-source-spike` / `source-26.10.11`;
- `cq-wpx-ssb` / `1.0.0-source-spike` / `source-26.10.11`.

Both pin source revision `7c8b499225a73f7f8f792246881bd7aefc05452f`. The translation sources are `not1mm/plugins/cq_ww_ssb.py`, `not1mm/plugins/cq_wpx_ssb.py`, `not1mm/lib/ham_utility.py`, and the shared multiplier/duplicate paths already cited by `CORE_CONTRACT.md`. The arithmetic fixtures state independent expected values rather than treating the CW implementation as the oracle.

## Entry descriptor

Every registered rule publishes one `ContestEntryDescriptor` through `ContestRuleMetadata.entry`. Its bounded values are:

- `mode`, `adifMode`, `cabrilloQSOType`, and the admitted Cabrillo formatter-policy versions;
- report format, sent/received defaults, and `maximumUTF8Bytes`;
- sent/received exchange semantics, sent-default source, and explicit ADIF exchange fields;
- serial requirement and allowed reservation scopes.

The accepted pairings are CW / ADIF `CW` / Cabrillo `CW` with three-byte RST, or SSB / ADIF `SSB` / Cabrillo `PH` with two-byte RS. CW defaults to `599`; SSB defaults to `59`. CQ WW uses a pinned station CQ zone, no serial allocation, and no STX/SRX mapping. CQ WPX uses positive numeric sent/received serials, explicitly advertises `stxSrx`, requires a durable reservation for every commit regardless of QSO provenance, and allows session, band, or transmitter reservation scopes. Imports do not bypass the serial ledger; a future reconciliation path requires a separate explicit API. `serialNumber` plus `stxSrx` authorizes downstream numeric STX/SRX mapping; it does not authorize a caller to allocate or rewrite a sent serial.

`ContestRuleMetadata.entry` is a required public initializer and Codable field. This is an explicit source and metadata-wire API break for this unreleased catalog contract: old metadata JSON without `entry` is rejected rather than assigned a universal default. Rule metadata is not embedded in the durable session, QSO, operation-receipt, or canonical mutation payloads, so those shapes and canonical bytes do not change.

Core validation rejects an incoherent descriptor, an unsupported mode, CW reports in SSB, SSB reports in CW, invalid geography, or malformed exchanges. Store draft validation uses the descriptor for exact mode and report byte bounds while still permitting incomplete field contents. Full report/exchange validation occurs before commit through the selected versioned rule.

## Store and export behavior

The store resolves serial eligibility, commit reservation requirements, and post-contact draft defaults from the rule descriptor. It no longer selects those behaviors by CQ WW CW or CQ WPX CW identity. Both CW and SSB WPX commits require a matching reservation for operator-entered and imported QSOs alike, preserving the existing CW admission rule. A WPX SSB reservation remains durable across correction, deletion, and restart; consumed, void, uncertain, and transmitted numbers are not recycled. A CQ WW SSB contact needs no reservation, and clearing its draft restores RS `59` plus the pinned station zone.

Cabrillo headers use `CATEGORY-MODE: SSB` for the SSB rules while QSO records use `PH`. Existing CW output remains `CATEGORY-MODE: CW` with `CW` QSO records. The frozen global CW-only policies `pilot-1` and `pilot-2` retain their prior admission and rejection semantics. SSB rules explicitly advertise separate additive policies `ssb-pilot-1` and `ssb-pilot-2`; using the old default `pilot-1` with an SSB identity fails closed. This avoids silently widening an existing formatter version while allowing the new versioned identities. The source-derived layouts remain pilot export foundations; sponsor submission policy and ADIF end-to-end export acceptance remain separate gates.
