from pathlib import Path
import collections, datetime, gzip, hashlib, json, re, shlex, shutil, sqlite3, subprocess

root = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
task = Path('/tmp/xlog-phase4-20261029-26f795cb')
out = root/'docs/reviews/regression-2026-10-29'
assert not out.exists(), 'Evidence destination must be new'
results = json.loads((task/'results.json').read_text())
assert not results['applicationFilesChanged']
assert subprocess.check_output(['git','status','--porcelain=v1'],cwd=root,text=True).strip() == ''
assert not [p for p in (task/'logs').glob('*.running.json') if not p.with_name(p.name.replace('.running.json','.json')).exists()]

findings = json.loads((task/'findings.json').read_text())
findings[0]['evidence'] += ['logs/FRONTEND-STANDARD-BUILD.json','logs/FRONTEND-STANDARD-BUILD.log','logs/CLEAN-NPM-STANDARD.json','npm-lifecycle-comparison.json','frontend-ref-530de4c4.json','frontend-ref-875b5254.json','frontend-ref-26f795cb.json','logs/ORIGINAL-TREE-BUILD.json','dependency-tree-comparison.json']
findings[0]['independentControl'] = 'Current source with restored original pnpm dependencies passes at405194; clean committed npm dependencies fail at405218. Ordinary and ignore-scripts npm installs have8907 matching installed-file hashes with no content changes. Budgets and expected results were never changed.'
findings[0]['trackerDisposition'] = 'CR-008 build/integration verification reopened as Fixed but Unverified; original manual-time preservation tests still pass. CR-001 native functional status remains verified.'
findings[2]['evidence'] += ['logs/WORKER-BOOTSTRAP-R2.json','logs/WORKER-BOOTSTRAP-R2.log','worker-bootstrap-r2/evidence/acceptance.json']
(task/'findings.json').write_text(json.dumps(findings,indent=2)+'\n')

investigations = [
 {'id':'INV-P4-001','status':'Unresolved repeated acceptance failure; no confirmed production UI defect or remediation attribution',
  'title':'NAQP simulated CQ is absent in the first CW Run browser case',
  'observations':'Three independent runs fail accept-contest-naqp-operator-browser.mjs:299 after the unchanged10-second polling loop: actual[] versus expected[CQ]. Both clean-npm runs and the original-pnpm control have19 worker frames and zero simulated-output callbacks; later planned cases are not reached.',
  'context':'Last draft is20m/14.05MHz/CW with canSendCQ=true. The simulation branch calls a browser callback directly; no native operator RPC is required. Arming, keyboard focus and edit-generation/context retirement remain possible causes; no guard or expected result was changed.',
  'origin':'Examined NAQP script, operator UI path and npm lock are unchanged since530de4c4. Historical UI execution was not performed, so pre-existing status is not proved. Failure with both dependency trees rules out a failure confined to the clean npm tree, but does not establish the cause.',
  'recommendation':'Capture the arm/context/edit-generation state at Enter and the simulation callback in the isolated harness. Establish whether a legitimate context update clears the arm or the event fails to reach admission. Preserve fail-closed output guards. Then rerun all six cases against the current production-engine fixture.',
  'evidence':['browser-naqp/evidence/acceptance.json','browser-naqp-r2/evidence/acceptance.json','browser-naqp-original-tree/evidence/acceptance.json'],
  'limits':'Legacy Swift typed contest backend, headless Vite UI only. No native window, packaged Python engine, audio, radio or RF. No video was collected; this is an unresolved acceptance failure, not a claimed interactive production-radio reproduction.'},
 {'id':'INV-P4-002','status':'Resource boundary observation; overload stability remains unqualified',
  'title':'CW synthetic pacing misses its deadline under concurrent build load',
  'observations':'The first requested60-second profile reports stable_under_this_synthetic_load=false despite exit0. It stops at5.504 seconds when its250ms lateness bound is exceeded (255.246ms), with zero inferred tracks. The unchanged instrument intentionally breaks on that bound. An identical rerun after compiler work finishes delivers60 seconds, eight inferred tracks and stable=true.',
  'origin':'No production defect or remediation regression established. Do not erase the first observation or use exit0 as semantic success.',
  'recommendation':'Retain a controlled CPU-contention/long-soak qualification for future acceptance, including whole-app responsiveness, queue bounds and explicit degraded status. The60-second idle-load pass alone is insufficient.',
  'evidence':['logs/CW-SUSTAINED-60S.log','logs/CW-SUSTAINED-60S-R2.log','native/cw-worker/load_profile.cpp:83-112']}
]
(task/'open-investigations.json').write_text(json.dumps(investigations,indent=2)+'\n')

