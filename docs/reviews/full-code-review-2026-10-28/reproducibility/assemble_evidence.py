from pathlib import Path
import collections, csv, gzip, hashlib, json, re, shutil, subprocess

ROOT=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
TMP=Path('/tmp/xlog-review-20261028-4bd554a')
OUT=ROOT/'docs/reviews/full-code-review-2026-10-28'
OUT.mkdir(parents=True,exist_ok=True)
inventory=json.loads((TMP/'inventory.json').read_text())
rank={'not reviewed':0,'scanned only':1,'partially reviewed':2,'fully reviewed':3,'excluded':-1}
by_path={r['path']:r for r in inventory}
patterns={
 'execution-boundary':r'\b(?:eval|exec|system|popen)\s*\(|shell\s*=\s*True|Command::new|Process\(\)',
 'swallowed-or-fatal-error':r'try\?|try!|fatalError\(|except\s*(?:Exception)?\s*:',
 'sql-write-or-schema':r'INSERT |UPDATE |DELETE FROM |CREATE TABLE|BEGIN IMMEDIATE|ROLLBACK',
 'sensitive-storage-or-log':r'(?:password|token|secret|credential).*(?:print|log|write|persist)|(?:print|log).*(?:password|token|secret|credential)',
 'renderer-trust-boundary':r'dangerouslySetInnerHTML|innerHTML\s*=|window\.open|postMessage|localStorage',
}
hits=[]
extensions={'.swift','.rs','.c','.h','.py','.ts','.tsx','.mjs','.js','.sh','.ps1','.toml','.yml','.yaml'}
for row in inventory:
    path=row['path']; p=ROOT/path
    if row['scope'].startswith('vendored'):
        row.update(status='excluded',note='Vendored implementation excluded from routine manual audit; boundary/provenance checked separately')
    elif row['scope']=='first-party source/test/config/tooling' and p.suffix in extensions:
        try:s=p.read_text()
        except (OSError,UnicodeDecodeError):continue
        row.update(status='scanned only',note='Whole-file structural/pattern scan; no semantic completeness claim')
        for number,line in enumerate(s.splitlines(),1):
            for category,pat in patterns.items():
                if re.search(pat,line):hits.append((path,number,category))
    else:row['note']='Inventoried; no substantive manual review unless overridden below'
for owner in ['frontend','native','contest']:
    for entry in json.loads((TMP/owner/'coverage.json').read_text()):
        path=entry['path']; r=by_path.get(path)
        if not r:continue
        status=entry['status']
        if rank[status]>=rank[r['status']] or status=='excluded' and r['status']=='not reviewed':
            r['status']=status
            r['note']=f"{owner}: "+str(entry.get('depth',entry.get('detail','')))
            r['checks']=entry.get('checks',[])
