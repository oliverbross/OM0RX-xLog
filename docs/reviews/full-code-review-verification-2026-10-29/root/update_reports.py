from pathlib import Path
import json

R=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
E=R/'docs/reviews/full-code-review-verification-2026-10-29'
def link(path,label=None):return '['+(label or path)+']('+str(E/path)+')'
p=R/'CODE_REVIEW.md';s=p.read_text()
assert s.startswith('# Application code review — 28 October 2026'), 'Consolidation expects the preserved first-pass report'
old=s[:s.index('## Findings')]
s=s.replace(old,f'''# Application code review — second verification, 29 October 2026

**Verification baseline:** clean canonical `main` at
`12824393f2799f21c223fadcb19d03305a5bf2f8`, fetched and fast-forward checked.
Application source is unchanged from the first-pass baseline
`4bd554a25951ddc995b4bef1715d3df12918a07b`; intervening work added review documents
only. Version declarations remain 1.3.60. Installed application identity was not inspected.

**Disposition: INCOMPLETE full-codebase manual review; second verification stage delivered.**
The ten original findings are retained, with corrected scope and stronger evidence.
Two additional export defects were found while continuing partial coverage:
**12 findings — 2 High, 9 Medium, 1 Low**. No severity change was warranted after
checking the reachable impact and working safeguards. No application code, existing
tests, dependencies or configuration was changed.

The second pass challenged callers, admission/ownership, rollback/replay, test
oracles and relevant React/Swift/SQLite/XML behavior. Root independently reran the
service timestamp, configured Host, real-module registry/fldigi, React and schema
counterexamples. Native recorder/loopback-TCI evidence was cross-checked against
the unchanged implementation and its bounded reviewer artifacts. This is source
and isolated-fixture evidence, without installed UI, provider-account or RF acceptance.

The cumulative exact coverage and remaining work are in
[REVIEW_COVERAGE.md]({R}/REVIEW_COVERAGE.md). First-pass reports are recoverable at
`12824393`; [first-pass evidence]({R}/docs/reviews/full-code-review-2026-10-28)
is unchanged. New scripts, results, logs, reviewer matrices and the cumulative
ledger are in {link('README.md','second-pass evidence')}. Older findings below
retain first-pass reproduction details and add explicitly dated verification.

## Second-pass disposition

| Finding | Result / severity | Caller, safeguard and test challenge |
| --- | --- | --- |
| CR-001 | Confirmed High | Actual `LiveLogbookMethods.handle` admits the manual draft; real SQLite Save, receipt replay and reopen preserve the wrong start. Existing 12-test draft suite passes because the manual case ends before Save. |
| CR-002 | Confirmed High; trigger narrowed | Actual compiled worker retires shared actors, leaving registry actors active; actual loopback TCI remains connected. Normal module switch has an output-idle veto, so active-PTT switch is excluded from the trigger. Ordinary Quit uses a different guard. |
| CR-003 | Confirmed Medium | Actual compiled actor sends `main.rx` in six never-configured/disabled/receive-only lifecycle cases; external-I/O-disabled controls send none. Process ownership does not establish external transmit ownership. |
| CR-004 | Confirmed Medium | Configured independent authority/client baseline works; exact imported change page fails after reopen. Authority/cursor guards and full compared-table rollback work but cannot translate the legitimate event. |
| CR-005 | Confirmed Medium | Configured master grants and durably replays imported serial2; local control grants3. Later `historical_serial_conflict` rejection prevents a duplicate database commit. No peer-transmit claim. |
| CR-006 | Confirmed Medium | Actual CW/SSB/RTTY scores and Cabrillo claims are12 versus pinned-rule6; portable /4 correction is a passing control. Pinned sponsor edition, not fresh sponsor certification. |
| CR-007 | Confirmed Medium | Real ESM-enabled, disabled-ESM Enter and LOGIT commits are misclassified; actual Rust store skips even a supplied marker and persists cursor2. Contacts/audio remain retained. |
| CR-008 | Confirmed Medium | Valid canonical manual snapshots fail both Full→Simple and Full→Simple→Full display assertions in real React components; conditional component-type changes remount local state. Save is unnecessary to prove this finding. |
| CR-009 | Confirmed Medium | Exact production method body with chooser/model scaffolding repeats the real-core skip/duplicate defect; nil database also reports success. Modern importer has separate safeguards. |
| CR-010 | Confirmed Low | Source-labelled samples pass native-facing frontend validity checks; radio sample is mislabeled, amplifier control passes. No changed numeric power established. |
| CR-011 | New Medium | Unfiltered retained SwiftUI logbook2003 → loaded2000 → exported2000; toolbar/menu invoke the same unscoped method. Modern frozen-snapshot export is separate. |
| CR-012 | New Medium | Actual writer emits two names absent from the original official3.1.7 record vocabulary. Original XSD compilation is blocked by an unrelated regex; bounded derived-schema control and exact-name comparison agree. |

''',1)
s=s.replace('Confidence: high. Verification: supported by static cross-component analysis;\nactual RF behavior was not tested.','Confidence: high. Verification: actual compiled-module lifecycle and connected\nloopback-resource probes plus cross-component source analysis; RF was not tested.')
s=s.replace('then\nquit or retire the worker without explicit disconnect.', 'then\nordinary Quit/EOF without explicit disconnect.')
s=s.replace('and small neighboring-interface stubs; no real network or radio.', 'and receiver only, with no neighboring-interface stubs; no real provider or radio.')
s=s.replace('high. Verification: real Host reproduction and static Rust consumer trace. Audio\ncapture itself and native playback were not exercised.', 'high. Verification: real Host commits and actual unchanged Rust store with\nsynthetic PCM. Physical audio capture and native playback were not exercised.')
s=s.replace("the caller's exact import loop; native chooser/banner were inspected statically.", "the exact production method body with chooser/model scaffolding; native GUI\nwas not launched.")
extra={
1:f'''**Second verification:** {link('root/manual-service.json','actual service result')}
uses the real mutation handler, a private empty workspace, matching revision and
generation, and no service stubs. Acknowledged `automaticStart:false` is ignored
at Save; replay/reopen retains one wrong row. With explicit historical end retained,
the resulting duration is negative. The renderer also refreshes automatic times
before flushing `.replace`, which can clear canonical provenance; remediation must
define one frontend/native time-intent contract, rather than merely moving a boolean.
See {link('frontend/VERIFICATION_REVIEW.md','caller analysis')}.
''',
2:f'''**Second verification / scope correction:**
{link('native/verification-matrix.md','full ownership and fallback challenge')}
records actual compiled-module results and a real WebSocket connected only to a
disposable loopback server. `shutdownOutcome == 0` leaves that routed TCI resource
open; explicit routed disconnect closes it. OS process exit would close the socket;
no leak beyond process exit or transmitter state was demonstrated. Passive TCI
disconnect remains admitted even after terminal state and is not itself diagnostic.

Rust `main.rs:2734–2769` vetoes operating-module switch while PTT/Tune/CW and other
output duties remain; **active PTT during a normally admitted module switch is not
a supported trigger**. Ordinary Quit's editor-flush route at2710–2715 has no matching
general output-idle veto. Owned CW/voice shutdown does not cover every GUI PTT/Tune
session. Provider observation watchdog/transport stop is distinct from the owner's
explicit release calls; no destructor/registry-wide release fallback was found.
High remains appropriate for bypassing the existing owned-output cleanup attempt;
the physical consequence remains unverified.
''',
3:f'''**Second verification:** {link('native/fldigi-module.log.txt','eight-case real-module matrix')}
eliminates the first-pass neighboring-stub limitation. Six lifecycle/configuration
combinations send exactly `main.rx`; both disabled-external-I/O controls send none.
Fake RPC and receiver isolate the actor, so interruption of a real external fldigi
session is the reachable risk supported by the command contract, not an observed RF event.
''',
4:f'''**Second verification:** {link('contest/VERIFICATION.md','configured caller/authority trace')}
and {link('root/contest-independent-py312.log.txt','independent Host rerun')}
first establish successful baseline sync with a valid grant. The exact ordinary
import change page then fails before/after both Hosts reopen. Rejected apply leaves
all ten compared core tables and operation receipts unchanged; wrong authority
also rejects. UI and native gates prohibit clients, but admit master import and
preserve the event payload. The missing identity image is independently confirmed.
''',
5:f'''**Second verification:** configured-master grant2 survives exact receipt replay
and reopen; the next fresh grant is3. A local allocator control advances to3 after
the same import. Rejected remote commit rolls back all compared tables. The finding
is the unusable authoritative grant and replay contract; CR-004 prevents assuming
ordinary peer catch-up/transmission succeeds. See
{link('contest/verification-results.json','configured Host results')}.
''',
6:f'''**Second verification:** all three WAE modes produce `scoringComplete:true`,
score12 and Cabrillo `CLAIMED-SCORE: 12`; explicit /4 corrections produce6. Ordinary
call correction, exact replay and reopen retain the corresponding outcome. Bundled
CTY recognizes all three calls as Japan. The retained sponsor bytes again match
the tracked reference hash; current sponsor currency was not re-certified.
See {link('contest/verification-results.json','mode/export/control results')}.
''',
7:f'''**Second verification:** real configured Host paths cover enabled ESM, disabled
ESM Enter and F12 LOGIT, with exact replay/reopen. The
{link('native/verify_recorder_store.rs','actual-source Rust probe')}
supplies synthetic PCM and a valid marker even for `local:false`; no link is made,
while a direct `local:true` control links. Cursor2 survives reopen/replay and later
reclassification of the consumed sequence cannot repair the omission. This excludes
missing marker or fallback alone as the explanation. See
{link('native/recorder-store.log.txt','consumer result')}.
''',
8:f'''**Second verification:** {link('root/frontend-independent.log.txt','independent React run')}
confirms both directions with a snapshot accepted by `validScopedSnapshot`, correct
manual start and canonical flag. React remounts the different component types;
initial state/effects use `!isEditing`, and props omit the canonical flag. Existing
historical-contact edit tests exercise `isEditing:true`, a different path. The
main-submit automatic refresh/native-replace interaction is a remediation dependency
shared with CR-001, not an additional promoted timestamp defect.
''',
9:f'''**Second verification:** {link('root/legacy-methods.json','exact-method results')}
executes the unchanged extracted `importADIF` body, including success-banner logic,
against real core/SQLite. Only native chooser and surrounding model scaffolding are
substituted; {link('root/legacy-method-source.json','source/extract hashes')} preserve
the boundary. Mixed input stores1/announces2; repeating stores2; nil database still
announces2 because optional chaining performs no write and throws no error. No
whole-batch transaction, duplicate policy or outer caller guard repairs this route.
''',
10:f'''**Second verification:** source and context labels are aligned so both radio
and amplifier samples pass `validDraftPower` and `validScopedSnapshot`. The amplifier
label is a passing control; radio still receives KPA500. This remains Low because
the defect is source attribution, with no numeric or transmit behavior established.
See {link('root/frontend-independent.log.txt','independent formatter/component run')}.
'''
}
for i in range(10,0,-1):
    marker='## Architecture and trust boundaries' if i==10 else '### CR-'+str(i+1).zfill(3)+' —'
    idx=s.index(marker);s=s[:idx]+extra[i]+'\n'+s[idx:]
