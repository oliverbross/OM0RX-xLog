from pathlib import Path
import hashlib,json,os,subprocess
root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
task=Path('/tmp/xlog-phase4-20261029-26f795cb')
target=root/'.build/cw-native'
backup=root/'.build/phase4-20261029/preserved-cw-native'
fresh=task/'cw-native'
assert (fresh/'xlog-cw-worker').is_file() and (fresh/'cw-process-probe').is_file()
processes=subprocess.check_output(['ps','-axo','pid,ppid,command'],text=True)
assert not any(str(target)+'/' in line for line in processes.splitlines()), 'An existing CW test executable is running'
assert not backup.exists()
receipt={'target':str(target),'fresh':str(fresh),'preserved':str(backup),'originalExisted':target.exists(),
    'freshSHA256':hashlib.sha256((fresh/'xlog-cw-worker').read_bytes()).hexdigest()}
if target.exists():
    assert not target.is_symlink()
    receipt['originalInode']=target.stat().st_ino
    os.rename(target,backup)
target.symlink_to(fresh,target_is_directory=True)
(task/'cw-fixture-preservation.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