full={
 'AGENTS.md':'Entire repository instructions',
 'docs/DEVELOPMENT_WORKFLOW.md':'All workflow and isolation requirements',
 'Package.swift':'All target/platform/dependency declarations',
 'prototype/package.json':'Scripts and dependencies',
 'Sources/XLogCore/OperatorDraft.swift':'Entire metadata/validation/mutation contract',
 'Sources/XLogCore/BackupEnvelope.swift':'Entire seal/capture/materialize boundary',
 'Sources/XLogCore/SecretStore.swift':'Entire cache, presence, load and mutation paths',
 'Sources/XLogCore/RemoteBackupLocalAdapters.swift':'Entire snapshot/tick adapter',
 'Sources/XLogCore/RemoteBackupHostDriver.swift':'Entire start/stop/advance lifecycle',
 'Sources/XLogCore/LoTWConfirmationDownload.swift':'Entire request/response planning; no provider request',
 'Sources/XLogCore/WeatherClient.swift':'Entire request/decode/condition mapping',
 'Sources/CCurlBackup/CCurlBackup.c':'Entire curl upload/download/TLS/size handling',
 'prototype/scripts/package-macos.sh':'Entire staging, provenance, signing recipe; not executed',
 'prototype/scripts/install-macos.sh':'Entire preserved-install/rollback recipe; not executed',
 'scripts/package-app.sh':'Entire legacy packaging recipe; not executed',
 'prototype/src-tauri/Cargo.toml':'All dependencies/features/platform/build declarations',
 'prototype/src-tauri/tauri.conf.json':'Entire config, CSP, versions and external bins',
 'prototype/src-tauri/capabilities/default.json':'Entire default window permissions',
 'prototype/src-tauri/Recorder.entitlements':'Entire entitlement declaration',
 'Resources/Info.plist':'Entire legacy bundle metadata',
 'Resources/OM0RXXLog.entitlements':'Entire legacy entitlement declaration',
 'docs/contesting/WAE_2026_RULE_REFERENCE.json':'All retained source identity and scope metadata',
}
partial={
 'README.md':'Architecture/intended journeys; stale release descriptions treated as historical',
 'PROJECT_STATUS.md':'1-110 historical status; not used as current installed acceptance',
 'prototype/README.md':'Architecture/build/isolation guidance; historical claims separated',
 'python/README.md':'Wire/mutation/import/export contracts',
 'docs/reviews/CODE_REVIEW_2026-10-28.md':'1-145 prior repaired findings checked for duplicates',
 '.github/workflows/ci.yml':'Native job/packaging commands',
 '.github/workflows/prototype.yml':'Mac-default job, tests, packaging conditions, runtime stages',
 '.github/workflows/contest-portability.yml':'Trigger/platform/generator/native test jobs, especially240-360',
 'Sources/XLogCore/LogbookDatabase.swift':'1-180,379-447,1870-1982,2440-2520,3060-3235,3577-3875,3920-4034; draft save, schema, sync/import/merge; executable SQLite probes',
 'Sources/XLogCore/SyncEngine.swift':'1-365 snapshot/preflight;365-605 mutation/ack/readback;760-1016 mapping/verification; omitted join internals incomplete',
 'Sources/XLogCore/BackupManager.swift':'Create/inspect/install/rollback/envelopes/SQLite functions across1-666; compressed windows omitted sections, so partial',
 'Sources/XLogCore/ADIF.swift':'85-420 parser/export/preview and type validation; remaining planning incomplete',
 'Sources/XLogCore/QSOADIF.swift':'1-145 dates/frequencies/import/backfill; export tail incomplete',
 'Sources/XLogCore/IntegrationWorkspace.swift':'1-170 bootstrap identity/copy/staging',
 'Sources/XLogCore/WavelogClient.swift':'1-315 configuration/decoding/body types;483-698 requests/response validation',
 'Sources/XLogCore/Settings.swift':'1-145 defaults/integration revision validation',
 'Sources/XLogCore/Models.swift':'1-140 model/identity/defaults',
 'Sources/XLogCore/FTPBackupTransport.swift':'1-200 credentials/curl bridge/upload reservation',
 'Sources/XLogCore/OneDriveBackupHTTPClient.swift':'1-155 fixed-origin/TLS/redirect/stream/cancellation',
 'Sources/XLogCore/LoTWConfirmationPreview.swift':'Selected preview/match/revalidation windows across1-160; compressed omissions',
 'Sources/XLogCore/SpotHistoryDatabase.swift':'150-270 opening/schema/migration/append validation',
 'Sources/XLogCore/ReferenceDataUpdater.swift':'1-185 source identities;355-610 download, validation, cache replacement; complete refresh/gunzip not reviewed',
 'Sources/XLogCore/OnlineLogDelivery.swift':'1-160 plans/enrollment/receipts/follow-up projection',
 'Sources/XLogApp/AppModel.swift':'1-185 forms;968-1168 import/restore; native chooser not invoked',
 'Sources/XLogApp/LogQSOView.swift':'1-130 explicit UTC editor/input controls',
 'Sources/XLogPrototypeSupport/LiveLogbookMethods.swift':'1000-1138 import/export;1380-1625 backup/restore;1645-1775 generation/rollback',
 'prototype/scripts/stage-hamlib-macos.sh':'1-130 pinned hashes, build isolation, cache recipe, dependencies',
 'python/vendor/not1mm/source-manifest.json':'Pinned revision and corpus/hash boundary; source bodies excluded',
 'vendor/deepcw-engine/manifest.json':'Model/engine/runtime provenance declarations; incomplete independent verification',
}
for status,items in [('fully reviewed',full),('partially reviewed',partial)]:
    for path,note in items.items():
        if path in by_path:
            r=by_path[path]
            if rank[status]>=rank[r['status']]:r.update(status=status,note='root: '+note)
            else:r['note']+='; root: '+note
for row in inventory:
    p=row['path']
    checks=row.get('checks',[])
    if isinstance(checks,str):checks=[checks]
    if p.startswith('Tests/') and p.endswith('.swift'):checks.append('Swift suite executed; see exact target/platform results, not manual coverage')
    if p.startswith('python/tests/') and p.endswith('.py'):checks.append('Python discover executed537 tests; execution is not manual coverage')
    row['checks']=checks
with (OUT/'REVIEW_INVENTORY.tsv').open('w') as f:
    w=csv.writer(f,delimiter='\t',lineterminator='\n');w.writerow(['path_relative_to_reviewed_root','lines','bytes','scope','depth','inspection_note','checks'])
    for r in inventory:w.writerow([r['path'],r['lines'],r['bytes'],r['scope'],r['status'],r['note'],'; '.join(r['checks']) or '-'])
