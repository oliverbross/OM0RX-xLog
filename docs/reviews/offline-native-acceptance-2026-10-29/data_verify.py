from pathlib import Path
import base64, datetime, hashlib, json, os, shutil, sqlite3, sys, uuid

stage=Path(__file__).resolve().parent; out=stage/'data-evidence'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def write(name,v):(out/name).write_text(json.dumps(v,indent=2)+'\n')
def decode(v):
    if isinstance(v,dict) and set(v)=={'hex'}:
        raw=bytes.fromhex(v['hex'])
        try:return decode(json.loads(raw))
        except (ValueError,UnicodeDecodeError):return v
    if isinstance(v,str) and v[:1] in ['{','[']:
        try:return decode(json.loads(v))
        except ValueError:return v
    if isinstance(v,dict):return {k:decode(x) for k,x in v.items()}
    if isinstance(v,list):return [decode(x) for x in v]
    return v
data=decode(json.loads((out/'database-inspection.json').read_text()))
seal_results={}
for name in ['selected-package','recovery-package']:
    p=out/name; seal=json.loads((p/'package-seal.json').read_text()); manifest=json.loads((p/'manifest.json').read_text())
    entries=seal['entries']; files={str(x.relative_to(p)):x for x in p.rglob('*') if x.is_file() and x.name!='package-seal.json'}
    results=[{'path':e['path'],'pass':e['path'] in files and sha(files[e['path']])==e['sha256'] and files[e['path']].stat().st_size==e['byteCount']} for e in entries]
    seal_results[name]={'version':seal['version'],'entries':results,'exactPayloadSet':set(files)=={e['path'] for e in entries},'mainManifestHashMatches':sha(p/'OM0RX-xLog.sqlite')==manifest['databaseSHA256'],'mainManifestBytesMatch':(p/'OM0RX-xLog.sqlite').stat().st_size==manifest['databaseBytes'],'referencePayloads':[f for f in files if f.startswith(('ReferenceData/','Reference Data/'))]}
write('seal-verification.json',seal_results)
selected={k:v for k,v in data.items() if k.startswith('selected-package/')}
brief={}
for path,v in data.items():
    tables=v['tables']
    brief[path]={'integrity':v['integrity'],'foreignKeyViolations':v['foreignKeyViolations'],'tables':{k:rows for k,rows in tables.items() if rows and (k in ['qsos','xlog_operator_draft','xlog_qso_identity','xlog_adif_import','xlog_session','DXLOG','xlog_integration_settings','xlog_qso_revision','xlog_restore_authority','xlog_sync_runs','sync_outbox','xlog_online_log_enrollments','xlog_online_log_deliveries'] or 'reference' in k.lower())}}
write('identity-and-settings.json',brief)
main='worker/OM0RX-xLog-Integrated Preview/OM0RX-xLog.sqlite'
contest='worker/Contesting/Python/8b9c6663-bccd-4701-9f83-5fbc7c705251/contest.sqlite'
def tables(label,relative):return data['snapshot-copies/'+label+'/'+relative]['tables']
before=tables('before-native-restore',main);after=tables('after-native-restore',main)
comparison={'mainTableDifferences':{},'contestTableDifferences':{},'packageComponentHashesEqual':{},'allDatabaseIntegrityPass':all(v['integrity']==['ok'] and v['foreignKeyViolations']==[] for v in data.values())}
for key in set(before)|set(after):
    if before.get(key)!=after.get(key):comparison['mainTableDifferences'][key]={'before':before.get(key),'after':after.get(key)}
bc=tables('before-native-restore',contest);ac=tables('after-native-restore',contest)
for key in set(bc)|set(ac):
    if bc.get(key)!=ac.get(key):comparison['contestTableDifferences'][key]={'before':bc.get(key),'after':ac.get(key)}