new=f'''### CR-011 — Retained SwiftUI ADIF export silently stops at the 2,000-row view cap

**Medium — incomplete interchange file from an unfiltered logbook export.
Confidence: high. Verification: exact production export method, real SQLite/core,
native chooser and surrounding model scaffolding substituted.**

Locations: [AppModel.swift:1015]({R}/Sources/XLogApp/AppModel.swift:1015),
`exportADIF`, and `reload/searchChanged` at406/419.
The array being exported is loaded with `database.fetch(limit: 2_000, search: search)`.
The exporter serializes only `qsos`; it never requests remaining contacts. Both
the toolbar at `WorkspaceViews.swift:31` and application menu at
`OM0RXXLogApp.swift:55` call this method with an unscoped “Export ADIF…” label.
No cap warning, explicit current-page scope or follow-up page load was found.

Reproduction: a disposable database contains2,003 contacts and an empty search.
The actual reload query loads2,000; the extracted unchanged export method writes
2,000 records and reports “Exported 2000 QSOs”, omitting3. This survives a possible
filtered-export interpretation because the reproduction is unfiltered. The count
banner reports what was written but does not disclose incomplete database coverage.
Source contacts remain intact; this is incomplete export, not database deletion.
The modern React/Tauri exporter uses a separate frozen-snapshot/page contract and
is not implicated. {link('root/legacy-methods.json','Results')} and
{link('root/prepare_legacy_method_probe.py','exact-source fixture generator')}.

**Fix:** choose and disclose the intended export scope, freeze the matching database
set and serialize all bounded pages independently of the view's display limit.
**Regression:** unfiltered and explicitly filtered logs above2,000 contacts,
including exact boundary, export count/identity equality and safe cancellation.

### CR-012 — ADX export emits deprecated field names outside its declared schema

**Medium — schema-enforcing consumers can reject an ordinary export containing
retained older fields. Confidence: high for vocabulary mismatch; exact validator
limitations are explicit below.**

Locations: [adifTransfer.ts:93]({R}/prototype/src/live/adifTransfer.ts:93),
`:106`, `ADIFExportDocument.append:354` and `finish:393`.
The `standardADXFields` set includes `GUEST_OP` and `VE_PROV` and writes them as
literal RECORD child elements while declaring ADIF3.1.7. Neither name appears in
the179 allowed RECORD element names of the [official3.1.7 XSD](https://adif.org/317/adx317.xsd);
the application set contains181, with exactly these two extras. Imported extra
fields survive `QSO.adifRecord` (`QSOADIF.swift:145–147`), so the export route is reachable.
The default USERDEF preservation path and metadata guards do not run for these
names because they are incorrectly classified as standard.

Actual writer fixtures produce NAME (control), GUEST_OP and VE_PROV documents.
All roundtrip through the app's decoder, explaining why mirrored acceptance tests
miss the mismatch. Root independently retrieved identical official bytes:
SHA-256 `ce7a86832f7be4a232d2c1ae7432925feb2be8506cba24345b7e3ad994a87331`.
Exact original-XSD validation with xmllint is **blocked at schema compilation** by
an unrelated New Zealand regex lookahead, including for NAME. A derived schema
removing exactly that unused pattern facet, without changing any field declaration,
validates NAME and rejects both legacy elements. None of these fixtures uses the
relaxed subdivision field. This is bounded structural validation, not an unqualified
original-XSD validation pass; direct name comparison uses the original schema.
See {link('frontend/schema-check.json','vocabulary comparison')},
{link('frontend/schema-validation-results.json','original validator failure')} and
{link('root/schema-independent.log.txt','independent bounded validation')}.

Original contacts are retained. ADI is a fallback for applicable records; no external
consumer rejection was exercised. **Fix:** use the declared ADX version's exact
vocabulary and a deliberate lossless conversion/extension policy for deprecated
fields; do not silently discard them. **Regression:** independent official-schema
vocabulary oracle, both legacy fields, valid standard/USERDEF controls and explicit
version/conversion behavior, rather than writer/reader roundtrip alone.

'''
s=s.replace('## Architecture and trust boundaries',new+'## Architecture and trust boundaries',1)
s=s.replace('## Checks and actual results','## First-pass checks and actual results',1)
s=s.replace('Complete ADX/export codecs remain partial.','The completed codec pass adds CR-012; retained SwiftUI export adds CR-011.')
s=s.replace('## False-positive audit and verification limits',f'''## Second-pass checks and actual results

These checks ran against unchanged application source at12824393. Full suites,
build/audits and the97-definition lifecycle sweep above are **first-pass** results;
they were not repeated or replaced by focused successes.

| Check / command | Actual result and limit |
| --- | --- |
| `git fetch origin main`; fast-forward-only merge; source diff4bd554a→12824393 | Already current; clean start; application diff empty. |
| `XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/prototype-tests --no-parallel --filter OperatorDraftTests` | PASS12. Existing suite misses manual Save. |
| Same command, `--filter "RemoteBackup(Owner\u007cScheduler\u007cAuthorization\u007cRetentionReview)"` | PASS37 in4 suites,0.944s. Earlier narrower selector ran only8 retention tests; not counted as additional unique tests. Fake sources/executors, no cloud operation. |
| Configured real-Host `verify_contracts.py` with Python3.12 | PASS defect/control assertions, independently rerun; authority baseline, full compared-table rollback, receipt/reopen and mode/export checks. System Python3.9 initially failed importing UTC before the probe; corrected interpreter, preserved setup failure. |
| Focused existing Python tests listed in {link('contest/commands-and-results.md','command record')} | PASS41,19.224s; whole537-test suite not repeated. |
| Five existing frontend codec/logbook/draft/contact/mutation files | PASS1408; all five files listed in frontend verification record. |
| Strengthened isolated React/writer/submit checks, independent `-t VERIFY` rerun |3 expected regression failures (CR-008 twice, CR-010 radio),6 passes (amp control,3 writer fixtures,2 modeled submit probes),45 skipped. Failures assert intended behavior; passes generating invalid XML are not product-correctness claims. |
| Actual compiled Swift registry/fldigi probes | PASS counterexample assertions, root independently rerun. Production objects linked into temporary module; no neighboring actor stubs. |
| Routed TCI loopback resource; actual-source offline Rust recorder | PASS bounded counterexample assertions. Handshake/close only; synthetic PCM, no physical device/playback. |
| Exact service Save/reopen and extracted legacy methods | PASS counterexample assertions; actual service has no stubs, legacy methods have declared chooser/model scaffolding. |
| Official ADX schema retrieval, original/derived structural checks | Identical schema hashes. Original xmllint compile blocked; original-name comparison plus bounded one-facet-derived validation confirms two unsupported tags. |

All sources/results and exact build/interpreter commands are in
{link('README.md','the second-pass evidence index')}. First-pass timing failures,
missing cargo-audit, provider limits and setup diagnostics remain visible.

## False-positive audit and verification limits''',1)
s=s.replace('- Earlier R01–R08 review repairs',f'''- The broad active-output module-switch interpretation of CR-002 was corrected:
  the actual idle veto prevents that trigger. The wrong lifecycle owner remains
  reachable through ordinary Quit/EOF and is independently reproduced.
- A new suspected duplicate-update extension-sidecar loss was rejected for the
  exposed route: renderer/native editable-field whitelists exclude arbitrary
  APP/USERDEF names, and the planner retains/validates target metadata. A direct
  helper accepting arbitrary names is insufficient to establish caller reachability.
- The main-submit automatic timestamp/provenance mismatch is recorded as a joint
  CR-001/008 remediation dependency, not counted as a third timestamp finding.
- Backup sidecar-removal concerns were not promoted: reviewed restore callers
  close the database first; staged verification/rollback remains present. Complete
  crash/transport/provider combinations remain open.
- Earlier R01–R08 review repairs''',1)
s=s.replace('Correct CR-010\'s source label.',"Correct CR-010's source label. Repair the retained exporter cap (CR-011) and\n    ADX vocabulary/conversion policy (CR-012) with independent export oracles.")
s=s.replace('separate from the ten defects above.','separate from the twelve defects above.')
p.write_text(s)