with (OUT/'SCAN_HITS.tsv').open('w') as f:
    w=csv.writer(f,delimiter='\t',lineterminator='\n');w.writerow(['path','line','pattern_category']);w.writerows(hits)
counts=collections.Counter(r['status'] for r in inventory)
source_counts=collections.Counter(r['status'] for r in inventory if r['scope']=='first-party source/test/config/tooling')
summary={'source':'4bd554a25951ddc995b4bef1715d3df12918a07b','root':str(ROOT),'totalFiles':len(inventory),'depthCounts':dict(counts),'firstPartyDepthCounts':dict(source_counts),'scopeCounts':dict(collections.Counter(r['scope'] for r in inventory)),'patternHits':len(hits)}
(OUT/'coverage-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
copies={
 'inventory.py':'reproducibility/inventory.py','assemble_evidence.py':'reproducibility/assemble_evidence.py','check_reports.py':'reproducibility/check_reports.py',
 'frontend/coverage.json':'subreviews/frontend-coverage.json','native/coverage.json':'subreviews/native-coverage.json','contest/coverage.json':'subreviews/contest-coverage.json',
 'contest/validation-summary.json':'checks/contest-validation-summary.json',
 'repro_manual_time.swift':'reproductions/repro_manual_time.swift','repro_manual_time.json':'results/repro_manual_time.json',
 'repro_core_interpreted.swift':'reproductions/repro_core_interpreted.swift','repro_core.json':'results/repro_core.json',
 'swift-native.log':'checks/swift-native.txt','swift-portable.log':'checks/swift-portable.txt',
 'frontend/FRONTEND_REVIEW.md':'subreviews/frontend.md','native/native-review.md':'subreviews/native.md','contest/CONTEST_REVIEW.md':'subreviews/contest.md',
 'frontend/npm-test.log':'checks/npm-test.txt','frontend/npm-build-cli.log':'checks/npm-build.txt','frontend/npm-audit.json':'checks/npm-audit.json',
 'frontend/voice-intent-rerun.log':'checks/frontend-two-test-rerun.txt','frontend/not1mm-file-rerun.log':'checks/frontend-file-rerun.txt',
 'frontend/root-final-ui-repro.log':'results/root-ui-reproductions.txt',
 'frontend/prepare_repro.py':'reproductions/frontend/prepare_repro.py','frontend/detached-time.test.tsx':'reproductions/frontend/detached-time.test.tsx','frontend/vitest-review.config.ts':'reproductions/frontend/vitest-review.config.ts',
 'native/cargo-test-cli.log':'checks/cargo-test.txt','native/root-fldigi-repro.log':'results/root-fldigi-repro.txt',
 'native/fldigi_core_stubs.swift':'reproductions/fldigi/fldigi_core_stubs.swift','native/fldigi_stubs.swift':'reproductions/fldigi/fldigi_stubs.swift','native/fldigi_repro.swift':'reproductions/fldigi/fldigi_repro.swift','native/make_fldigi_script.py':'reproductions/fldigi/make_fldigi_script.py',
 'contest/python-tests.log':'checks/python-tests.txt','contest/all-contests-readiness.json':'checks/all-contests-readiness.json','contest/all-contests-readiness.log':'checks/all-contests-readiness.txt',
}
for name in ['repro_recorder_esm','repro_wae_call_area','repro_import_shared_serial','repro_import_replica']:
    copies[f'contest/{name}.py']=f'reproductions/{name}.py';copies[f'contest/{name}.json']=f'results/{name}.json'
for source,target in copies.items():
    src=TMP/source;dst=OUT/target
    if src.exists():
        dst.parent.mkdir(parents=True,exist_ok=True)
        if src.suffix=='.log' and dst.suffix=='.txt':
            original=src.read_bytes()
            dst.with_suffix('.txt.gz').write_bytes(gzip.compress(original,mtime=0))
            text=original.decode('utf-8',errors='replace')
            dst.write_text('\n'.join(line.rstrip() for line in text.splitlines()).rstrip()+'\n')
        else:shutil.copyfile(src,dst)
(OUT/'SOURCE_INDEX.txt').write_bytes(subprocess.check_output(['git','ls-tree','-r','4bd554a25951ddc995b4bef1715d3df12918a07b'],cwd=ROOT))
hashes=[]
for p in sorted(OUT.rglob('*')):
    if p.is_file() and p.name!='SHA256SUMS':hashes.append(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(OUT)}')
(OUT/'SHA256SUMS').write_text('\n'.join(hashes)+'\n')
print(json.dumps(summary,indent=2))
print('Pattern categories:',dict(collections.Counter(x[2] for x in hits)))
