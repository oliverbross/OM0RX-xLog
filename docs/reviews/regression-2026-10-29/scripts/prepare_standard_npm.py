from pathlib import Path
import hashlib,json,os,subprocess
root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
task=Path('/tmp/xlog-phase4-20261029-26f795cb')
source=root/'prototype/node_modules'
backup=root/'.build/phase4-20261029/first-npm-modules'
assert source.is_dir() and not backup.exists()
processes=subprocess.check_output(['ps','-axo','pid,ppid,command'],text=True)
assert not any(str(source)+'/' in row for row in processes.splitlines()), 'Frontend tooling is still active'
hashes={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*')
    if p.is_file() and not p.is_symlink() and '.vite' not in p.parts and '.cache' not in p.parts and p.name!='.package-lock.json'}
(task/'npm-ignore-scripts-file-hashes.json').write_text(json.dumps(hashes,indent=2)+'\n')
os.rename(source,backup)
dist=root/'prototype/dist'
if dist.exists(): os.rename(dist,task/'frontend-dist-ignore-scripts')
print(json.dumps({'preservedFirstCleanModules':str(backup),'filesHashed':len(hashes)}))
