from pathlib import Path
import datetime, gzip, hashlib, json, subprocess
repo=Path('/Users/oliver/Documents/Projects/OM0RX-xLog');stage=Path(__file__).resolve().parent
destination=repo/'docs/reviews/offline-native-acceptance-2026-10-29'
assert not destination.exists(), 'Preserve completed archives; never overwrite them'
ps=subprocess.check_output(['ps','-axo','pid=,args='],text=True)
for name in ['XLog Offline Development.app','XLog Offline Precision Development.app']:
    assert not any(str(stage/name/'Contents/MacOS/xlog-prototype') in line for line in ps.splitlines()),'Private app/worker must be stopped'
def sha(data):return hashlib.sha256(data).hexdigest()
baseline=json.loads((stage/'application-inputs.json').read_text())
current={path:sha((repo/path).read_bytes()) for path in baseline}
worker=json.loads((stage/'precision-worker-inputs.json').read_text())
assert all(sha((repo/path).read_bytes())==digest for path,digest in worker.items()),'Worker inputs changed after build'
selection=json.loads((stage/'accepted-frontend-build.json').read_text())
frontend=json.loads((stage/selection['receiptFile']).read_text())
assert frontend['exit']==0 and frontend['originalDistRestored']
assert all(sha((repo/path).read_bytes())==digest for path,digest in frontend['frontendInputs'].items()),'Frontend inputs changed after build'
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
changes=[path for path in baseline if baseline[path]!=current[path]]
source={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'testedSource':head,
    'entryCheckpoint':'6e8bc944870279941c6a9e675037d004c4f9649f','entryAppInputs':'c8cc1a134ee7fdacfb4b389f1648b47e18a059a1',
    'inputCount':len(current),'changedInputs':changes,'inputs':current,'workerInputHashesMatch':True,'frontendInputHashesMatch':True,
    'frontendBuildReceipt':selection['receiptFile']}
(stage/'final-source-inputs.json').write_text(json.dumps(source,indent=2)+'\n')
files=[]
for path in sorted(stage.iterdir()):
    if path.is_file() and path.suffix in {'.py','.json','.md','.diff','.log','.stderr','.adi','.txt'}:files.append(path)
for folder in ['data-evidence','snapshots']:
    files.extend(path for path in sorted((stage/folder).rglob('*')) if path.is_file())
manifest={}
for path in files:
    relative=path.relative_to(stage);data=path.read_bytes()
    compressed=path.suffix in {'.log','.stderr','.adi','.txt','.diff','.sqlite'} or path.name.endswith(('-wal','-shm')) or len(data)>80_000
    target=destination/(str(relative)+('.gz' if compressed else ''))
    target.parent.mkdir(parents=True,exist_ok=True)
    stored=gzip.compress(data,compresslevel=9,mtime=0) if compressed else data
    target.write_bytes(stored)
    assert (gzip.decompress(stored) if compressed else stored)==data
    manifest[str(target.relative_to(destination))]={'source':str(relative),'bytes':len(data),'sha256':sha(data),'storedSHA256':sha(stored),'gzip':compressed}
(destination/'MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'archive':str(destination),'artifacts':len(manifest),'source':head,'changedInputs':changes,
    'storedBytes':sum(path.stat().st_size for path in destination.rglob('*') if path.is_file())}))
