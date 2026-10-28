from pathlib import Path
import hashlib, json, os, subprocess, tarfile
root = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
task = Path('/tmp/xlog-phase4-20261029-26f795cb')
modules = root/'prototype/node_modules'
backup = root/'.build/phase4-20261029/preserved-node_modules'
assert modules.is_dir() and not modules.is_symlink() and not backup.exists()
processes = subprocess.check_output(['ps','-axo','pid,ppid,command'],text=True)
active = [line for line in processes.splitlines() if str(modules) in line]
assert not active, active
receipt = {'originalPath':str(modules),'preservedPath':str(backup),'originalInode':modules.stat().st_ino,'originalDevice':modules.stat().st_dev,
    'manifests':{name:hashlib.sha256((root/'prototype'/name).read_bytes()).hexdigest() for name in ['package.json','package-lock.json']}}
dist = root/'prototype/dist'
if dist.exists():
    receipt['previousDistHashes'] = {str(p.relative_to(dist)):hashlib.sha256(p.read_bytes()).hexdigest() for p in dist.rglob('*') if p.is_file()}
    archive = task/'frontend-dist-before.tar.gz'
    with tarfile.open(archive,'x:gz') as output: output.add(dist,arcname='dist')
    receipt['previousDistArchive'] = str(archive)
backup.parent.mkdir(parents=True,exist_ok=True)
os.rename(modules,backup)
(task/'frontend-preservation.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'preservedModules':str(backup),'inode':receipt['originalInode'],'generatedDistArchived':dist.exists()}))
