from pathlib import Path
import datetime, hashlib, json, shutil, sqlite3, sys

stage=Path(__file__).resolve().parent
root=Path(json.loads((stage/'seed.json').read_text())['root'])
out=stage/'data-evidence'
out.mkdir(exist_ok=False)
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def write(name,value): (out/name).write_text(json.dumps(value,indent=2,default=lambda v:{'hex':v.hex()})+'\n')
assert root==Path('/private/tmp/xlog-wave1-offline-native-5__wfphw')
assert json.loads((root/'.xlog-offline-acceptance.json').read_text())['id']=='77fb24fd-bdba-46a1-a037-e95c12479424'
base=root/'worker/OM0RX-xLog-Integrated Preview'
inputs={}
def copy(source,target):
    target.parent.mkdir(parents=True,exist_ok=True)
    before=digest(source); shutil.copy2(source,target); after=digest(source)
    assert before==after==digest(target), str(source)
    inputs[str(source)]={'sha256':before,'copy':str(target.relative_to(out)),'bytes':source.stat().st_size}
for label,parent in [('selected-package',base/'Backups/OM0RX-xLog-2026-10-29T11-41-34Z.xlogbackup'),('recovery-package',base/'Recovery/pre-restore-65EF601E-26B7-4EE8-9CCB-928D9F85BB17.xlogbackup')]:
    assert parent.is_dir()
    for source in sorted(parent.rglob('*')):
        if source.is_file(): copy(source,out/label/source.relative_to(parent))
for source in [root/'.xlog-offline-acceptance.json',root/'native/operating-module.json',base/'workspace.json',base/'edit-generation.json']:
    if source.is_file():copy(source,out/'private-metadata'/source.relative_to(root))
for label in ['manual-save-detached','switch-veto','contesting-restart','contest-export','before-native-restore','after-native-restore']:
    parent=stage/'snapshots'/label
    for source in sorted(parent.rglob('*')):
        if source.is_file():copy(source,out/'snapshot-copies'/label/source.relative_to(parent))
    copy(stage/('snapshot-'+label+'.json'),out/'snapshot-receipts'/('snapshot-'+label+'.json'))
copy(stage/'native-reviewed-contest.adi',out/'native-reviewed-contest.adi')
copy(stage/'reviewed-import.adi',out/'reviewed-import.adi')
write('input-sha256.json',inputs)
markers=[str(p.relative_to(root)) for p in sorted(root.rglob('.restore-incomplete'))]
write('capture.json',{'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'originalRoot':str(root),'markerID':'77fb24fd-bdba-46a1-a037-e95c12479424','copiedFiles':len(inputs),'restoreIncompleteMarkers':markers,'sourceBytesPreservedAtCopy':True,'sqliteChecksOnlyOnCopies':True,'command':sys.argv})
summaries={}
for path in sorted(out.rglob('*.sqlite')):
    db=sqlite3.connect(path)
    db.row_factory=sqlite3.Row
    tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    contents={table:[dict(r) for r in db.execute('SELECT * FROM "'+table.replace('"','""')+'"')] for table in tables}
    summaries[str(path.relative_to(out))]={'integrity':[r[0] for r in db.execute('PRAGMA integrity_check')],'foreignKeyViolations':[list(r) for r in db.execute('PRAGMA foreign_key_check')],'tables':contents}
    db.close()
write('database-inspection.json',summaries)
packages={}
for label in ['selected-package','recovery-package']:
    packages[label]={str(p.relative_to(out/label)):json.loads(p.read_text()) for p in sorted((out/label).rglob('*.json'))}
write('package-json.json',packages)
write('database-index.json',{p:{'integrity':v['integrity'],'foreignKeyViolations':v['foreignKeyViolations'],'tableCounts':{t:len(r) for t,r in v['tables'].items()}} for p,v in summaries.items()})
print(json.dumps({'copiedFiles':len(inputs),'copiedDatabases':len(summaries),'restoreIncompleteMarkers':markers,'packages':packages},indent=2))