p=R/'REVIEW_COVERAGE.md';s=p.read_text()
s=s.replace('# Full application review coverage — 28 October 2026','# Full application review coverage — verified 29 October 2026',1)
s=s.replace('executes broad checks and records ten substantiated defects.','retains first-pass broad checks, deepens selected workflows and records twelve\nsubstantiated defects after second verification.',1)
s=s.replace('Reviewed source: clean canonical `main` at `4bd554a25951ddc995b4bef1715d3df12918a07b`.','Verification baseline: clean canonical `main` at\n`12824393f2799f21c223fadcb19d03305a5bf2f8`; application source is unchanged from\n`4bd554a25951ddc995b4bef1715d3df12918a07b`.',1)
s=s.replace('full-code-review-2026-10-28/REVIEW_INVENTORY.tsv','full-code-review-verification-2026-10-29/REVIEW_INVENTORY.tsv',1)
s=s.replace('| 87 | 81 |','| 100 | 94 |').replace('| 79 | 72 |','| 93 | 86 |').replace('| 1,435 | 1,434 |','| 1,410 | 1,408 |').replace('| 617 | 25 |','| 615 | 24 |')
anchor='Scope taxonomy: 1,614 source/test/config/tooling files'
s=s.replace(anchor,f'''Second-pass manual inspection revisited **70 distinct baseline files**, changing
the cumulative depth of30. Fully reviewed files increased87→100; partial79→93;
scan-only1,435→1,410; unreviewed617→615. Depth never increases merely because a
suite ran. Exact merges and unchanged-depth observations are in
{link('coverage-merge.json','coverage-merge.json')}; baseline counts and denominator
are retained in {link('coverage-summary.json','coverage-summary.json')}.
The62 first-pass review-only files already tracked at12824393 and all new review
artifacts are outside this frozen2,347-file application/support denominator.
The [original ledger]({R}/docs/reviews/full-code-review-2026-10-28/REVIEW_INVENTORY.tsv)
and first-pass evidence remain unchanged.

{anchor}''',1)
s=s.replace('Most controllers/windows/settings/maps/awards/propagation/codecs/tests remain scan-only','Most controllers/windows/settings/maps/awards/propagation/tests remain scan-only')
s=s.replace('selected import/sync/contest/time paths; actual React probes, full tests, build/audit and limited reruns','selected import/sync/contest/time paths; second pass completes ADIF/ADX codec and LogbookPanel source reads, rechecks canonical remounts, metadata whitelists and contact/draft reconciliation; 1408 focused tests pass')
s=s.replace('fake-RPC probe | Complete FLEX/TCI','real-module eight-case fake-RPC matrix and loopback TCI connection through worker shutdown | Complete FLEX/TCI')
s=s.replace('selected rollback/revision/serial/concurrency/snapshot tests; Swift suites pass','selected rollback/revision/serial/concurrency/snapshot tests; first-pass Swift suites pass')
s=s.replace('Full joins/fingerprints/service contracts and failure matrix; no live accounts','Remaining service/fingerprint/failure combinations; ADIF/JSON join/matching571–764 now inspected; no live accounts')
s=s.replace('Full authorization/retention/retry/restore owner and all transports','Core authorization, scheduler, snapshot owner and retention/deletion coordinator now fully read; host/transport/retry/restore combinations remain partial')
s=s.replace('Host validators, overlays, multipliers/analytics/message/strategy tails and test assertions','Continued setup/engine/new-state/exchange validators and overlay ranges; multipliers.py fully read. Full Host/upstream, analytics/message/strategy tails and remaining test assertions still open')
s=s.replace('actual core import-loop probe','exact import/export method probes with chooser/model scaffolding; unfiltered export cap and nil-database import success confirmed')
s=s.replace('Bounded reviewer records are preserved in `subreviews/`; root CR IDs supersede',f'''Second-pass records are preserved under
{link('README.md','the verification evidence index')} in `frontend/`, `native/`,
`contest/` and `root/`, with separate per-file increments. First-pass bounded
reviewer records remain in the original `subreviews/`; root CR IDs supersede''',1)
s=s.replace('Full outputs, including failures, are in `checks/`; commands are in the evidence','First-pass full outputs, including failures, remain in the original `checks/`; commands are in the evidence',1)
s=s.replace('Exact remaining work, in order:',f'''Second-pass focused outcomes: Swift draft12/12 and backup policy37/37 pass;
Python41/41 and frontend1408/1408 existing tests pass. Actual service/Host/native
counterexamples persist through the stated replay/reopen controls. React intended
behavior still has3 expected failures;6 fixture/control checks pass in the combined
independent run. Official ADX bytes were retrieved twice with identical SHA256;
exact xmllint validation is blocked by an unrelated schema regex, and the bounded
derived-schema limitation is explicit in CR-012. No full suite/build/audit was
repeated. No focused result erases the initial full frontend timeout failures.

New full text coverage includes ADIF/ADX codec, LogbookPanel, native draft power
gate, Python multipliers, historical-import UI, backup authorization/scheduler/
snapshot owner/retention coordinator and selected test-oracle files. Continued
partial coverage includes SyncEngine join/matching, BackupManager restore/envelope
and SQLite boundaries, native provider retirement/watchdog/recorder consumption,
Host authority/exchange/overlays and retained SwiftUI orchestration. The ledger
is authoritative about exact files/ranges; this is not a full line-by-line second
read of every file previously marked fully reviewed.

Exact remaining work, in order:''',1)
s=s.replace('ADIF/ADX/export metadata, detached','remaining import/export integration and independent schema oracles (codec source now full), detached')
s=s.replace('Full joins/fingerprints','Remaining joins/fingerprints')
p.write_text(s)

