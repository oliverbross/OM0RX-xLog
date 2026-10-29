from pathlib import Path
import datetime, hashlib, json, plistlib, shutil, subprocess
repo=Path('/Users/oliver/Documents/Projects/OM0RX-xLog');stage=Path(__file__).resolve().parent
old=stage/'XLog Offline Development.app';new=stage/'XLog Offline Precision Development.app'
assert old.is_dir() and not new.exists()
ps=subprocess.check_output(['ps','-axo','pid=,args='],text=True)
assert not any(str(old/'Contents/MacOS/xlog-prototype') in line for line in ps.splitlines())
receipt=json.loads((stage/'precision-worker-build-receipt.json').read_text())
assert receipt['exit']==0
inputs=json.loads((stage/'precision-worker-inputs.json').read_text())
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
worker=stage/'precision-worker/xlog-prototype-worker'
assert sha(worker)=='b3c984c5a38b39f563be7ee45179738fe9d12af34aa647d06a244e946a79a71e'
shutil.copytree(old,new,symlinks=True)
target=new/'Contents/MacOS/xlog-prototype-worker';target.unlink();shutil.copy2(worker,target)
bundles={}
for path in sorted((stage/'precision-worker').glob('*.bundle')):
    destination=new/'Contents/MacOS'/path.name
    if destination.is_symlink():destination.unlink()
    elif destination.exists():shutil.rmtree(destination)
    shutil.copytree(path,destination,symlinks=True)
    bundles[path.name]={str(item.relative_to(path)):sha(item) for item in sorted(path.rglob('*')) if item.is_file()}
assert len(bundles)==2
info=new/'Contents/Info.plist';values=plistlib.loads(info.read_bytes())
values['CFBundleName']='XLog Offline Precision Development';info.write_bytes(plistlib.dumps(values))
report={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),
    'app':str(new),'originalDevelopmentAppPreserved':str(old),'hostSHA256':sha(new/'Contents/MacOS/xlog-prototype'),
    'workerSHA256':sha(target),'resourceBundles':bundles,'candidate':False,'installed':False,'releaseVersionMinted':False,
    'workerBuildReceipt':'precision-worker-build-receipt.json','workerBuildSourceTagRetained':True}
(stage/'precision-development-receipt.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'app':str(new),'head':report['head'],'workerSHA256':report['workerSHA256'],'previousAppPreserved':True}))
