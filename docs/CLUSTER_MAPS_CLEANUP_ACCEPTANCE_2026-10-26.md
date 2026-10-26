# Cluster, maps and old-version cleanup acceptance

Delivered in installed **1.3.36**, exact application source
`079570505b06f0a5aba403aa6105909148652c91`. See the
[release and protected-installation record](MACOS_1_3_36_RELEASE_2026-10-26.md).

## Cluster and display changes

The connected cluster was receiving spots, but the saved `specials: ["RBN"]`
legacy Show only selection excluded ordinary spots. Removing that whitelist
restored visibility immediately. Commit `efd80ae2` replaces the confusing special
type controls with **Show Yes/No**: Yes permits that type through the remaining
band/mode/source filters; No excludes that type without excluding other types.
Legacy whitelist state is retired in native decoding and frontend normalization.
Existing explicit exclusions and other filters are preserved.

Commit `345f3ed1` corrects the DXpedition map height selector to the actual map
root so it fills its available pane. Commit `07b38d5f` gives Normal Operator Desk,
compact and detached band maps callsign-only labels, stable vertical spacing and
leaders to exact frequencies, using the improved contest presentation. Normal
status colours/tooltips and distinct frequency/mode occurrences remain available.
Commit `49345f93` trims HF Propagation viewing height to the last visible saved
panel while retaining its panel geometry and the full Arrange workspace.

Qualification passed 254 focused Cluster frontend cases, 19 actual XCTest cases
and 25 actual Swift Testing cases. Map qualification passed 33 focused cases and
two real-browser viewport geometry checks. The final band-map/propagation batch
passed 88 cases and TypeScript. Production-component browser checks confirmed
callsign labels/leaders/stacking and effectively zero trailing propagation gap in
viewing mode, with Arrange geometry preserved. Counts overlap and are not added.
Evidence: `.build/dxpedition-map-layout-verification.json` and
`.build/normal-ui-layout-verification.json`.

After protected 1.3.36 installation, passive native checks observed **74 spots**,
the new Show Yes/No controls and their explanatory text, and the updated Normal
band-map labels/leaders/stacking. The original Operator Desk Cluster tab was
restored. These checks did not change a draft, log a contact, change settings,
invoke sync or control radio/audio. DXpedition and propagation layout acceptance
uses the production-component browser evidence above, rather than claiming a
separate installed-window geometry measurement.

## Latest-version retention

Following accepted installation, the human's latest-version-only request was
applied to the reviewed obsolete binaries: **18 app bundles** (4,644,378,555
logical bytes) and **six old Windows/Linux installer archives** (191,234,730
logical bytes). These are artifact sizes, not measured physical disk recovery.

Removed apps comprise ten old `/Applications/OM0RX-xLog-previous-*.app` bundles,
seven superseded `.build/releases` bundles and the old 1.3.32 recorder/playback
copy under `~/Documents/Builds`. This includes the 1.3.34 rollback application
verified during installation and the qualified but never installed 1.3.35 binary.
Their earlier qualification records remain historical evidence, not claims that
those binary paths still exist.

All three retained bundles are **1.3.36**: the installed application, canonical
staged bundle and immutable `.build/releases/1.3.36` copy. Post-cleanup checks
passed deep/strict signatures, the eight recorded component hashes, exact source
provenance and equality of all **4,075** bundle entries across those copies.
All 24 reviewed removed paths are absent. Source history, provenance/hashes,
acceptance evidence, checksum sidecars, logs, settings, recordings and protected
data backups were retained. No source/worktree/stash or user-data cleanup occurred.

Local receipts: `.build/app-cleanup-1.3.36.json`,
`.build/old-installer-cleanup-1.3.36.json`,
`.build/post-cleanup-verification-1.3.36.json` and
`.build/obsolete-app-provenance-20261026/`.
