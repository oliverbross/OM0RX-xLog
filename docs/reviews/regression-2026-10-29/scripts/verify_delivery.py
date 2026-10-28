from pathlib import Path
import datetime,gzip,hashlib,json,os,re,subprocess
root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
task=Path('/tmp/xlog-phase4-20261029-26f795cb')
out=root/'docs/reviews/regression-2026-10-29'
allowed={'CODE_REVIEW.md','REVIEW_COVERAGE.md','REMEDIATION_TRACKER.md','REGRESSION_TEST_REPORT.md'}
source=json.loads((task/'source-sha256.json').read_text())
assert all(hashlib.sha256((root/name).read_bytes()).hexdigest()==sha for name,sha in source.items())
names=subprocess.check_output(['git','diff','HEAD','--name-only'],cwd=root,text=True).splitlines()
assert all(n in allowed or n.startswith(str(out.relative_to(root))+'/') for n in names),names
untracked=subprocess.check_output(['git','ls-files','--others','--exclude-standard'],cwd=root,text=True).splitlines()
assert all(n in allowed or n.startswith(str(out.relative_to(root))+'/') for n in untracked),untracked
a=json.loads((task/'frontend-preservation.json').read_text()); b=json.loads((task/'cw-fixture-preservation.json').read_text())
assert Path(a['originalPath']).stat().st_ino==a['originalInode']
assert Path(b['target']).stat().st_ino==b['originalInode'] and not Path(b['target']).is_symlink()
dist=root/'prototype/dist'
assert {str(p.relative_to(dist)):hashlib.sha256(p.read_bytes()).hexdigest() for p in dist.rglob('*') if p.is_file()}==a['previousDistHashes']
results=json.loads((out/'results.json').read_text())
for row in results['commands']:
 raw=gzip.decompress((out/'logs'/(row['id']+'.log.gz')).read_bytes())
 assert hashlib.sha256(raw).hexdigest()==row['rawLogSHA256'],row['id']
exports=json.loads((out/'export-byte-verification.json').read_text())
for row in exports:
 raw=gzip.decompress((out/row['archive']).read_bytes())
 assert len(raw)==row['uncompressedBytes'] and hashlib.sha256(raw).hexdigest()==row['uncompressedSHA256']

# The archive uses application-resolvable links; metadata retains actual execution paths.
commands=out/'COMMANDS.md'
commands.write_text(commands.read_text().replace('](logs/',']('+str(out)+'/logs/'))
readme=out/'README.md'
text=readme.read_text()
if 'Large browser traces' not in text:
 readme.write_text(text.rstrip()+'\n\nLarge browser traces are retained as acceptance.json.gz with a separate acceptance-summary.json. archive-compaction.json lists omitted duplicate bootstrap resources; the original resources remain in the task scratch and canonical source. This does not remove failing trace evidence.\n')

incidents=out/'collector-incidents.json'
data=json.loads(incidents.read_text())
if not any(row['id']=='optional inline Python version inspection' for row in data['otherIncidents']):
 data['otherIncidents'].append({'id':'optional inline Python version inspection','result':'A combined read-only process/version inspection was blocked because the bundled Python -c invocation is disallowed by the tool allowlist. It was not executed or retried through another executor. A separate permitted process inventory found no task-owned worker/browser/dummy services. No policy settings were changed.'})
 incidents.write_text(json.dumps(data,indent=2)+'\n')

bad=[]; links=0
for path in [*(root/name for name in allowed),out/'COMMANDS.md']:
 for dest in re.findall(r'\]\(([^)]+)\)',path.read_text()):
  dest=dest.strip('<>')
  if dest.startswith(('https://','http://','#','mailto:')):continue
  dest=dest.split('#')[0]; match=re.match(r'^(.*):(\d+)$',dest)
  line=None
  if match:dest,line=match[1],int(match[2])
  target=Path(dest) if dest.startswith('/') else path.parent/dest
  links+=1
  if not target.exists() or line is not None and len(target.read_text().splitlines())<line:bad.append((str(path),dest,line))
assert not bad,bad
for name in ['findings.json','open-investigations.json']:
 for finding in json.loads((out/name).read_text()):
  for dest in finding['evidence']:
   if dest.startswith(('logs/','browser-','worker-','frontend-','npm-','dependency-')):
    assert (out/dest).exists(),(name,dest)

rows=subprocess.check_output(['ps','-axo','pid=,ppid=,etime=,command='],text=True).splitlines()
parsed=[]
for row in rows:
 parts=row.strip().split(None,3)
 if len(parts)==4:parsed.append({'pid':int(parts[0]),'ppid':int(parts[1]),'elapsed':parts[2],'command':parts[3]})
parents={r['pid']:r['ppid'] for r in parsed}; ancestors={os.getpid()}; pid=os.getpid()
while pid in parents and parents[pid] and parents[pid] not in ancestors:
 pid=parents[pid]; ancestors.add(pid)
owned=[r for r in parsed if r['pid'] not in ancestors and any(x in r['command'] for x in [str(task),'/private'+str(task),str(root/'.build/phase4-20261029')])]
assert not owned,owned
receipt={'verifiedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'testedSourceHead':results['sourceHead'],'applicationSourceFilesUnchanged':len(source),
 'allowedRootDocumentation':sorted(allowed),'restoredOriginalNodeModulesInode':a['originalInode'],
 'restoredOriginalCWFixtureInode':b['originalInode'],'restoredDistHashes':len(a['previousDistHashes']),
 'completedRunnerCommands':len(results['commands']),'rawLogsVerified':len(results['commands']),'rawExportsVerified':len(exports),
 'localReportLinksChecked':links,'taskOwnedProcessesRemaining':owned,
 'processInventoryBoundary':'Process-only check against exact task scratch/build markers, excluding this inspector and its ancestors. No app/UI binding, signals, relaunch or unrelated-process termination.',
 'rootReportSHA256':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in sorted(allowed)}}
(out/'delivery-verification.json').write_text(json.dumps(receipt,indent=2)+'\n')
(out/'scripts/verify_delivery.py').write_bytes(Path(__file__).read_bytes())
lines=[hashlib.sha256(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(out)) for p in sorted(out.rglob('*')) if p.is_file() and p.name!='SHA256SUMS']
(out/'SHA256SUMS').write_text('\n'.join(lines)+'\n')
for line in lines:
 sha,name=line.split('  ',1); assert hashlib.sha256((out/name).read_bytes()).hexdigest()==sha
print(json.dumps({'verified':True,'applicationFiles':len(source),'commands':len(results['commands']),'links':links,'evidenceFiles':len(lines),'evidenceBytes':sum(p.stat().st_size for p in out.rglob('*') if p.is_file()),'ownedProcesses':owned}))