(E/'README.md').write_text(f'''# Second code-review verification — 29 October 2026

Baseline: clean canonical main12824393f2799f21c223fadcb19d03305a5bf2f8;
application unchanged from4bd554a25951ddc995b4bef1715d3df12918a07b.
Work spanned28–29 October Australia/Darwin. Scratch names retain the start date.
No application, existing test, dependency or configuration file was modified.
No GUI/installed app, production logbook, credentials, real radio or account was used.
TCI used a disposable loopback WebSocket; recorder used synthetic PCM only.

The reports are [CODE_REVIEW.md]({R}/CODE_REVIEW.md) and
[REVIEW_COVERAGE.md]({R}/REVIEW_COVERAGE.md). Ten original findings survive;
CR-002's module-switch interpretation is narrowed. Two new export findings add
up to12 (2 High,9 Medium,1 Low). Whole-codebase semantic review remains incomplete.

- `REVIEW_INVENTORY.tsv`: cumulative exact2,347 baseline paths, with separate manual-depth and check notes.
- `coverage-summary.json`, `coverage-merge.json`: counts,70 distinct newly inspected paths,30 depth changes, and context/execution-only observations that do not upgrade depth.
- `provenance.json`: exact HEAD, empty application diff and unchanged first-pass evidence.
- `root/`: actual service/manual-time, exact legacy method extraction, independent reruns, focused Swift logs, and original schema second retrieval.
- `frontend/`: real React/writer fixtures, original/derived official schema, complete codec vocabulary comparison, existing focused tests, disposition and range records.
- `native/`: actual-object Swift linking metadata and scripts, actor/loopback/actual Rust-store probes, matrices, selected Cargo manifest/lock and ranges.
- `contest/`: configured real Host fixtures, authoritative admission/rollback/replay results,41 existing focused tests, command log and coverage increments.
- `copy-manifest.json` maps exact scratch sources to committed readable copies; `SHA256SUMS` covers all durable artifacts except itself.

First-pass evidence in `../full-code-review-2026-10-28/` is immutable and remains
the source of full-suite/build/audit and97-contest results. No full suites were
repeated in this pass. Counts overlap prior suites; they are not unique coverage.

## Reproducing the bounded checks

Scripts preserve exact original scratch/source coordinates. On the same checkout,
copy the relevant committed area contents to
`/tmp/xlog-review-verification-20261028-12824393/AREA` before rerunning. Builds and
runtime fixture stores/binaries are intentionally excluded. Existing dependencies
and normal Swift production objects from the documented first-pass portable build
are prerequisites; no installation is part of these probes. The native builder
records object hashes and exact linking flags. Do not run fixture scripts in a
production data directory.

Root commands, from the repository root:

```sh
XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/prototype-tests --no-parallel --filter OperatorDraftTests
XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/prototype-tests --no-parallel --filter 'RemoteBackup(Owner|Scheduler|Authorization|RetentionReview)'
python3.12 -B /tmp/xlog-review-verification-20261028-12824393/contest/verify_contracts.py
python3.12 -B /tmp/xlog-review-verification-20261028-12824393/root/prepare_legacy_method_probe.py
```

The last command extracts actual method bodies; it does not modify app code.
Swift service/legacy probes and native actor probes use:

```sh
swift -I .build/prototype-tests/debug -I Sources/CSQLitePrototype -I /tmp/xlog-review-verification-20261028-12824393/native -L /tmp/xlog-review-verification-20261028-12824393/native -lReviewNative -Xlinker -rpath -Xlinker /tmp/xlog-review-verification-20261028-12824393/native SCRIPT.swift
```

The configured Host probe needs the retained pinned WAE HTML; it does no network
retrieval. Contest command record lists the41-test command. Frontend command record
lists the five1408-test files; root's combined independent rerun from `prototype/`:

```sh
node node_modules/vitest/vitest.mjs run --config /tmp/xlog-review-verification-20261028-12824393/frontend/vitest-verification.config.ts --testNamePattern VERIFY
python3.12 -B /tmp/xlog-review-verification-20261028-12824393/frontend/validate_schema_structure.py
```

Expected combined React outcome:3 preservation/label assertion failures,6 passes,
45 skipped. Fixture scripts asserting observed counterexamples exit0; this does
not mean product behavior is correct. The exact native build, loopback, recorder
and object-hash commands are retained in `native/verification-matrix.md` and JSON.

## Evidence boundaries and log format

Chooser/model scaffolding substitutes native UI only for the extracted legacy
methods; core/SQLite are actual modules. Actual service timestamp uses no stubs.
fldigi substitutes RPC/receiver only. TCI fake server completes a real handshake
without radio commands; socket closure on eventual process exit is not disputed.
Recorder imports unchanged application store source into an offline test package.

Official ADX3.1.7 XSD SHA256:
`ce7a86832f7be4a232d2c1ae7432925feb2be8506cba24345b7e3ad994a87331`.
Original xmllint compilation fails on an unrelated NZ regex even for the control;
derived validation removes just that unused facet, preserving field declarations.
Original-schema name comparison independently confirms the two unsupported tags.

Scratch `.log`/`.stderr` captures are committed as `.log.txt`/`.stderr.txt` with
ANSI removed, plus exact raw bytes in the matching `.txt.gz`. Reviewer documents
refer to original capture names; append `.txt` when opening durable copies. Raw
hashes in child manifests refer to original bytes; `copy-manifest.json` and root
`SHA256SUMS` identify durable copies. Setup failures, original validator blockage
and expected assertion failures are retained. No personal/runtime stores or audio
are committed. Complete provider, installed native UI, RF, physical audio, crash/
power-loss, sponsor currency and whole-repository semantic coverage remain open.
''')
print('Updated both reports and evidence README')