incidents=json.loads((task/'collector-incidents.json').read_text())
incidents['otherIncidents'] += [
 {'id':'CONTEST-GENERATOR-TESTS','result':'Initial invocation lacked required CONTEST_SW_ROOT and used Python3.12:42 tests,12 fixture-setup failures. Correctly configured Python3.14 rerun passes42/42 and independently verifies the exact pinned upstream corpus. No expected results changed.'},
 {'id':'fixture restoration preflight','result':'A preflight assertion initially compared /private/tmp with /tmp lexically and stopped before any mutation. Comparing both canonical paths allowed identity-checked restoration; original fixture inodes and all180 dist hashes match.'},
 {'id':'QUERY-BENCHMARK-COPY','result':'SwiftPM waited for the preceding same-scratch performance run. The test body took0.147s; the76.353s command duration includes lock waiting. Its disposable browser-workspace copy has0 normal-log QSOs; this is empty-log behavior, not a large-log measurement.'}
]
(task/'collector-incidents.json').write_text(json.dumps(incidents,indent=2)+'\n')

spans = {
 'Sources/XLogPrototypeSupport/LiveOpportunitiesMethods.swift':[(30,52)],
 'Sources/XLogPrototypeSupport/LiveWorker.swift':[(48,63),(180,200)],
 'Sources/XLogPrototypeSupport/Contesting/PythonContestLane.swift':[(20,95)],
 'prototype/scripts/accept-contesting-worker-process.mjs':[(1,125)],
 'prototype/scripts/accept-contest-naqp-operator-browser.mjs':[(270,305)],
 'prototype/src/contesting/ContestOperatorPanel.tsx':[(160,220),(285,303)],
 'prototype/src/contesting/operatorFlow.ts':[(265,295)],
 'Sources/XLogCore/SyncEngine.swift':[(305,320),(400,450)],
 'prototype/src-tauri/src/hf_propagation.rs':[(60,83)],
 'native/cw-worker/load_profile.cpp':[(75,115)]}
snippets = {}
for name,ranges in spans.items():
 path=root/name
 if not path.exists():
  # SyncEngine belongs to the prototype support target in this checkout.
  if name.endswith('/SyncEngine.swift'):
   found=list((root/'Sources').rglob('SyncEngine.swift')); assert len(found)==1
   path=found[0]; name=str(path.relative_to(root))
  else: raise FileNotFoundError(name)
 lines=path.read_text().splitlines()
 snippets[name]={'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
   'unchangedSincePreRemediation':subprocess.run(['git','diff','--quiet','530de4c4','26f795cb','--',name],cwd=root).returncode==0,
   'ranges':[{'start':lo,'end':hi,'lines':[f'{i+1}: {lines[i]}' for i in range(lo-1,min(hi,len(lines)))]} for lo,hi in ranges]}
(task/'inspection-evidence.json').write_text(json.dumps(snippets,indent=2)+'\n')

copydb=task/'query-benchmark-copy.sqlite'
db=sqlite3.connect('file:'+str(copydb)+'?mode=ro',uri=True)
extra={'path':str(copydb.relative_to(task)),'integrity':[r[0] for r in db.execute('PRAGMA integrity_check')],
       'foreignKeyViolations':list(db.execute('PRAGMA foreign_key_check')),'qsoCount':db.execute('SELECT COUNT(*) FROM qsos').fetchone()[0]}
db.close(); assert extra['integrity']==['ok'] and not extra['foreignKeyViolations']
(task/'additional-database-integrity.json').write_text(json.dumps(extra,indent=2)+'\n')

out.mkdir(parents=True)
def copy(src,relative=None,compressed=False):
 src=Path(src); dst=out/(relative or src.relative_to(task))
 data=src.read_bytes()
 if compressed:
  dst=dst.with_name(dst.name+'.gz'); data=gzip.compress(data,mtime=0)
 elif src.suffix in ['.json','.md','.py','.mjs','.log','.tsv']:
  data=('\n'.join(line.rstrip() for line in data.decode().splitlines()).rstrip()+'\n').encode()
 dst.parent.mkdir(parents=True,exist_ok=True); dst.write_bytes(data)
for name in ['environment.json','baseline.json','source-sha256.json','results.json','findings.json',
 'feature-inventory.json','test-inventory.json','dependency-manifests.json','dependency-tree-comparison.json',
 'npm-lifecycle-comparison.json','frontend-preservation.json','cw-fixture-preservation.json','fixture-restoration.json',
 'frontend-ref-530de4c4.json','frontend-ref-875b5254.json','frontend-ref-26f795cb.json','hamlib-provenance.json',
 'collector-incidents.json','security-triage.json','open-investigations.json','inspection-evidence.json',
 'additional-database-integrity.json','worker-release-build.json','disposable-ftp-ftps.json']:
 copy(task/name)
for src in (task/'logs').iterdir():
 if src.suffix=='.json' and not src.name.endswith('.running.json'): copy(src)
 elif src.suffix=='.log': copy(src,compressed=True)
for src in (task/'scripts').iterdir():
 if src.is_file():copy(src)
