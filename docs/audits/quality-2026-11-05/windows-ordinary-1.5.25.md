# Ordinary Windows 1.5.25 upgrade and Settings restart

**Bounded AU24 → AU25 journey: PASS. Candidate: HELD. Quality phase: OPEN.** Completed at **2026-11-06 21:58:02 UTC**, published 7 November 2026, Darwin. This later report supplements the [packaged/hosted checkpoint](ci-1.5.25-windows-packaged-qualification.md), whose earlier ordinary IN PROGRESS status remains historical.

The frozen source is [`ff8a8e388658fe7e822f3ecb3a5b7e13f5db9cee`](https://github.com/oliverbross/OM0RX-xLog/commit/ff8a8e388658fe7e822f3ecb3a5b7e13f5db9cee), from [Windows run 42286159030](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42286159030), attempt 1. The all-users installer is **58,426,254 bytes**, SHA-256 `9be4b36b224d1481f5f2c38a2e9c82668bd5a2259c2f78c9602a55c5cf25d280`. It is an unsigned internal candidate; its checksum establishes integrity, not publisher authentication. The [numeric report](windows-ordinary-1.5.25.json) records exact retained evidence pins and all 16 data/settings checks.

## Observed ordinary journey

The recovered guest ran Windows 11 Pro ARM64 build **26200.6584**, with 8 GiB RAM / 4 vCPU and the x64 application under emulation. The desktop account was a filtered administrator using an unelevated medium token, **not a true Standard user**.

1. The interactive all-users upgrade from 1.5.24 used the default Program Files destination. UAC was accepted once; application-data deletion and installer Finish Run were unchecked. All 3,270 manifest payload entries matched, the manifest was separately pinned, and HKLM64 version/location registration passed.
2. Two ordinary common-shortcut launches had distinct, exact native host/worker identities, empty shortcut arguments, no test flags and unelevated medium tokens. Both displayed the normal Operator Desk.
3. On the first launch, the synthetic station call changed from `K1TEST/P` to `K1TEST/M` with one Save and an actual success toast. Normal close was followed by positive bounded process-only absence and a closed SQLite/WAL/SHM capture.
4. After ordinary restart, the changed value was visually confirmed **before** database analysis. The original call was restored with one Save and another success toast. Normal close, a second absence check and closed capture followed.

## Data, settings and process preservation

All **16** retained checks passed. Both existing QSOs remained identical across all **12 stored columns**, with exactly two physical/live rows; no QSO was edited in AU25. The common ordered all-column hash is `957bdb0ab4b4e8b2b251c52272b270ebacd2e712baf5b95e6174329725003f69`. All original settings were restored. Settings revision advanced **2 → 3 → 4**, exactly once per acknowledged Save; sync revision stayed **0** and the full rotor snapshot was unchanged.

Both closes observed zero scoped app candidates, attributed or unresolved profile WebViews, port 9222 listeners and packaged Hamlib helpers. These are bounded inventories, not direct worker wait/EOF or universal drain proof. Retained analysis used separate read-only WAL-aware copies. This publication did not access the live Windows database or SQLite-open the raw evidence triplets.

The five-root profile archive was copied to the host and verified: **47,886,766 bytes**, SHA-256 `a5e35fbeaa48d1e4e611c40c208ae216db43eb82de75351bea80920ce572ca9b`; all **454 files / 68,891,658 source bytes** matched. Its SQLite triplet matched the second accepted capture, and both native radio JSON files were unchanged. The prior AU24 backup was retained and rehashed. This does not recover the original guest-only VHDX or prove full VM/profile restoration.

## Retained procedural failures and corrections

- Initial shortcut text entered Windows Search but was never submitted. The correctly observed PowerShell shortcut command was then submitted once.
- The first root wrapper rejected nonempty stderr even though the native observer exited 0 and its required identity checks passed. The exact stderr contained three completed module-preparation progress XML records, with no error/warning records. That specific classification retained the raw receipt and failed wrapper; neither the app nor observer was rerun. It does not weaken general stderr/error checks.
- Save-burst v1 was rejected before execution because repeated Shift could trigger Sticky Keys. Reviewed v2 used one refresh pair and capture-only frames.

The frozen UI-action log remains unchanged. All **14** hash-pinned references in root checkpoint `2f3e471b4f9477ca5b4fd31624ddc10acc74acda7bb034d54e4eba0f7fde6f1b` were independently rehashed for this publication. Raw process identities, user paths and profile contents remain private.

## Scope limits and final state

This proves the named two-QSO upgrade, Settings save/restart/restoration and bounded normal-close journey in ARM64/x64 emulation. Native-x64 ordinary desktop, true Standard user, fresh onboarding, large logs, media, full restore, complete graphics and physical equipment remain unqualified. S24's hosted canvas-recovery and Settings-readback failures remain failures despite this later result.

S25 excludes the later [paging correction](logbook-page-cancellation-2026-11-06.md) and [ADIF timestamp correction](adif-fractional-second-2026-11-07.md). Those source changes and their gates do not qualify these package bytes. The latest retained checkpoint has the test app closed and UTM running; this publication performed no VM or GUI actions. Daily Mac **1.5.15**, its rollback and the public release remain unchanged.
