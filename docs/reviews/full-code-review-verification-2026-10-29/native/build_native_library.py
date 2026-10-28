from pathlib import Path
import subprocess
import json
import hashlib

root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
out=Path('/tmp/xlog-review-verification-20261028-12824393/native')
build=root/'.build/prototype-tests/debug'
targets=['XLogPrototypeSupport','XLogCore','XCatIntegrationCore','XClusterIntegrationCore','XStationIntegrationCore','XContestCore','XContestStore','XCWCore','CCWProcess','CClusterSocket','CCurlBackup','CPlatformVault']
objects=[build/(name+'.o') for name in targets]
command=['swiftc','-emit-library','-o',str(out/'libReviewNative.dylib'),*[str(p) for p in objects],'-framework','Security','-framework','Network','-framework','LocalAuthentication','-lsqlite3','-lcurl','-lz']
(out/'native-library-command.json').write_text(json.dumps({'command':command,'objects':[{ 'path':str(p.resolve()),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in objects]},indent=2)+'\n')
with (out/'native-library-build.log').open('w') as log:
    result=subprocess.run(command,cwd=root,stdout=log,stderr=subprocess.STDOUT)
print('native library link exit',result.returncode)
raise SystemExit(result.returncode)
