# Bounded critical-sink follow-up

Same canonical `0ce97a12`; source remains unchanged. This follow-up adds no
new finding beyond PH6-FE-001 and PH6-FE-002. It is a targeted source trace,
not an executed webview exploit assessment or complete security audit.

## Untrusted text and URL sinks

* A global `prototype/src` TS/TSX inventory of `dangerouslySetInnerHTML`,
  `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `setHTML`, `document.write`,
  `eval`, `new Function`, navigation setters, external anchors and `window.open`
  is retained in `security-sinks.txt`. Direct HTML-writing hits are test fixtures,
  not production feed paths. This search is a sink inventory, not a proof that
  arbitrary future sinks are impossible.
* `Map.tsx:327-353`: report callsign/details go into created DOM nodes using
  `textContent`; MapLibre receives `setDOMContent(content)`. Expedition markers
  at `430-473` use text nodes and `replaceChildren`; spot text cannot form HTML.
  Click handlers reselect the current retained spot from `spotsRef`, not the
  closed-over report payload. Static attribution anchors at `602,740` contain
  bundled constant URLs; no report text is concatenated into those strings.
* `DetachedDXpeditionMapSurface.tsx:122-158`: callsign, notes, QSL route, comments,
  sources and modes render as React children. Club Log/QRZ/DXWatch URLs have fixed
  HTTPS origins with `encodeURIComponent(primaryCall)`; publisher source links
  pass `safeExternalURL:68-70` (HTTPS only). These source links do not have an
  official-host allowlist; that alone is not a code-execution defect.
* `OpportunitiesPanel.tsx:27-31,293-301`: public feed source anchors pass HTTPS
  plus an exact official-host allowlist. Other publisher fields remain React text.
  `AwardsPanel.tsx:56-59,98-115` similarly uses HTTPS-only source URLs and React
  text. No raw HTML parser is involved in those detail cards.
* Existing `QSOEditorCore.safeProfileURL:19-29` rejects non-HTTPS, credentials,
  ports, hashes, IP-like hosts/local suffixes and the credential-bearing QRZ API
  endpoint. Actual image/website use at `400-407` has no-referrer policy and
  website noopener/noreferrer. No claim of DNS rebinding prevention is made.
* `ContestOperatingInfo.tsx:74-75` does not perform a renderer URL filter, but
  the traced producer `python/contest_host/operating_rules.py:5-6,65-66` supplies
  two fixed sponsor HTTPS URLs. This concrete path does not consume cluster or
  publisher URLs. Current ReactDOM also has `sanitizeURL` blocking javascript
  URLs, but the constant producer is the decisive guard here.

## Report selection does not become arbitrary native command data

* `mapContext.ts:13-44,48-76`: context is validated, coordinates bounded,
  snapshots ordered by native epoch/revision; wake events carry no report data
  authority and an overtaken/disposed read is discarded. `useMapContext` checks
  report freshness/current membership before requesting activation.
* `main.rs:366-389` exposes typed activation commands with operation UUID,
  source epoch, spot ID/version. It applies role/isolation/shutdown checks and
  native NormalLogging admission. It does not accept a renderer frequency,
  program path or shell command in that activation request.
* `spot_activation.rs:10-19,149-207,224-243` validates non-nil UUID identities,
  prevents an operation ID being reused for a different report, waits on exact
  editor membership/readiness, and re-resolves retained spot/radio selection
  before apply and tune admission. `spot_activation_backend.rs:230-246,303-328`
  resolves through native sources, verifies worker generation and rechecks
  retained spot equality under control admission before the typed radio owner.
* `cluster_session.rs:287-296` requires a native retained snapshot within5seconds,
  then resolves epoch/id/version against the current worker. `opportunity_selection.rs:1-70`
  retains bounded300/500 pools with UUID versions, excludes explicitly informational
  operations, and re-reads the same existing worker generation to confirm the
  selected row is still present/equal. Opportunity selections are draft-only.
* Previously reviewed `worker.rs` role/method/frame validation and main worker
  dispatch remain the additional IPC boundary. The earlier duplicate-advisory
  finding is an overly narrow capability omission, not an authority bypass.
* `tauri.conf.json` has self-only scripts and restricted connect targets;
  capability JSON grants core permissions to listed bundled windows and has no
  explicit remote-origin, shell-plugin or filesystem-plugin grant. Native custom
  commands still need their per-command role checks. This follow-up did not run
  external navigation or prove all platform new-window behavior.

## Recovery, secrets and asynchronous context

* `readRadioJournal.ts:1-15` treats missing/malformed generation as legacy review,
  not replay authority. `main.rs:423-426` reaches only `radio_read::recover`.
  `radio_read.rs:77-107,415-423` validates UUIDs, refuses active/admitted/reserved
  reads, returns blocked terminal review for missing generation or old workspace,
  and checks an existing worker's exact durable receipt. It never invokes a new
  radio-read effect in this path. Renderer `SpotActivationEditor:65-103` freezes
  synchronously, rejects mismatched/stale observations, requires a fresh canonical
  draft on terminal status and checks lifecycle/version before releasing editors.
* `settingsSession.ts:1-211` was read in full: snapshots/mutations are bounded,
  generation/expected revision and exact mutation fingerprint/receipt values are
  checked. Unknown writes stay pending; explicit retry reuses the same operation.
  Normal edit/save removes recursively named credential keys. The journal reader
  rejects secret-bearing draft fields. This is normal data-flow protection;
  malicious same-origin storage tampering was not fuzzed, and it is not a claim
  that a compromised renderer cannot write its own localStorage.
* `ServiceSettings.Credential:36-81` keeps entered secret in local React state,
  sends it only via typed secret_save on explicit Save/Remove, clears on success,
  and reads presence flags rather than secret values. No value was inspected or
  printed. No new credential-persistence leak was established.
* Previously inspected Not1MM pending mutation code scopes local and authority
  sessions/workspace generations, preserves exact request IDs, requires durable
  roundtrip storage before sending, and quarantines invalid/stale records before
  a new effect. This follow-up did not expand that4022-line component into a full
  proof of every asynchronous or authority lifecycle.

## Rejected leads and remaining limits

Rejected on the traced paths: cluster HTML injection into map popups; publisher
URL→javascript protocol execution; arbitrary renderer report fields becoming a
radio tune; malformed/legacy ReadRadio journal causing effect replay; ordinary
credential inputs entering Settings journals. No exploit was inferred from a
generic shallow TypeScript response type alone where a native owner or a bounded
producer supplies the actual data.

Not established: full remote webview navigation/new-window acceptance; every
native custom-command role handler; recursive malicious JSON/DoS bounds; full
feed network/redirect/SSRF policy; the complete map geometry and drawing engine;
all renderer recovery sessions; all Not1MM/LiveApp asynchronous branches. No
additional tests, app build, GUI, network/provider action, or station effect was
run for this follow-up. Prior test/probe evidence is preserved unchanged.