for directory in ['security-osv','security-osv-r2']:
 for src in (task/directory).rglob('*'):
  if src.is_file(): copy(src,compressed=src.stat().st_size>400_000)
copy(task/'all-contests-readiness.json',compressed=True)
copy(task/'public-dxmap-result.json',compressed=True)
for folder in [*task.glob('browser-*'),*task.glob('worker-bootstrap*')]:
 if not folder.is_dir():continue
 for src in folder.rglob('*'):
  if not src.is_file() or any(part in ['isolated-home','tmp','fixtures','bootstrap.app'] for part in src.relative_to(folder).parts):continue
  if src.suffix in ['.json','.png','.log','.adi'] or (src.suffix=='.log' and 'exports' in src.parts):
   copy(src,compressed=src.suffix=='.log' and 'exports' not in src.parts)

readiness=json.loads((task/'all-contests-readiness.json').read_text())
table=['plugin\t'+'\t'.join(sorted(readiness['plugins'][0]['checks']))]
for plugin in readiness['plugins']:
 key=plugin.get('plugin') or plugin.get('id') or plugin.get('pluginID') or plugin.get('pluginId')
 assert key,plugin.keys()
 table.append(str(key)+'\t'+'\t'.join(plugin['checks'][name]['status'] for name in sorted(plugin['checks'])))
(out/'contest-readiness.tsv').write_text('\n'.join(table)+'\n')

ledger=['# Phase 4 command ledger','','All times are UTC. Commands ran on source `26f795cb531c0b3c299e6a5dcc6d4a7f095b2058`. Exit codes are actual runner receipts; exit 0 alone does not establish semantic success (see CW-SUSTAINED-60S). Baseline and replacement/invalid-invocation boundaries are recorded in collector-incidents.json. Raw logs are gzip-compressed without byte changes; metadata SHA256 refers to decompressed raw bytes. Human-readable copied text is whitespace-normalized.','','| ID | Exit | Seconds | Started UTC |','| --- | ---: | ---: | --- |']
for row in results['commands']:
 ledger.append(f"| [{row['id']}](logs/{row['id']}.json) | {row['exitCode']} | {row['durationSeconds']:.3f} | {row['startedUTC']} |")
ledger+=['','## Exact commands','']
for row in results['commands']:
 ledger += [f"### {row['id']}",'',f"Working directory: `{row['cwd']}`.",'','```sh',shlex.join(row['command']),'```','',f"Exit {row['exitCode']}; timed out: {row['timedOut']}; raw output: [log](logs/{row['id']}.log.gz).",'']
(out/'COMMANDS.md').write_text('\n'.join(ledger).rstrip()+'\n')
(out/'README.md').write_text('''# Phase 4 independent regression evidence — 29 October 2026

Source: clean canonical main at26f795cb531c0b3c299e6a5dcc6d4a7f095b2058, version1.3.60. This directory records a testing-only phase; application sources and expected test results were unchanged. No application candidate was packaged, installed or deployed.

Read the root REGRESSION_TEST_REPORT.md for interpretation and coverage. COMMANDS.md contains every completed runner command, exact arguments, UTC times, exit codes and raw-log links. results.json records counts, browser boundaries, source hashes and private-database integrity. findings.json contains three confirmed check/harness issues. open-investigations.json separately retains the unresolved NAQP acceptance failure and the overloaded CW pacing observation. security-triage.json distinguishes advisory matches from established application defects.

Each .log.gz preserves raw bytes; command metadata records their uncompressed SHA256. Text/JSON copies outside compressed logs are whitespace-normalized, and SHA256SUMS covers the archived bytes. The original scratch directory is /tmp/xlog-phase4-20261029-26f795cb; task builds remain under .build/phase4-20261029. Paths in receipts identify the actual execution paths and may expire. Large binaries, dependencies, disposable databases and caches are omitted from Git; database schema/integrity receipts, synthetic exports, browser observations, source guards, build provenance and reproduction commands are retained.

frontend-preservation.json and fixture-restoration.json show that the original node_modules and CW fixture directories were restored by inode and all180 original frontend dist file hashes match. Fresh npm trees and generated build outputs were preserved in separate ignored task paths. No unique user work was discarded. Native GUI, installed application, physical radio/RF, production credentials/data, sponsor submission and Windows/Linux native acceptance are outside this evidence.
''')

def manifest():
 lines=[hashlib.sha256(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(out)) for p in sorted(out.rglob('*')) if p.is_file() and p.name!='SHA256SUMS']
 (out/'SHA256SUMS').write_text('\n'.join(lines)+'\n'); return len(lines)
print(json.dumps({'evidence':str(out),'files':manifest(),'bytes':sum(p.stat().st_size for p in out.rglob('*') if p.is_file()),'commands':len(results['commands']),'privateDatabases':len(results['databaseIntegrity'])+1}))
