from pathlib import Path
import datetime, hashlib, json, os, platform, subprocess
root = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
out = Path('/tmp/xlog-phase4-20261029-26f795cb')
def run(command):
    p = subprocess.run(command,cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    return {'command':command,'exitCode':p.returncode,'output':p.stdout.strip()}
files = subprocess.check_output(['git','ls-files'],cwd=root,text=True).splitlines()
environment = {'dateUTC':datetime.datetime.now(datetime.UTC).isoformat(),'platform':platform.platform(),'machine':platform.machine(),'cpuCount':os.cpu_count(),
    'tools':{name:run(command) for name,command in {
        'git':['git','--version'],'swift':['swift','--version'],'rust':['rustc','--version'],'cargo':['cargo','--version'],
        'node':['node','--version'],'npm':['npm','--version'],'python':['python3.12','--version'],'cmake':['cmake','--version'],
        'clang':['clang','--version'],'agentBrowser':['agent-browser','--version'],'cargoAudit':['cargo','audit','--version'],
        'cargoClippy':['cargo','clippy','--version'],'pipAudit':['python3.12','-m','pip_audit','--version'],
        'system':['sw_vers'],'memory':['sysctl','hw.memsize'],'disk':['df','-h',str(root)],
    }.items()}}
state = {'cwd':str(root),'head':run(['git','rev-parse','HEAD']),'originMain':run(['git','rev-parse','origin/main']),
    'status':run(['git','status','--porcelain=v1']),'branch':run(['git','branch','--show-current']),
    'submodules':run(['git','submodule','status']),'trackedFiles':len(files)}
assert state['branch']['output']=='main' and state['status']['output']==''
assert state['head']['output']==state['originMain']['output']
source = {name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in files if name.startswith(('Sources/','Tests/','prototype/','python/','native/','tools/')) and (root/name).is_file()}
tests = [name for name in files if name.startswith(('Tests/','prototype/','python/','native/','tools/')) and ('test' in Path(name).name.lower() or Path(name).name=='CMakeLists.txt')]
features = [name for name in files if name.startswith(('Sources/','prototype/src/','prototype/src-tauri/src/','native/','tools/')) and '/Resources/' not in name]
manifests = [name for name in files if Path(name).name in ['Package.swift','Package.resolved','Cargo.toml','Cargo.lock','package.json','package-lock.json','pnpm-lock.yaml','pyproject.toml','requirements.txt','CMakeLists.txt']]
for name,data in [('environment.json',environment),('baseline.json',state),('source-sha256.json',source),('test-inventory.json',tests),('feature-inventory.json',features),('dependency-manifests.json',manifests)]:
    (out/name).write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps({'head':state['head']['output'],'trackedFiles':len(files),'sourceFilesHashed':len(source),'testPaths':len(tests),'featurePaths':len(features),'manifests':manifests,'platform':environment['platform']}))