for file in ['OM0RX-xLog.sqlite','Contesting/Python/8b9c6663-bccd-4701-9f83-5fbc7c705251/contest.sqlite','settings.json','preferences.json']:
    comparison['packageComponentHashesEqual'][file]=sha(out/'selected-package'/file)==sha(out/'recovery-package'/file)
comparison['nativeExportVsBeforeRestoreContestRowsEqual']=tables('contest-export',contest)==bc
write('restore-component-comparison.json',comparison)
print(json.dumps({'seals':seal_results,'databaseIntegrityPass':comparison['allDatabaseIntegrityPass'],'mainTableDifferenceNames':list(comparison['mainTableDifferences']),'contestTableDifferenceNames':list(comparison['contestTableDifferences']),'packageComponentsEqual':comparison['packageComponentHashesEqual'],'contestExportSnapshotMatchesBeforeRestore':comparison['nativeExportVsBeforeRestoreContestRowsEqual']},indent=2))
if (out/'export-byte-comparison.json').exists():
    print('Existing independent export receipt preserved; decoded inspection refreshed without repeating export.')
    sys.exit(0)

# The actual retained PythonHost and pinned formatter, using a separate copy of the
# exact contemporaneous snapshot. This creates a new fixture receipt, never a
# substitute historical prepared receipt or a native UI action.
resource=stage/'XLog Offline Development.app/Contents/Resources/Not1MM/python'
sys.path.insert(0,str(resource)); os.environ['PYTHONDONTWRITEBYTECODE']='1'; sys.dont_write_bytecode=True
os.environ['XLOG_CONTEST_N1MM_UDP_ALLOWED']='0'
from contest_host.host import Host
clone=out/'independent-export-root';clone.mkdir(exist_ok=False)
session='8b9c6663-bccd-4701-9f83-5fbc7c705251'
source=out/'snapshot-copies/contest-export'/contest
target=clone/session/'contest.sqlite';target.parent.mkdir();shutil.copy2(source,target)
host=Host(clone);transcript=[]
def call(method,**params):
    req={'id':str(uuid.uuid4()),'method':method,'params':params};result=host.dispatch(req);transcript.append({'request':req,'result':result});return result
try:
    sessions=call('sessions'); assert len(sessions['sessions'])==1
    assert sessions['sessions'][0]['revision']==6
    prepared=call('export_prepare',sessionID=session,format='adif',expectedRevision=6)
    chunk=call('export_read',sessionID=session,exportID=prepared['artifactID'],workspaceGeneration=prepared['workspaceGeneration'],offset=0,length=prepared['byteLength'])
    expected=base64.b64decode(chunk['dataBase64']);(out/'independent-reviewed-r6.adi').write_bytes(expected)
    native=(out/'native-reviewed-contest.adi').read_bytes()
    call('export_release',sessionID=session,exportID=prepared['artifactID'],workspaceGeneration=prepared['workspaceGeneration'])
finally:host.close()
write('independent-export-transcript.json',transcript)
result={'status':'PASS' if expected==native else 'FAIL','byteIdentical':expected==native,'nativeBytes':len(native),'counterpartBytes':len(expected),'nativeSHA256':hashlib.sha256(native).hexdigest(),'counterpartSHA256':hashlib.sha256(expected).hexdigest(),'sessionID':session,'revision':6,'inputSHA256':sha(source),'inputCopySHA256BeforeHost':json.loads((out/'input-sha256.json').read_text())[str(stage/'snapshots/contest-export'/contest)]['sha256'],'preservedQSOIDs':[r['ID'] for r in bc['DXLOG']],'scope':'Independent fixture receipt from exact retained revision-6 snapshot and candidate PythonHost; native-issued prepared receipt was not retained. Actual NSSavePanel save evidence remains separate.','pythonSourceHashes':{str(p.relative_to(resource)):sha(p) for p in resource.rglob('*.py') if 'contest_host' in p.parts or p.name in ['plugin_common.py','cq_wpx_cw.py']}}
write('export-byte-comparison.json',result)
print(json.dumps(result,indent=2))
