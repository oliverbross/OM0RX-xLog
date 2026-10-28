from pathlib import Path
import subprocess,json,os
root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
out=Path('/tmp/xlog-review-verification-20261028-12824393/native')
deps=root/'prototype/src-tauri/target/debug/deps'
cmd=['rustc','--edition=2021',str(out/'verify_recorder_store.rs'),'-L','dependency='+str(deps),'-o',str(out/'verify_recorder_store')]
for name in ['serde','serde_json','sha2','tempfile','libc','uuid']:
    files=sorted(deps.glob('lib'+name+'-*.rlib'),key=lambda p:p.stat().st_mtime,reverse=True)
    cmd.extend(['--extern',name+'='+str(files[0])])
(out/'recorder-build-command.json').write_text(json.dumps(cmd,indent=2)+'\n')
env=dict(os.environ,CARGO_PKG_VERSION='1.3.60')
with (out/'recorder-build.log').open('w') as log:
    result=subprocess.run(cmd,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
print('recorder probe compile exit',result.returncode)
raise SystemExit(result.returncode)
